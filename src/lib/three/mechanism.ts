/**
 * The rigid body layer, built on Rapier.
 *
 * The division of labour between this module and the simulation core is the
 * important thing to be clear about, because getting it wrong produces a model
 * that is neither a faithful simulation nor a good game.
 *
 *   The simulation core owns the process. Flow, pressure, actuator force, friction
 *   and controller behaviour are all computed there, at a fixed step, in units an
 *   engineer would recognise. That is where the physics of the lesson lives.
 *
 *   Rapier owns the mechanics of loose and interactive objects: gravity, collision,
 *   stacking, and the objects a student can pick up and throw. It is the right tool
 *   for those and the wrong tool for the process, because a general rigid body
 *   solver has no idea what a flow coefficient is and would need the process
 *   reimplemented as a constraint system to say anything about one.
 *
 * So the two meet at a narrow interface. The simulation tells the mechanism layer
 * where the moving parts are; the mechanism layer tells the simulation when a
 * student has grabbed a part or knocked something into it. Neither owns the
 * other's state.
 *
 * Rapier is loaded through its compatibility build, which bundles the WebAssembly
 * as base64 so there is no separate binary asset to serve. The trade is a larger
 * JavaScript bundle, paid once, in exchange for a build that works from a static
 * host with no MIME type configuration.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import {
	CylinderGeometry,
	Group,
	Mesh,
	MeshStandardMaterial,
	Object3D,
	Quaternion,
	Vector3
} from 'three';
import type { MovingPart, ValveAssembly } from './valveGeometry';
import { BRASS, CAST_IRON, STAINLESS } from './materials';

export interface MechanismHandle {
	/** Add the assembly's moving parts to the rigid body world. */
	attachAssembly(assembly: ValveAssembly): void;
	/** Remove every body belonging to the current assembly. */
	detachAssembly(): void;
	/**
	 * Drive the kinematic bodies from the simulation.
	 *
	 * The opening is a fraction of travel, so the same call works for a sliding
	 * stem and a quarter turn shaft.
	 */
	syncFromSimulation(opening: number): void;
	/** Advance the rigid body world. */
	step(deltaSeconds: number): void;
	/** Objects a student can pick up, and their meshes, for raycasting. */
	readonly grabbables: Object3D[];
	/** Begin dragging an object. Returns false if it is not grabbable. */
	grab(object: Object3D): boolean;
	/** Move the held object toward a world point. */
	dragTo(point: Vector3): void;
	/** Release the held object, optionally throwing it. */
	release(): void;
	/** True while an object is held. */
	readonly holding: boolean;
	/** Spawn a fresh set of loose parts in the tray. */
	resetLooseParts(): void
	/** Bodies currently in the world, for the debug readout. */
	readonly bodyCount: number;
	dispose(): void;
}

/** Where the loose parts sit, relative to the valve. */
const TRAY_OFFSET = new Vector3(-0.22, 0.02, 0.16);

interface BodyRecord {
	body: RAPIER.RigidBody;
	object: Object3D;
}

interface KinematicRecord {
	body: RAPIER.RigidBody;
	part: MovingPart;
	/** Native position at zero opening, captured when the assembly is attached. */
	basePosition: Vector3;
	baseQuaternion: Quaternion;
}

let rapierReady: Promise<void> | null = null;

/**
 * Load the Rapier WebAssembly module once, however many scenes ask for it.
 *
 * The module is a singleton by design: initialising it twice would create two
 * independent wasm heaps, and bodies created against one would be meaningless to
 * the other.
 */
export async function initMechanism(): Promise<void> {
	if (!rapierReady) {
		rapierReady = RAPIER.init();
	}
	await rapierReady;
}

/**
 * Build the rigid body world.
 *
 * Gravity is real, at 9.81 m/s2, because the loose parts are meant to behave the
 * way objects on a workshop floor behave and there is no reason to pretend
 * otherwise.
 */
export async function createMechanism(): Promise<MechanismHandle> {
	await initMechanism();

	const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
	// A fixed step keeps the rigid body behaviour reproducible, matching the
	// approach the simulation core takes.
	world.timestep = 1 / 60;

	// The floor, so loose parts land on something.
	const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.001, 0));
	world.createCollider(RAPIER.ColliderDesc.cuboid(3, 0.001, 3), floorBody);

	const kinematicRecords: KinematicRecord[] = [];
	const bodyRecords: BodyRecord[] = [];
	const grabbables: Object3D[] = [];
	const group = new Group();

	let heldBody: RAPIER.RigidBody | null = null;
	let heldOffset = new Vector3();

	// --- Loose parts --------------------------------------------------------

	const LOOSE_PART_COUNT = 9;

	/** Materials cycled through the loose parts so the pile reads as mixed hardware. */
	const looseMaterials = [STAINLESS, BRASS, CAST_IRON];

	function spawnLooseParts(): void {
		clearLooseParts();

		for (let i = 0; i < LOOSE_PART_COUNT; i++) {
			// Alternating between hex nuts and short bolts, which are the parts that
			// actually end up in a valve tray.
			const isNut = i % 3 !== 0;
			const size = 0.012 + (i % 4) * 0.002;
			const material = looseMaterials[i % looseMaterials.length];

			const mesh = isNut ? buildNutMesh(size, material) : buildBoltMesh(size, material);
			group.add(mesh);

			const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
				.setTranslation(
					TRAY_OFFSET.x + ((i % 3) - 1) * 0.035,
					TRAY_OFFSET.y + 0.03 + Math.floor(i / 3) * 0.03,
					TRAY_OFFSET.z + ((i % 2) - 0.5) * 0.03
				)
				// A little spin so the pile settles unevenly, which looks like a real
				// tray rather than a stack of identical objects.
				.setRotation({
					x: (i % 5) * 0.12,
					y: (i % 7) * 0.09,
					z: (i % 3) * 0.15,
					w: 1
				});

			const body = world.createRigidBody(bodyDesc);

			const colliderDesc = isNut
				? RAPIER.ColliderDesc.cylinder(size * 0.4, size)
				: RAPIER.ColliderDesc.capsule(size * 1.6, size * 0.35);

			world.createCollider(
				colliderDesc.setDensity(7800).setFriction(0.6).setRestitution(0.15),
				body
			);

			bodyRecords.push({ body, object: mesh });
			grabbables.push(mesh);
		}
	}

	function clearLooseParts(): void {
		for (const record of bodyRecords) {
			world.removeRigidBody(record.body);
			record.object.removeFromParent();
			disposeMesh(record.object);
		}
		bodyRecords.length = 0;
		grabbables.length = 0;
		heldBody = null;
	}

	// --- Kinematic parts from the assembly ----------------------------------

	function attachAssembly(assembly: ValveAssembly): void {
		detachAssembly();

		for (const part of assembly.moving) {
			part.object.updateMatrixWorld(true);

			const worldPosition = new Vector3();
			const worldQuaternion = new Quaternion();
			part.object.getWorldPosition(worldPosition);
			part.object.getWorldQuaternion(worldQuaternion);

			const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
				.setTranslation(worldPosition.x, worldPosition.y, worldPosition.z)
				.setRotation({
					x: worldQuaternion.x,
					y: worldQuaternion.y,
					z: worldQuaternion.z,
					w: worldQuaternion.w
				});

			const body = world.createRigidBody(bodyDesc);

			// A generous collider so a loose part can be knocked by the stem. The
			// exact shape of a plug is not what this is for; what matters is that the
			// moving part exists in the world and can push things.
			world.createCollider(
				RAPIER.ColliderDesc.ball(0.02).setFriction(0.4).setRestitution(0.1),
				body
			);

			kinematicRecords.push({
				body,
				part,
				basePosition: worldPosition.clone(),
				baseQuaternion: worldQuaternion.clone()
			});
		}
	}

	function detachAssembly(): void {
		for (const record of kinematicRecords) {
			world.removeRigidBody(record.body);
		}
		kinematicRecords.length = 0;
	}

	// --- Driving and stepping ------------------------------------------------

	function syncFromSimulation(opening: number): void {
		const clamped = Math.min(1, Math.max(0, opening));

		for (const record of kinematicRecords) {
			const { body, part, basePosition, baseQuaternion } = record;

			if (part.kind === 'linear') {
				// Travel is toward open, so the part slides along its axis by the
				// fraction of travel the valve has reached.
				const offset = part.axis.clone().multiplyScalar(part.travel * clamped);
				const target = basePosition.clone().add(offset);
				body.setNextKinematicTranslation({ x: target.x, y: target.y, z: target.z });
			} else {
				const angle = part.travel * clamped;
				const rotation = new Quaternion().setFromAxisAngle(part.axis, angle);
				const target = baseQuaternion.clone().multiply(rotation);
				body.setNextKinematicRotation({
					x: target.x,
					y: target.y,
					z: target.z,
					w: target.w
				});
			}
		}
	}

	function step(deltaSeconds: number): void {
		// Sub step when the frame is long, so a stalled tab does not throw the loose
		// parts across the room.
		const steps = Math.min(4, Math.max(1, Math.round(deltaSeconds / world.timestep)));
		for (let i = 0; i < steps; i++) world.step();

		for (const record of bodyRecords) {
			const translation = record.body.translation();
			const rotation = record.body.rotation();
			record.object.position.set(translation.x, translation.y, translation.z);
			record.object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
		}
	}

	// --- Grabbing ------------------------------------------------------------

	function grab(object: Object3D): boolean {
		const record = bodyRecords.find((candidate) => candidate.object === object);
		if (!record) return false;

		heldBody = record.body;
		// Waking the body is necessary: Rapier sleeps bodies that have settled, and a
		// sleeping body ignores the velocity that a drag applies.
		heldBody.wakeUp();
		heldBody.setGravityScale(0, true);

		const translation = heldBody.translation();
		heldOffset = new Vector3(translation.x, translation.y, translation.z).sub(
			object.position.clone()
		);

		return true;
	}

	function dragTo(point: Vector3): void {
		if (!heldBody) return;

		const target = point.clone().sub(heldOffset);
		const translation = heldBody.translation();
		const current = new Vector3(translation.x, translation.y, translation.z);

		// Move by velocity rather than by teleporting, so the held object pushes
		// other bodies instead of passing through them.
		const delta = target.sub(current).multiplyScalar(8);
		heldBody.setLinvel({ x: delta.x, y: delta.y, z: delta.z }, true);
	}

	function release(): void {
		if (!heldBody) return;
		heldBody.setGravityScale(1, true);
		heldBody = null;
	}

	function dispose(): void {
		clearLooseParts();
		detachAssembly();
		world.free();
	}

	spawnLooseParts();

	return {
		attachAssembly,
		detachAssembly,
		syncFromSimulation,
		step,
		grabbables,
		grab,
		dragTo,
		release,
		get holding() {
			return heldBody !== null;
		},
		resetLooseParts: spawnLooseParts,
		get bodyCount() {
			return world.bodies.len();
		},
		dispose
	};
}

/**
 * A hex nut, drawn as a six sided prism.
 *
 * The loose parts own their geometry outright rather than going through the
 * assembly registry, so `disposeMesh` frees it by walking the mesh. That keeps the
 * tray independent of whichever valve is currently loaded.
 */
function buildNutMesh(sizeM: number, material: MeshStandardMaterial): Mesh {
	const geometry = new CylinderGeometry(sizeM, sizeM * 1.15, sizeM * 0.5, 6);
	return new Mesh(geometry, material);
}

/** A short bolt, drawn as a plain shaft. */
function buildBoltMesh(sizeM: number, material: MeshStandardMaterial): Mesh {
	const geometry = new CylinderGeometry(sizeM * 0.3, sizeM * 0.3, sizeM * 3.2, 10);
	return new Mesh(geometry, material);
}

/** Free the geometry of a loose part when it is removed. */
function disposeMesh(object: Object3D): void {
	object.traverse((child) => {
		if (child instanceof Mesh) {
			child.geometry.dispose();
		}
	});
}
