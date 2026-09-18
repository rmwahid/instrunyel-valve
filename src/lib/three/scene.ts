/**
 * The Three.js scene: renderer, camera, lighting and the flow visualisation.
 *
 * The scene is a pure view of the simulation state. It reads a snapshot and draws
 * it; it never computes physics and it never writes back. Keeping that direction
 * one way is what allows the physics to be tested headless and the renderer to be
 * replaced without touching the model.
 */

import {
	ACESFilmicToneMapping,
	AmbientLight,
	Box3,
	Color,
	DirectionalLight,
	DoubleSide,
	DynamicDrawUsage,
	Group,
	HemisphereLight,
	InstancedMesh,
	Matrix4,
	Material,
	Mesh,
	MeshStandardMaterial,
	PerspectiveCamera,
	Plane,
	Scene,
	SphereGeometry,
	Vector3,
	WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FLOOR } from './materials';

export interface SceneOptions {
	canvas: HTMLCanvasElement;
	/** Called every frame with the elapsed time in seconds. */
	onFrame?: (deltaSeconds: number) => void;
}

export interface SceneHandle {
	scene: Scene;
	camera: PerspectiveCamera;
	renderer: WebGLRenderer;
	controls: OrbitControls;
	/** Group holding the valve assembly. */
	valveGroup: Group;
	/** Group holding the flow particles. */
	flowGroup: Group;
	/**
	 * Frame the camera on an assembly of a given size.
	 * Called after the valve is built or replaced.
	 */
	frameOn(heightM: number, lengthM: number): void;
	/**
	 * Update the flow particle field.
	 *
	 * The pipe dimensions are passed here rather than configured once, because they
	 * change with the valve: a 2 inch valve and a 6 inch butterfly need the particle
	 * field to span different distances and radii.
	 */
	setFlow(options: {
		visible: boolean;
		/** Volume flow in m3/h, used for particle speed. */
		flowM3PerHour: number;
		/** Normalising flow, so the visual speed is comparable between valves. */
		referenceFlowM3PerHour: number;
		/** Colour of the fluid. */
		colorHex: string;
		/** True to show bubbles at the vena contracta. */
		cavitating: boolean;
		/** Length of pipe the particles travel along, metres. */
		pipeLengthM: number;
		/** Radius of the pipe bore, metres. */
		pipeRadiusM: number;
	}): void;
	/** Advance the flow animation. Called from the frame loop. */
	updateFlow(deltaSeconds: number): void;
	/** Show or hide the floor grid. */
	setFloorVisible(visible: boolean): void;

	/**
	 * Slice the assembly with a cutting plane, the way an engineering drawing shows
	 * a section.
	 *
	 * This is not the same as hiding the casing. Hiding a part removes it, so the
	 * wall thickness and the cut faces disappear with it and the result looks like a
	 * model with a piece missing. A clipping plane cuts through every part at once,
	 * including the ones inside, so what you see is what a hacksaw through the middle
	 * of the valve would reveal.
	 *
	 * `offset` slides the plane along its normal, which lets the cut be walked
	 * through the valve rather than only taken through the centre.
	 */
	setSectionView(options: {
		enabled: boolean;
		/** Direction the plane faces. The material on the negative side is removed. */
		normal: Vector3;
		/** Distance from the origin along the normal, in metres. */
		offset: number;
	}): void;

	/** How far the assembly extends along the current section normal. */
	sectionExtentM(): number;
	/** Resize the renderer to the current canvas size. */
	resize(): void;
	/** Start and stop the render loop. */
	start(): void;
	stop(): void;
	dispose(): void;
}

const BACKGROUND = new Color('#10151a');

/**
 * Build the scene.
 *
 * Lighting is a three point setup with a soft key, a cool fill and a warm rim,
 * which reads machined metal well without the flatness of a single light. The
 * environment map is left out deliberately: an HDRI would look better but would
 * add a large asset to a project whose whole point is that it runs from source.
 */
export function createScene(options: SceneOptions): SceneHandle {
	const scene = new Scene();
	scene.background = BACKGROUND;

	const camera = new PerspectiveCamera(45, 1, 0.05, 100);
	camera.position.set(0.5, 0.4, 0.7);

	const renderer = new WebGLRenderer({
		canvas: options.canvas,
		antialias: true,
		powerPreference: 'high-performance'
	});
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	// Local clipping has to be switched on before any material honours a clipping
	// plane. Turning it on costs a shader branch per material, which is why it is on
	// for this scene only and not globally.
	renderer.localClippingEnabled = true;

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.minDistance = 0.15;
	controls.maxDistance = 4;
	controls.target.set(0, 0.2, 0);

	// Key light, warm and high, from the front left.
	const key = new DirectionalLight(new Color('#fff4e6'), 2.4);
	key.position.set(1.2, 2.0, 1.4);
	scene.add(key);

	// Fill light, cool and low, from the front right, to keep the shadow side from
	// going black.
	const fill = new DirectionalLight(new Color('#8fb8d8'), 0.9);
	fill.position.set(-1.4, 0.6, 1.0);
	scene.add(fill);

	// Rim light from behind, to separate the valve from the background.
	const rim = new DirectionalLight(new Color('#cfe6ff'), 1.2);
	rim.position.set(-0.6, 1.4, -1.6);
	scene.add(rim);

	scene.add(new HemisphereLight(new Color('#93b8d4'), new Color('#1b2026'), 0.7));
	scene.add(new AmbientLight(new Color('#ffffff'), 0.25));

	// The floor, a dark plane that catches a little light so the assembly does not
	// appear to float.
	const floor = new Mesh(new SphereGeometry(6, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), FLOOR);
	floor.position.y = -0.001;
	floor.receiveShadow = true;
	scene.add(floor);

	const valveGroup = new Group();
	scene.add(valveGroup);

	const flowGroup = new Group();
	scene.add(flowGroup);

	// --- Flow particles -----------------------------------------------------
	//
	// The flow is drawn as a field of small spheres travelling along the pipe axis.
	// A particle field rather than a shader because it can be read at a glance: the
	// speed of the dots is the flow rate, and the count is fixed so the comparison
	// between two valve openings is honest.
	const PARTICLE_COUNT = 220;
	const particleGeometry = new SphereGeometry(0.0035, 8, 6);
	const particleMaterial = new MeshStandardMaterial({
		color: new Color('#3fa9d8'),
		emissive: new Color('#1d5f7a'),
		emissiveIntensity: 0.7,
		roughness: 0.3,
		metalness: 0.1,
		transparent: true,
		opacity: 0.9
	});

	const particles = new InstancedMesh(particleGeometry, particleMaterial, PARTICLE_COUNT);
	// The particle transforms are rewritten every frame, so the buffer is marked as
	// dynamic to tell the driver not to place it in fast device memory.
	particles.instanceMatrix.setUsage(DynamicDrawUsage);
	particles.frustumCulled = false;
	flowGroup.add(particles);

	// Per particle phase along the pipe, in the range 0 to 1.
	const phases = new Float32Array(PARTICLE_COUNT);
	for (let i = 0; i < PARTICLE_COUNT; i++) phases[i] = i / PARTICLE_COUNT;

	// A small radial scatter so the particles fill the pipe rather than sitting on
	// its axis.
	const radialOffsets = new Float32Array(PARTICLE_COUNT * 2);
	for (let i = 0; i < PARTICLE_COUNT; i++) {
		const angle = (i * 2.39996) % (Math.PI * 2);
		const radius = Math.sqrt((i % 17) / 17) * 0.55;
		radialOffsets[i * 2] = Math.cos(angle) * radius;
		radialOffsets[i * 2 + 1] = Math.sin(angle) * radius;
	}

	const matrix = new Matrix4();
	const position = new Vector3();

	let flowVisible = true;
	let flowSpeed = 0;
	let pipeLength = 0.5;
	let pipeRadius = 0.03;
	let cavitating = false;

	// Last size the renderer was set to, so a redundant resize can be skipped.
	let lastWidth = 0;
	let lastHeight = 0;

	/**
	 * The section plane, shared by every material in the scene.
	 *
	 * One plane object rather than one per material, because Three.js reads the plane
	 * every frame and a shared instance keeps them all cutting at the same place even
	 * while it is being moved.
	 */
	const sectionPlane = new Plane(new Vector3(0, 0, 1), 0);
	let sectionEnabled = false;

	// --- Frame loop ---------------------------------------------------------
	let running = false;
	let lastTime = 0;
	let frameHandle = 0;

	function renderFrame(time: number) {
		if (!running) return;
		frameHandle = requestAnimationFrame(renderFrame);

		const deltaSeconds = lastTime === 0 ? 0 : Math.min(0.1, (time - lastTime) / 1000);
		lastTime = time;

		options.onFrame?.(deltaSeconds);

		// Advance the particles. The speed is proportional to the flow so the visual
		// reads as a flow rate rather than a decoration.
		if (flowVisible && flowSpeed > 0) {
			const advance = (flowSpeed * deltaSeconds) / Math.max(pipeLength, 1e-6);
			for (let i = 0; i < PARTICLE_COUNT; i++) {
				phases[i] += advance;
				if (phases[i] > 1) phases[i] -= 1;
			}
		}

		updateFlowInstances();

		controls.update();
		renderer.render(scene, camera);
	}

	function updateFlowInstances() {
		if (!flowVisible) {
			// Park every particle at the origin with zero scale so nothing is drawn
			// without having to detach the instanced mesh from the scene graph.
			matrix.makeScale(0, 0, 0);
			for (let i = 0; i < PARTICLE_COUNT; i++) particles.setMatrixAt(i, matrix);
			particles.instanceMatrix.needsUpdate = true;
			return;
		}

		for (let i = 0; i < PARTICLE_COUNT; i++) {
			const phase = phases[i];
			// The particle travels along X, the flow axis of every assembly.
			position.x = (phase - 0.5) * pipeLength;
			position.y = radialOffsets[i * 2 + 1] * pipeRadius;
			position.z = radialOffsets[i * 2] * pipeRadius;

			// Particle size scales with the bore so the field reads as the same
			// fraction of the pipe whatever the valve size.
			let scale = pipeRadius / 0.03;

			// Bubbles grow at the vena contracta when the valve is cavitating, which
			// is just downstream of the body centre.
			if (cavitating) {
				const distanceFromBody = Math.abs(position.x);
				scale = 1 + Math.max(0, 1 - distanceFromBody / (pipeLength * 0.35)) * 1.8;
			}

			matrix.makeScale(scale, scale, scale);
			matrix.setPosition(position);
			particles.setMatrixAt(i, matrix);
		}
		particles.instanceMatrix.needsUpdate = true;
	}

	return {
		scene,
		camera,
		renderer,
		controls,
		valveGroup,
		flowGroup,

		frameOn(heightM: number, lengthM: number) {
			const extent = Math.max(heightM, lengthM, 0.12);
			const distance = extent * 2.1;
			camera.position.set(distance * 0.55, heightM * 0.95 + extent * 0.35, distance * 0.8);
			controls.target.set(0, heightM * 0.42, 0);
			controls.minDistance = extent * 0.5;
			controls.maxDistance = extent * 6;
			camera.near = extent * 0.02;
			camera.far = extent * 40;
			camera.updateProjectionMatrix();
			controls.update();
		},

		setFlow(flowOptions) {
			flowVisible = flowOptions.visible;
			cavitating = flowOptions.cavitating;
			pipeLength = Math.max(0.02, flowOptions.pipeLengthM);
			pipeRadius = Math.max(0.005, flowOptions.pipeRadiusM);
			particleMaterial.color.set(flowOptions.colorHex);
			particleMaterial.emissive.set(flowOptions.colorHex);

			const reference = Math.max(flowOptions.referenceFlowM3PerHour, 1e-6);
			// Speed in metres per second along the pipe.
			//
			// This is a scale, not the fluid velocity, and it has to be. At the rated flow a
			// DN50 valve runs at around 4.6 m/s, which crosses the pipe drawn here in 60 ms:
			// sixteen times a second, which the eye reads as a blur or as nothing at all. The
			// flow is therefore slowed to a twentieth of itself so the direction and the
			// relative rate can both be seen, and the panel beside it carries the real
			// numbers. The cap stops a small valve on a large loop from turning into a
			// strobe.
			//
			// It was 0.35 of the reference with the same cap, which left half travel at
			// 0.17 m/s: moving, but slowly enough that the field looked static.
			//
			// The floor is the other half of the fix. The reference is the greater of the
			// process range and the flow, and the process range is not a flow: it is a level
			// in metres on the level loop and a pressure in bar on a pressure loop. A
			// scenario whose range is a big number next to its flow therefore got a ratio
			// near zero and particles that crawled while the panel showed a real flow rate.
			// Any flow at all now moves the field visibly, and no flow still stops it.
			flowSpeed = flowOptions.flowM3PerHour > 0
				? Math.min(1.6, Math.max(0.22, 1.4 * (flowOptions.flowM3PerHour / reference)))
				: 0;
		},

		updateFlow(deltaSeconds) {
			void deltaSeconds;
			updateFlowInstances();
		},

		setFloorVisible(visible: boolean) {
			floor.visible = visible;
		},

		setSectionView(options) {
			sectionEnabled = options.enabled;
			sectionPlane.normal.copy(options.normal).normalize();
			sectionPlane.constant = -options.offset;

			const planes = sectionEnabled ? [sectionPlane] : [];

			// Every material in the assembly is given the plane, so the cut runs through
			// all of them at the same place. A material that kept its clipping off would
			// draw a part that the rest of the valve had been sliced away from, which
			// looks like a bug rather than a section.
			valveGroup.traverse((object) => {
				if (!(object instanceof Mesh)) return;
				const materials: Material[] = Array.isArray(object.material)
					? object.material
					: [object.material];
				for (const material of materials) {
					material.clippingPlanes = planes;
					// A sliced solid has no back face left on the cut, so the surfaces that
					// were interior become visible. Drawing them double sided is what lets
					// you see the inside of a casting rather than looking through a hole
					// into nothing.
					material.side = sectionEnabled ? DoubleSide : material.userData.originalSide ?? material.side;
					if (material.userData.originalSide === undefined) {
						material.userData.originalSide = material.side;
					}
					material.needsUpdate = true;
				}
			});

			// The floor is not part of the valve and must not be cut.
			FLOOR.clippingPlanes = [];
			FLOOR.needsUpdate = true;
		},

		sectionExtentM() {
			// Reported from the valve group's own bounds, so the caller can set a
			// sensible range on the section slider without knowing the valve size.
			const box = new Box3().setFromObject(valveGroup);
			if (box.isEmpty()) return 0.1;
			return Math.max(box.max.length(), box.min.length(), 0.05);
		},

		resize() {
			const canvas = renderer.domElement;
			const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 1;
			const height = canvas.clientHeight || canvas.parentElement?.clientHeight || 1;

			// Resizing is expensive: it reallocates the drawing buffer and reads the
			// element's layout. The render loop calls this every frame, so the size is
			// compared first and the work is skipped when nothing has changed. Without
			// this the canvas is resized sixty times a second for no reason, which
			// shows up as jitter while the panels are being interacted with.
			if (width === lastWidth && height === lastHeight) return;

			lastWidth = width;
			lastHeight = height;
			renderer.setSize(width, height, false);
			camera.aspect = width / height;
			camera.updateProjectionMatrix();
		},

		start() {
			if (running) return;
			running = true;
			lastTime = 0;
			frameHandle = requestAnimationFrame(renderFrame);
		},

		stop() {
			running = false;
			if (frameHandle) cancelAnimationFrame(frameHandle);
			frameHandle = 0;
		},

		dispose() {
			this.stop();
			controls.dispose();
			particleGeometry.dispose();
			particleMaterial.dispose();
			// Releasing the context explicitly matters because the lab is entered and left
			// repeatedly. dispose() frees what the renderer owns, but the WebGL context is
			// only lost here, and a browser keeps a limited number of them alive, so
			// without this a few round trips through the menu leave contexts behind.
			renderer.forceContextLoss();
			renderer.dispose();
		}
	};
}
