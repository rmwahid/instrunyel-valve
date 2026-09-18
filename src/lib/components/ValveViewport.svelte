<script lang="ts">
	/**
	 * The 3D viewport.
	 *
	 * The component owns the WebGL context, the geometry and the render loop, and
	 * nothing else. It receives a snapshot of simulation state and draws it; every
	 * decision about what that snapshot means was made upstream. That split keeps
	 * the expensive part of the application isolated from the part that has to be
	 * correct, which is the physics.
	 *
	 * The render loop and the simulation advance on the same animation frame, so
	 * there is no separate timer to keep in step.
	 */
	import { onMount } from 'svelte';
	import { Raycaster, Vector2 } from 'three';
	import { createScene, type SceneHandle } from '$lib/three/scene';
	import { createAnimationDriver, type AnimationDriver } from '$lib/three/driver';
	import type { MechanismHandle } from '$lib/three/mechanism';
	import { buildValveAssembly, type ValveAssembly } from '$lib/three/valveGeometry';
	import type { FluidPhase } from '$lib/sim/fluids';
	import type { ValveId } from '$lib/sim/valves/catalogue';

	interface Props {
		valveId: ValveId;
		nominalSizeInch: number;
		strokeM: number;
		withPositioner: boolean;
		withHandwheel: boolean;
		balanced: boolean;
		setPressureBarGauge: number;
		/** Valve opening, 0 to 1. */
		opening: number;
		flowM3PerHour: number;
		referenceFlowM3PerHour: number;
		fluidPhase: FluidPhase;
		cavitating: boolean;
		showFlow: boolean;
		showShell: boolean;
		showFloor: boolean;
		/**
		 * Section view, which cuts the assembly open with a clipping plane.
		 *
		 * Different from hiding the casing: a cut goes through every part at once, so
		 * the wall thickness and the internals appear as a hacksaw through the valve
		 * would reveal them, rather than as a model with a piece removed.
		 */
		sectionView: boolean;
		/** How far to slide the cut along the view direction, 0 at the centre. */
		sectionOffset: number;
		/** Called every frame so the parent can advance the simulation. */
		onTick: (deltaSeconds: number) => void;
	}

	let {
		valveId,
		nominalSizeInch,
		strokeM,
		withPositioner,
		withHandwheel,
		balanced,
		setPressureBarGauge,
		opening,
		flowM3PerHour,
		referenceFlowM3PerHour,
		fluidPhase,
		cavitating,
		showFlow,
		showShell,
		showFloor,
		sectionView,
		sectionOffset,
		onTick
	}: Props = $props();

	let canvas: HTMLCanvasElement;
	let container: HTMLDivElement;

	// Scene objects are plain module level variables rather than reactive state.
	// They are imperative handles to GPU and wasm resources, and making them
	// reactive would cause Svelte to try to track them deeply, which is both
	// pointless and slow.
	// State rather than a plain variable: every effect that applies a display option
	// waits for the scene to exist, and without reactivity none of them re-runs when it
	// does. Raw because the handle's members are Three.js class instances and only the
	// assignment has to be reactive.
	let scene = $state.raw<SceneHandle | null>(null);
	let driver: AnimationDriver | null = null;
	let mechanism: MechanismHandle | null = null;
	let assembly: ValveAssembly | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let ready = $state(false);

	let loading = $state(true);
	let error = $state<string | null>(null);
	/** Name of the part currently under the pointer, for the inspection readout. */
	let hoveredPart = $state<string | null>(null);

	const raycaster = new Raycaster();
	const pointer = new Vector2();

	/**
	 * The latest simulation snapshot, held in a plain object the frame callback
	 * reads.
	 *
	 * The render loop runs outside Svelte's reactivity, so reading the props
	 * directly inside it would capture whatever they were when the loop started.
	 * Copying them into a mutable holder each time they change keeps the callback
	 * correct without making the loop reactive.
	 */
	const snapshot = {
		opening: 0,
		flowM3PerHour: 0,
		referenceFlowM3PerHour: 1,
		fluidPhase: 'liquid' as FluidPhase,
		cavitating: false,
		showFlow: true
	};

	$effect(() => {
		snapshot.opening = opening;
		snapshot.flowM3PerHour = flowM3PerHour;
		snapshot.referenceFlowM3PerHour = referenceFlowM3PerHour;
		snapshot.fluidPhase = fluidPhase;
		snapshot.cavitating = cavitating;
		snapshot.showFlow = showFlow;
	});

	/** Pipe dimensions for the particle field, derived from the valve size. */
	function pipeDimensions(): { lengthM: number; radiusM: number } {
		const bore = (nominalSizeInch * 25.4) / 1000;
		return { lengthM: bore * 4.4, radiusM: bore * 0.34 };
	}

	/** Build or replace the valve geometry. */
	function rebuildAssembly(): void {
		if (!scene || !driver) return;

		if (assembly) {
			mechanism?.detachAssembly();
			assembly.root.removeFromParent();
			assembly.dispose();
			assembly = null;
		}

		assembly = buildValveAssembly(valveId, {
			nominalSizeInch,
			strokeM,
			withPositioner,
			withHandwheel,
			balanced,
			setPressureBarGauge
		});

		scene.valveGroup.add(assembly.root);
		driver.bind(assembly);
		scene.frameOn(assembly.heightM, assembly.lengthM);
		applyShellVisibility();
	}

	/**
	 * Show or hide the outer castings.
	 *
	 * Hiding a casting does not hide the trim inside it: the point of the section
	 * view is to see the plug, the seat and the flow path, so only the parts that
	 * stand between the camera and the internals are removed.
	 */
	function applyShellVisibility(): void {
		if (!assembly) return;
		for (const cuttable of assembly.cuttables) {
			cuttable.visible = showShell;
		}
	}

	function handlePointerMove(event: PointerEvent): void {
		if (!scene || !assembly) return;

		const rect = canvas.getBoundingClientRect();
		pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		raycaster.setFromCamera(pointer, scene.camera);

		const movingObjects = assembly.moving.map((part) => part.object);
		const hits = raycaster.intersectObjects(movingObjects, true);

		if (hits.length === 0) {
			hoveredPart = null;
			canvas.style.cursor = 'default';
			return;
		}

		// Walk up from the hit mesh to the registered moving part, so a hit on any
		// child reports the part the student thinks they are pointing at.
		let object = hits[0].object;
		while (object && !movingObjects.includes(object)) {
			object = object.parent as typeof object;
		}

		const record = assembly.moving.find((part) => part.object === object);
		hoveredPart = record?.label ?? null;
		canvas.style.cursor = record ? 'pointer' : 'default';
	}

	// React to geometry option changes by rebuilding. The valve identity is
	// included because a different valve is a different assembly entirely.
	$effect(() => {
		void valveId;
		void nominalSizeInch;
		void strokeM;
		void withPositioner;
		void withHandwheel;
		void balanced;
		void setPressureBarGauge;
		if (ready) rebuildAssembly();
	});

	$effect(() => {
		void showShell;
		if (ready) applyShellVisibility();
	});

	$effect(() => {
		void showFloor;
		if (ready) scene?.setFloorVisible(showFloor);
	});

	// The section plane is moved rather than rebuilt, so sliding the cut is smooth and
	// does not touch the geometry.
	$effect(() => {
		void sectionView;
		void sectionOffset;
		if (!ready || !scene) return;
		// The plane is vertical whatever the camera is doing, because that is what a
		// section drawing is: a cut through the valve's own axis, viewed from the side.
		//
		// Projecting the camera direction onto the horizontal plane gives a plane that
		// always faces the viewer while staying upright. Taking the camera direction
		// itself instead would tilt the plane as the camera rose, which on a tall
		// assembly like a control valve cuts the actuator and leaves the body intact.
		const axisPoint = scene.controls.target;
		const toCamera = scene.camera.position.clone().sub(axisPoint);
		toCamera.y = 0;
		if (toCamera.lengthSq() < 1e-9) toCamera.set(0, 0, 1);

		// The normal faces away from the camera, which removes the half of the valve
		// nearest the viewer and opens the cut toward them. Facing it at the camera
		// instead removes the far half, and the result looks like an uncut valve because
		// the surface already visible survives the cut.
		const normal = toCamera.normalize().negate();

		// The plane passes through the point the camera is looking at, which sits on the
		// flow axis, so the cut runs through the valve rather than beside it.
		scene.setSectionView({
			enabled: sectionView,
			normal,
			offset: normal.dot(axisPoint) + sectionOffset
		});
	});

	onMount(() => {
		let cancelled = false;

		/**
		 * Load the rigid body layer in the background.
		 *
		 * It is imported dynamically so its WebAssembly module stays out of the route's
		 * bundle. That module is the largest download in the lab, and nothing on screen waits
		 * for it: the valve is moved by the driver applying transforms, so the mechanism only
		 * adds the loose hardware on the tray and the parts a student can drag.
		 */
		async function loadMechanism() {
			try {
				const { createMechanism } = await import('$lib/three/mechanism');
				const created = await createMechanism();

				// The viewport was left while the module was loading, so nothing here owns the
				// result: dispose it instead of leaving a wasm heap and a scene graph alive.
				if (cancelled) {
					created.dispose();
					return;
				}

				mechanism = created;
				driver?.setMechanism(created);
			} catch (cause) {
				// Deliberately not raised into the overlay: that one explains a failure to
				// start the 3D view, and the lab is fully usable without the rigid body layer.
				console.error('The rigid body layer could not be loaded.', cause);
			}
		}

		function boot() {
			try {
				scene = createScene({
					canvas,
					onFrame: (deltaSeconds) => {
						onTick(deltaSeconds);

						if (driver && assembly) {
							const { lengthM, radiusM } = pipeDimensions();
							driver.update({
								opening: snapshot.opening,
								flowM3PerHour: snapshot.flowM3PerHour,
								referenceFlowM3PerHour: snapshot.referenceFlowM3PerHour,
								fluidPhase: snapshot.fluidPhase,
								cavitating: snapshot.cavitating,
								showFlow: snapshot.showFlow,
								pipeLengthM: lengthM,
								pipeRadiusM: radiusM
							});
						}

						mechanism?.step(deltaSeconds);
						scene?.resize();
					}
				});

				driver = createAnimationDriver(scene);

				scene.resize();
				ready = true;
				// Nothing is applied here on purpose. Setting `ready` re-runs every effect
				// that waits on it, in the order they were declared, which is the same
				// order the appliers have to run in: geometry first, then the views. Doing
				// it here as well is how the section came to be the one option that was
				// never applied on a cold load.
				scene.start();

				loading = false;

				void loadMechanism();
			} catch (cause) {
				error = cause instanceof Error ? cause.message : String(cause);
				loading = false;
			}
		}

		void boot();

		resizeObserver = new ResizeObserver(() => scene?.resize());
		resizeObserver.observe(container);

		return () => {
			cancelled = true;
			ready = false;
			resizeObserver?.disconnect();
			resizeObserver = null;
			mechanism?.detachAssembly();
			assembly?.dispose();
			assembly = null;
			driver = null;
			mechanism?.dispose();
			mechanism = null;
			scene?.dispose();
			scene = null;
		};
	});
</script>

<div class="viewport" bind:this={container}>
	<canvas bind:this={canvas} onpointermove={handlePointerMove}></canvas>

	{#if hoveredPart}
		<div class="hover-readout">
			<span class="label">Inspecting</span>
			<strong>{hoveredPart}</strong>
		</div>
	{/if}

	{#if loading}
		<div class="overlay">
			<div class="spinner"></div>
			<p>Building the valve</p>
		</div>
	{/if}

	{#if error}
		<div class="overlay error">
			<strong>The 3D view could not start</strong>
			<p>{error}</p>
			<p class="dim">
				This view needs WebGL. The instrument panels and the simulation still work without it.
			</p>
		</div>
	{/if}
</div>

<style>
	.viewport {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 320px;
		background: var(--surface-0);
		overflow: hidden;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;
	}

	.hover-readout {
		position: absolute;
		top: 12px;
		left: 12px;
		background: rgb(11 15 19 / 0.88);
		border: 1px solid var(--line-2);
		border-radius: var(--radius-sm);
		padding: 5px 10px;
		backdrop-filter: blur(6px);
		pointer-events: none;
	}

	.hover-readout strong {
		display: block;
		font-size: 12.5px;
		color: var(--accent);
	}

	.overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		background: rgb(11 15 19 / 0.92);
		text-align: center;
		padding: 24px;
	}

	.overlay p {
		color: var(--text-2);
		font-size: 13px;
		max-width: 46ch;
	}

	.overlay.error strong {
		color: var(--fault);
	}

	.spinner {
		width: 26px;
		height: 26px;
		border: 2px solid var(--line-2);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 2s;
		}
	}
</style>
