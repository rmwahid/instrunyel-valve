/**
 * Sliding stem valves: gate, globe and the control valve.
 *
 * All three share a stem that moves linearly along its axis, and all three are
 * unbalanced plugs unless the trim is explicitly balanced. What separates them is
 * the flow path: a gate slides a flat disc across the bore, a globe forces the
 * fluid through an S-shaped passage, and a control valve adds a characterised
 * plug and a positioner so the flow can be steered rather than just stopped.
 */

import {
	DEFAULT_POSITIONER_GAIN_BAR_PER_M,
	DEFAULT_POSITIONER_INTEGRAL_BAR_PER_M_PER_S,
	type ActuatorSpec,
	travelFraction
} from '../actuator';
import { relativeCapacity, type InherentCharacteristic } from '../characteristic';
import { FRICTION_PRESETS } from '../friction';
import { diameterMmToAreaM2, inchToMm, psiToBar } from '../units';
import type { ValveFamily, ValveModel, ValveSpec } from './types';

interface LinearValveOptions {
	nominalSizeInch: number;
	ratedKv: number;
	characteristic: InherentCharacteristic;
	rangeability: number;
	actuator: ActuatorSpec | null;
	pressureRecoveryFactor: number;
	terminalPressureDropRatio: number;
	incipientCavitationSigma: number;
	friction: ValveSpec['friction'];
	/** Fraction of the port area carried by the balance seal. Zero for an unbalanced plug. */
	balanceFraction?: number;
	/** Fraction of the theoretical unbalance that reaches the stem. */
	forceCoefficient?: number;
	family?: ValveFamily;
	actuation?: ValveSpec['actuation'];
}

/**
 * Build a sliding stem valve from a trim description.
 *
 * Everything that differs between a gate, a globe and a control valve is a
 * number in this description, so the shared mechanics live in one place.
 */
function createLinearValve(
	spec: ValveSpec,
	balanceFraction: number,
	forceCoefficient: number,
	extraForce: (opening: number, pressureDropBar: number) => number = () => 0
): ValveModel {
	const strokeM = spec.actuator?.strokeM ?? 0.04;

	return {
		spec,
		flowCoefficient({ opening }): number {
			if (opening <= 0) return 0;
			return spec.ratedKv * relativeCapacity(spec.characteristic, opening, {
				rangeability: spec.rangeability
			});
		},
		fluidForce(pressureDropBar, flowToOpen, opening): number {
			const unbalancedAreaM2 = spec.ports.portAreaM2 * (1 - balanceFraction);
			const magnitude =
				Math.abs(pressureDropBar) * 1e5 * unbalancedAreaM2 * forceCoefficient;
			const direction = flowToOpen ? 1 : -1;
			return direction * magnitude + extraForce(opening, pressureDropBar);
		},
		closedPosition(): number {
			return 0;
		},
		openPosition(): number {
			return strokeM;
		},
		toOpening(positionNative: number): number {
			return Math.min(1, Math.max(0, positionNative / strokeM));
		},
		fromOpening(opening: number): number {
			return Math.min(1, Math.max(0, opening)) * strokeM;
		},
		isOnOff(): boolean {
			return false;
		}
	};
}

// ---------------------------------------------------------------------------
// Gate valve
// ---------------------------------------------------------------------------

export interface GateValveOptions {
	nominalSizeInch?: number;
	ratedKv?: number;
	actuator?: ActuatorSpec | null;
}

/**
 * Gate valve: a flat disc slides across the flow path.
 *
 * The open area is the slot the disc uncovers, whose height grows with lift, so
 * the capacity curve is close to linear over most of the travel. That linearity
 * is misleading, because a partly open gate sits in the flow and vibrates: the
 * disc is only supported at the top of its travel and the flow excites it. Gate
 * valves are therefore isolation valves. The lab keeps the linear curve because
 * it is what the geometry gives, and explains why the curve is not the reason to
 * choose this valve.
 *
 * A gate valve also suffers from the largest unbalance of the common types, since
 * the full bore area carries the pressure drop and nothing balances it. That is
 * why a large gate valve needs a correspondingly large actuator or a bypass.
 */
export function createGateValve(options: GateValveOptions = {}): ValveModel {
	const nominalSizeInch = options.nominalSizeInch ?? 2;
	const boreMm = inchToMm(nominalSizeInch);

	const spec: ValveSpec = {
		id: 'gate',
		name: 'Gate valve',
		family: 'linear',
		actuation: options.actuator ? 'pneumaticSpringDiaphragm' : 'manual',
		ratedKv: options.ratedKv ?? 130,
		characteristic: 'linear',
		rangeability: 20,
		ports: {
			nominalSizeInch,
			portAreaM2: diameterMmToAreaM2(boreMm),
			balanceSealAreaM2: 0
		},
		// A gate valve is a straight through path with very little turning, so it
		// recovers pressure well and cavitates more readily than a globe valve.
		pressureRecoveryFactor: 0.75,
		terminalPressureDropRatio: 0.6,
		incipientCavitationSigma: 2.0,
		friction: FRICTION_PRESETS.graphite,
		actuator: options.actuator ?? null,
		suitablePhases: ['liquid', 'gas', 'steam'],
		typicalServices: ['Isolation', 'Block valve', 'Tank outlet', 'Bypass'],
		summary:
			'A straight through isolation valve with a sliding disc. Almost no pressure drop when wide open, but it vibrates if it is used to throttle.'
	};

	// Unbalanced plug, and the full disc area takes the load.
	return createLinearValve(spec, 0, 0.85);
}

// ---------------------------------------------------------------------------
// Globe valve
// ---------------------------------------------------------------------------

export interface GlobeValveOptions {
	nominalSizeInch?: number;
	ratedKv?: number;
	characteristic?: InherentCharacteristic;
	actuator?: ActuatorSpec | null;
	/** True when the plug is balanced by a seal, as used on high pressure drop service. */
	balanced?: boolean;
}

/**
 * Globe valve: the flow turns twice through an S-shaped passage.
 *
 * The globes's defining feature is not its trim but its pressure recovery. The
 * repeated changes of direction destroy kinetic energy that a straight through
 * valve would have recovered, so the pressure at the vena contracta stays high
 * and cavitation is much less likely. The price is a pressure drop that is
 * several times larger than a gate valve of the same size when wide open, which
 * is exactly the trade a throttling valve wants: it needs pressure drop to work
 * against.
 *
 * A globe valve is also the easiest valve to repair, because the seat and plug
 * are reached by lifting the bonnet without removing the body from the line.
 */
export function createGlobeValve(options: GlobeValveOptions = {}): ValveModel {
	const nominalSizeInch = options.nominalSizeInch ?? 2;
	const boreMm = inchToMm(nominalSizeInch);
	const balanced = options.balanced ?? false;

	const spec: ValveSpec = {
		id: 'globe',
		name: 'Globe valve',
		family: 'linear',
		actuation: options.actuator ? 'pneumaticSpringDiaphragm' : 'manual',
		ratedKv: options.ratedKv ?? 40,
		characteristic: options.characteristic ?? 'linear',
		rangeability: 30,
		ports: {
			nominalSizeInch,
			// The seat port is narrower than the bore, which is part of why a globe
			// valve drops more pressure than a gate valve.
			portAreaM2: diameterMmToAreaM2(boreMm * 0.75),
			balanceSealAreaM2: balanced ? diameterMmToAreaM2(boreMm * 0.7) : 0
		},
		// Low recovery: FL near 0.9 is characteristic of globe style bodies.
		pressureRecoveryFactor: 0.9,
		terminalPressureDropRatio: 0.72,
		incipientCavitationSigma: 1.7,
		friction: FRICTION_PRESETS.graphite,
		actuator: options.actuator ?? null,
		suitablePhases: ['liquid', 'gas', 'steam'],
		typicalServices: ['Throttling', 'Steam', 'High pressure drop', 'Small line size'],
		summary:
			'A throttling valve with a tortuous flow path. Low pressure recovery, so it resists cavitation; the price is a higher pressure drop when wide open.'
	};

	return createLinearValve(spec, balanced ? 0.7 : 0, 0.8);
}

// ---------------------------------------------------------------------------
// Control valve
// ---------------------------------------------------------------------------

export interface ControlValveOptions {
	nominalSizeInch?: number;
	ratedKv?: number;
	characteristic?: InherentCharacteristic;
	rangeability?: number;
	balanced?: boolean;
	/** True when the actuator carries a positioner. */
	withPositioner?: boolean;
	/** Positioner proportional gain, bar per metre of error. */
	positionerGainBarPerM?: number;
	/** Positioner integral rate, bar per metre of error per second. */
	positionerIntegralBarPerMetrePerSecond?: number;
	/** Air supply pressure, bar gauge. */
	supplyPressureBar?: number;
	/** Actuator area in m2. Overrides the size derived from the valve size. */
	effectiveAreaM2?: number;
	strokeM?: number;
	/** Which way the valve fails when instrument air is lost. */
	failAction?: 'failClosed' | 'failOpen';
	/** True when flow enters below the plug and pushes it open. */
	flowToOpen?: boolean;
}

/**
 * Control valve: a globe body with a characterised plug, a spring diaphragm
 * actuator and usually a positioner.
 *
 * This is the valve the lab revolves around, because it is the one that is asked
 * to sit at an arbitrary position and stay there. Three things make that hard,
 * and the model reproduces all three:
 *
 *  - The plug is unbalanced, so the force the fluid applies to it changes with
 *    the pressure drop. The controller commands a position; the actuator
 *    delivers a force, and those two are not the same thing.
 *  - Packing friction holds the stem until enough force builds up to break it
 *    away, so the valve sticks and then jumps.
 *  - A valve without a positioner has nothing that measures actual position, so
 *    it has no way to notice either of the first two problems.
 *
 * The characteristic is selectable because that choice is the main sizing
 * decision on a control valve: equal percentage when the valve takes a small
 * share of the system pressure drop, linear when it takes most of it.
 */
export function createControlValve(options: ControlValveOptions = {}): ValveModel {
	const nominalSizeInch = options.nominalSizeInch ?? 2;
	const boreMm = inchToMm(nominalSizeInch);
	const balanced = options.balanced ?? false;
	const withPositioner = options.withPositioner ?? true;
	const failAction = options.failAction ?? 'failClosed';

	// Actuator size scales with the port, which is the practical rule: a bigger
	// plug needs a bigger diaphragm to move it against the same pressure drop.
	const effectiveAreaM2 = options.effectiveAreaM2 ?? 0.03;
	const strokeM = options.strokeM ?? 0.04;

	const actuator: ActuatorSpec = {
		effectiveAreaM2,
		benchSetLowBar: psiToBar(3),
		benchSetHighBar: psiToBar(15),
		strokeM,
		movingMassKg: 4.5,
		action: failAction === 'failClosed' ? 'airToOpen' : 'airToClose',
		hasPositioner: withPositioner,
		positionerGainBarPerM: withPositioner
			? (options.positionerGainBarPerM ?? DEFAULT_POSITIONER_GAIN_BAR_PER_M)
			: undefined,
		positionerIntegralBarPerMetrePerSecond: withPositioner
			? (options.positionerIntegralBarPerMetrePerSecond ??
				DEFAULT_POSITIONER_INTEGRAL_BAR_PER_M_PER_S)
			: undefined,
		supplyPressureBar: options.supplyPressureBar ?? 1.4
	};

	const spec: ValveSpec = {
		id: 'controlValve',
		name: 'Control valve',
		family: 'linear',
		actuation: 'pneumaticSpringDiaphragm',
		ratedKv: options.ratedKv ?? 40,
		characteristic: options.characteristic ?? 'equalPercentage',
		rangeability: options.rangeability ?? 50,
		ports: {
			nominalSizeInch,
			portAreaM2: diameterMmToAreaM2(boreMm * 0.75),
			balanceSealAreaM2: balanced ? diameterMmToAreaM2(boreMm * 0.7) : 0
		},
		pressureRecoveryFactor: 0.9,
		terminalPressureDropRatio: 0.72,
		incipientCavitationSigma: 1.7,
		friction: FRICTION_PRESETS.graphite,
		actuator,
		suitablePhases: ['liquid', 'gas', 'steam'],
		typicalServices: ['Flow control', 'Pressure control', 'Level control', 'Temperature control'],
		summary:
			'The modulating valve at the centre of a control loop. Characterised trim, spring diaphragm actuator and, on anything that matters, a positioner.'
	};

	const flowToOpen = options.flowToOpen ?? true;

	return {
		...createLinearValve(spec, balanced ? 0.7 : 0, 0.8),
		flowCoefficient({ opening }): number {
			if (opening <= 0) return 0;
			return spec.ratedKv * relativeCapacity(spec.characteristic, opening, {
				rangeability: spec.rangeability
			});
		},
		fluidForce(pressureDropBar, _flowToOpen, _opening): number {
			// The installed flow direction is fixed by how the body was piped, so
			// it comes from the valve configuration rather than from the caller.
			const unbalancedAreaM2 = spec.ports.portAreaM2 * (balanced ? 0.3 : 1);
			const magnitude = Math.abs(pressureDropBar) * 1e5 * unbalancedAreaM2 * 0.8;
			return (flowToOpen ? 1 : -1) * magnitude;
		},
		// Travel is measured from the seat, which is the closed position.
		toOpening(positionNative: number): number {
			return travelFraction(actuator, positionNative);
		}
	};
}

/** Nominal sizes the catalogue offers for the linear valve family. */
export const LINEAR_VALVE_SIZES_INCH: readonly number[] = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6];
