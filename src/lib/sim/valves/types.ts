/**
 * The valve contract every valve type in the catalogue implements.
 *
 * The point of this interface is that the engine does not care what kind of
 * valve it is driving. It asks for a flow coefficient at the current opening and
 * for the forces holding the plug in place; everything specific to a gate, ball
 * or butterfly trim lives in that valve's own module.
 */

import type { ActuatorSpec } from '../actuator';
import type { FrictionSpec } from '../friction';
import type { Fluid, FluidPhase } from '../fluids';
import type { InherentCharacteristic } from '../characteristic';
export type ValveFamily =
	/** Sliding stem, linear motion, used for isolation and throttling. */
	| 'linear'
	/** Quarter turn, rotary motion. */
	| 'rotary'
	/** Self acting, does not need an external signal. */
	| 'selfActing'
	/** Actuated on-off only. */
	| 'onOff';

export type ActuationType =
	| 'manual'
	| 'pneumaticSpringDiaphragm'
	| 'pneumaticPiston'
	| 'electricMotor'
	| 'solenoid'
	| 'selfActing';

export interface ValvePort {
	/** Nominal size in inches. */
	nominalSizeInch: number;
	/** Port area the plug closes against, m2. */
	portAreaM2: number;
	/** Area of the balance seal, m2. Equal to the port area for a fully balanced plug. */
	balanceSealAreaM2: number;
}

export interface ValveSpec {
	readonly id: string;
	readonly name: string;
	readonly family: ValveFamily;
	readonly actuation: ActuationType;
	/** Capacity of the valve when wide open, in Kv. */
	readonly ratedKv: number;
	/** Shape of the inherent characteristic. */
	readonly characteristic: InherentCharacteristic;
	readonly rangeability: number;
	/** Rangeability is meaningless for a quick opening trim, which is why it is optional in display. */
	readonly ports: ValvePort;
	/** Liquid pressure recovery factor FL. */
	readonly pressureRecoveryFactor: number;
	/** Terminal pressure drop ratio xT for compressible flow. */
	readonly terminalPressureDropRatio: number;
	/** Sigma at which cavitation becomes audible. */
	readonly incipientCavitationSigma: number;
	readonly friction: FrictionSpec;
	/** Actuator, or null for a valve that has none (a check valve, for example). */
	readonly actuator: ActuatorSpec | null;
	/** Phases this valve is normally applied to. */
	readonly suitablePhases: readonly FluidPhase[];
	/** Typical services, shown in the catalogue. */
	readonly typicalServices: readonly string[];
	/** Short summary used on the catalogue card. */
	readonly summary: string;
}

export interface ValveRuntimeState {
	/** Stem or shaft position as a fraction of full travel, 0..1. */
	opening: number;
	/** Position in metres for a linear valve, radians for a rotary valve. */
	positionNative: number;
	velocityNative: number;
	/** Friction force resolved this step, N. */
	frictionForceN: number;
	/** Fluid reaction force on the plug, N. */
	fluidForceN: number;
	/** Air pressure delivered to the actuator, bar gauge. Null when not pneumatic. */
	airPressureBar: number | null;
}

export interface FlowCoefficientInput {
	/** Travel as a fraction, 0..1. */
	opening: number;
	fluid: Fluid;
	/** True when the flow direction pushes the plug toward open. */
	flowToOpen: boolean;
}

/**
 * A valve in the catalogue.
 *
 * `flowCoefficient` is the heart of each valve model: it converts a position into
 * the effective Kv, and for a few valve types it also depends on the flow
 * direction or on the fluid, which is precisely the behaviour worth teaching.
 */
export interface ValveModel {
	readonly spec: ValveSpec;
	/** Effective flow coefficient in Kv at the given opening and conditions. */
	flowCoefficient(input: FlowCoefficientInput): number;
	/**
	 * Fluid force on the plug in the opening direction, newtons.
	 *
	 * `opening` is passed because the force is not always a simple function of the
	 * pressure drop. A butterfly disc, for example, sees its highest torque at
	 * part travel rather than at either extreme.
	 */
	fluidForce(pressureDropBar: number, flowToOpen: boolean, opening: number): number;
	/**
	 * Position representing fully shut, in native units.
	 *
	 * A valve whose flow is not described by a flow coefficient can take over the
	 * flow calculation entirely, see `computeFlow`.
	 */
	closedPosition(): number;
	/** Position representing fully open, in native units. */
	openPosition(): number;
	/** Convert native position to a 0..1 opening fraction. */
	toOpening(positionNative: number): number;
	/** Convert a 0..1 opening fraction to native position. */
	fromOpening(opening: number): number;
	/**
	 * True when this valve only has two meaningful positions.
	 * On-off valves still report a continuous opening so the visual can animate,
	 * but the lessons treat them differently.
	 */
	isOnOff(): boolean;
	/**
	 * Optional flow law for a valve whose capacity is not described by a flow
	 * coefficient.
	 *
	 * A relief valve is the case this exists for. It is sized on an orifice area and
	 * a discharge coefficient rather than on a Kv, because a certifying authority
	 * requires the relief capacity to be traceable to an orifice measurement, not to
	 * a flow coefficient that depends on the body. Returning a flow coefficient of
	 * zero for such a valve and leaving the generic sizing equation to run would
	 * silently compute no flow at all, so the valve is allowed to state its own law.
	 *
	 * When this method is present the engine uses it and ignores the flow
	 * coefficient entirely.
	 */
	computeFlow?(input: ValveFlowInput): ValveFlowOutput;
	/**
	 * Optional opening law for a self acting valve whose position is not a simple
	 * spring ramp.
	 *
	 * A relief valve is again the case this exists for. Its position depends not
	 * only on the pressure but on whether it is already open, because the blowdown
	 * that keeps it from chattering is hysteresis by design. That makes the law
	 * stateful, and the state belongs to the engine rather than to the model, so the
	 * law receives the previous state as an argument and returns the next position.
	 *
	 * Without this the engine falls back to the plain spring characteristic, which is
	 * the right description of a check valve.
	 */
	computeOpening?(input: ValveOpeningInput): number;
}

/** Input to a valve's own opening law. */
export interface ValveOpeningInput {
	/**
	 * Pressure difference acting to open the valve, bar.
	 *
	 * For a relief valve this is the vessel pressure minus the discharge pressure.
	 */
	pressureDifferenceBar: number;
	/** True when the valve was open at the previous step. */
	wasOpen: boolean;
	/** Fluid the valve is working on, when the law depends on the phase. */
	fluid: Fluid;
}

/**
 * Everything a valve needs to compute its own flow.
 *
 * The base of this is the same input the generic sizing equation takes, so a valve
 * that implements its own law still receives the pressures, the fluid and the
 * opening the same way.
 */
export interface ValveFlowInput extends FlowCoefficientInput {
	/** Upstream absolute pressure, bar. */
	upstreamPressureBar: number;
	/** Downstream absolute pressure, bar. */
	downstreamPressureBar: number;
	/** Flowing temperature, K. */
	temperatureK: number;
	/** Pressure drop across the valve, bar. */
	pressureDropBar: number;
	/**
	 * Fluid density at upstream conditions, kg/m3.
	 *
	 * Passed in because the valve law may need it for a volumetric flow, and
	 * recomputing it from the fluid would duplicate a calculation the engine has
	 * already done.
	 */
	densityKgPerM3: number;
	/**
	 * Molar mass in kg/mol, present when the fluid is a gas or vapour.
	 *
	 * A valve law that works in molar terms, such as the relief capacity equation,
	 * needs it and is expected to fall back to a default when it is absent.
	 */
	molarMassKgPerMol?: number;
	/** Ratio of specific heats, present when the fluid is a gas or vapour. */
	specificHeatRatio?: number;
}

export interface ValveFlowOutput {
	/** Mass flow through the valve, kg/h. */
	massFlowKgPerHour: number;
	/** Volumetric flow at upstream conditions, m3/h. */
	volumetricFlowM3PerHour: number;
	/** Pressure drop the law used, bar. */
	effectivePressureDropBar: number;
	/** True when the flow is limited by the valve rather than by the system. */
	choked: boolean;
	/** Free text notes the valve wants shown, such as the standard it applied. */
	notes?: readonly string[];
}

/** True when this valve is normally applied to the given fluid phase. */
export function isLiquidSuitable(spec: ValveSpec, fluid: Fluid): boolean {
	return spec.suitablePhases.includes(fluid.phase);
}
