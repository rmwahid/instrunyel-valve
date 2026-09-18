/**
 * The animation driver: it reads simulation state and moves the 3D parts.
 *
 * This is the only module that knows about both the simulation and the scene, and
 * it does nothing else. Keeping it thin is deliberate: any logic that ends up here
 * would be logic that cannot be tested, because testing it would need a renderer.
 * Everything that can be decided from numbers alone lives in the simulation core.
 */

import { Object3D, Quaternion, Vector3 } from 'three';
import type { SceneHandle } from './scene';
import type { MechanismHandle } from './mechanism';
import type { MovingPart, ValveAssembly } from './valveGeometry';
import { FLUID_GAS, FLUID_STEAM, FLUID_WATER } from './materials';
import type { FluidPhase } from '$lib/sim/fluids';

/**
 * A moving part with its rest transform captured, so the driver can apply an
 * absolute transform every frame rather than accumulating deltas.
 *
 * Accumulating would drift: a floating point error in each frame would add up and
 * the stem would slowly wander out of the body.
 */
interface BoundPart {
	part: MovingPart;
	restPosition: Vector3;
	restQuaternion: Quaternion;
}

export interface AnimationDriver {
	/** Point the driver at a new assembly, releasing the old one. */
	bind(assembly: ValveAssembly): void;
	/**
	 * Hand the rigid body layer over once it has loaded, or null while it is absent.
	 *
	 * The mechanism arrives after the first frame, because its WebAssembly module is the
	 * largest thing the lab downloads and nothing on screen waits for it. Whatever
	 * assembly is already bound is attached at the moment it arrives, so the loose parts
	 * can be knocked by a valve that is already moving.
	 */
	setMechanism(mechanism: MechanismHandle | null): void;
	/** Drive the bound assembly from a simulation snapshot. */
	update(state: {
		/** Valve opening, 0 to 1. */
		opening: number;
		/** Volume flow in m3/h, for the particle field. */
		flowM3PerHour: number;
		/** Normalising flow, so the visual speed is comparable between valves. */
		referenceFlowM3PerHour: number;
		/** Phase of the fluid, which selects the colour. */
		fluidPhase: FluidPhase;
		/** True when the sizing equations report cavitation or flashing. */
		cavitating: boolean;
		/** Whether to draw the flow at all. */
		showFlow: boolean;
		/** Length of pipe the particles travel along, metres. */
		pipeLengthM: number;
		/** Radius of the pipe bore, metres. */
		pipeRadiusM: number;
	}): void;
	/**
	 * Move a part manually, for the mechanism sandbox where a student drags the
	 * handwheel and the simulation is told about it afterwards.
	 */
	setPartOffset(part: Object3D, offset: Vector3): void;
}

const FLOW_COLORS: Record<FluidPhase, string> = {
	liquid: '#3fa9d8',
	steam: '#d8d2c8',
	gas: '#9fb4c4'
};

/** Pick the fluid material whose colour matches a phase, for consistency in the panel. */
export function fluidColorForPhase(phase: FluidPhase): string {
	return FLOW_COLORS[phase];
}

/** Material to use for the fluid body in the cutaway, by phase. */
export function fluidMaterialForPhase(phase: FluidPhase) {
	switch (phase) {
		case 'liquid':
			return FLUID_WATER;
		case 'steam':
			return FLUID_STEAM;
		case 'gas':
			return FLUID_GAS;
	}
}

export function createAnimationDriver(scene: SceneHandle): AnimationDriver {
	let bound: BoundPart[] = [];
	let mechanism: MechanismHandle | null = null;
	/**
	 * The assembly currently in the scene, remembered so the mechanism can be attached to
	 * it when the mechanism arrives after the driver has already been bound.
	 */
	let boundAssembly: ValveAssembly | null = null;

	function bind(assembly: ValveAssembly): void {
		bound = assembly.moving.map((part) => {
			// Capture the rest transform before anything moves, so every later frame
			// can be computed as an absolute transform from this baseline.
			const restQuaternion = new Quaternion();
			part.object.getWorldQuaternion(restQuaternion);
			const restPosition = new Vector3();
			part.object.getWorldPosition(restPosition);

			return { part, restPosition, restQuaternion };
		});

		mechanism?.attachAssembly(assembly);
	}

	function setMechanism(next: MechanismHandle | null): void {
		mechanism = next;
		if (mechanism && boundAssembly) mechanism.attachAssembly(boundAssembly);
	}

	function update(state: {
		opening: number;
		flowM3PerHour: number;
		referenceFlowM3PerHour: number;
		fluidPhase: FluidPhase;
		cavitating: boolean;
		showFlow: boolean;
		pipeLengthM: number;
		pipeRadiusM: number;
	}): void {
		const clamped = Math.min(1, Math.max(0, state.opening));

		// --- Mechanical motion ------------------------------------------------
		for (const { part, restPosition, restQuaternion } of bound) {
			if (part.kind === 'linear') {
				const offset = part.axis.clone().multiplyScalar(part.travel * clamped);
				part.object.position.copy(restPosition).add(offset);
			} else {
				// The rotation is about the part's own axis, applied on top of its
				// rest orientation so a part that starts out tilted still turns
				// about the right axis.
				const rotation = new Quaternion().setFromAxisAngle(part.axis, part.travel * clamped);
				part.object.quaternion.copy(restQuaternion).multiply(rotation);
			}
		}

		// --- Rigid body mirror -------------------------------------------------
		mechanism?.syncFromSimulation(clamped);

		// --- Flow visualisation ------------------------------------------------
		scene.setFlow({
			visible: state.showFlow,
			flowM3PerHour: state.flowM3PerHour,
			referenceFlowM3PerHour: state.referenceFlowM3PerHour,
			colorHex: FLOW_COLORS[state.fluidPhase],
			cavitating: state.cavitating,
			pipeLengthM: state.pipeLengthM,
			pipeRadiusM: state.pipeRadiusM
		});
	}

	function setPartOffset(part: Object3D, offset: Vector3): void {
		const record = bound.find((candidate) => candidate.part.object === part);
		if (!record) return;
		record.part.object.position.copy(record.restPosition).add(offset);
	}

	return { bind, setMechanism, update, setPartOffset };
}

export type { MovingPart, ValveAssembly };
