/**
 * Inherent and installed flow characteristics.
 *
 * The inherent characteristic is the shape built into the trim: it says how
 * capacity grows with stem travel when the pressure drop across the valve is
 * held constant. The installed characteristic is what the loop actually sees,
 * because in a real system the pressure drop moves to the rest of the plant as
 * the valve opens. The gap between the two is one of the most commonly
 * misunderstood ideas in control valve selection, so the lab plots both.
 */

import { SECONDS_PER_HOUR } from './units';

export type InherentCharacteristic =
	/** Capacity proportional to travel. Used for constant pressure drop loops. */
	| 'linear'
	/** Capacity grows by a constant percentage per unit of travel. */
	| 'equalPercentage'
	/** Most of the capacity appears in the first part of the travel. */
	| 'quickOpening'
	/** A compromise between linear and equal percentage. */
	| 'modifiedParabolic';

export interface CharacteristicOptions {
	/** Rangeability R of an equal percentage trim, the ratio of maximum to minimum controllable capacity. */
	rangeability?: number;
}

export const DEFAULT_RANGEABILITY = 50;

/**
 * Relative capacity at a given stem position.
 *
 * Returns the fraction of rated capacity available, where rated capacity is the
 * valve wide open. Every curve passes through (0, 0) and (1, 1) so a valve is
 * shut at zero travel and at full rating at 100 percent travel.
 */
export function relativeCapacity(
	characteristic: InherentCharacteristic,
	opening: number,
	options: CharacteristicOptions = {}
): number {
	const travel = Math.min(1, Math.max(0, opening));
	const rangeability = options.rangeability ?? DEFAULT_RANGEABILITY;

	// A valve is shut when the plug is on the seat, and no trim leaks by design.
	// This matters for the equal percentage curve, whose formula would otherwise
	// return 1/R at zero travel: that value is the smallest controllable capacity,
	// not a leakage path, and reporting it as flow would show a closed valve
	// passing fluid.
	if (travel <= 0) return 0;

	switch (characteristic) {
		case 'linear':
			return travel;
		case 'equalPercentage':
			// f = R^(l - 1). At l = 1 the curve reaches 1; just above shutoff it
			// approaches 1/R, which is the smallest controllable capacity.
			return rangeability ** (travel - 1);
		case 'quickOpening':
			return Math.sqrt(travel);
		case 'modifiedParabolic':
			// f = l^1.5 has zero slope at shutoff like equal percentage but a much
			// gentler curvature, which is why it sits between the two.
			return travel ** 1.5;
	}
}

export function characteristicDescription(characteristic: InherentCharacteristic): string {
	switch (characteristic) {
		case 'linear':
			return 'Capacity proportional to travel. Best when the pressure drop across the valve is roughly constant.';
		case 'equalPercentage':
			return 'Each equal increment of travel multiplies capacity by a constant factor. Best when the valve takes a small share of the system pressure drop.';
		case 'quickOpening':
			return 'Most capacity available in the first third of travel. Used for on-off and relief duty rather than throttling.';
		case 'modifiedParabolic':
			return 'A contoured plug that sits between linear and equal percentage. A compromise when the pressure drop varies moderately.';
	}
}

/**
 * A hydraulic system made of the valve plus everything else in series.
 *
 * The fixed part stands in for pipe, fittings and heat exchangers, whose
 * pressure drop grows with the square of flow.
 */
export interface HydraulicSystem {
	/** Total pressure drop available across the valve plus the fixed part, bar. */
	totalPressureDropBar: number;
	/**
	 * Share of the total pressure drop the valve takes when it is wide open at
	 * design flow.
	 *
	 * This is the valve authority. A value near 1 means the valve dominates the
	 * system and the installed characteristic matches the inherent one. A small
	 * value means the fixed part dominates, and an equal percentage valve will
	 * behave almost linearly.
	 */
	valveAuthority: number;
	/** Rated flow coefficient of the valve, Kv at 100 percent travel. */
	ratedKv: number;
	/** Ratio of density to the density of water, used by the liquid equation. */
	specificGravity?: number;
}

/**
 * Resistance of the fixed part of the system, derived so that the design point
 * is reproduced exactly.
 *
 * At design flow with the valve wide open the valve takes its authority share of
 * the total drop and the fixed part takes the remainder. Solving for the
 * resistance from that condition keeps the model consistent with the stated
 * authority instead of asking the user for a made up coefficient.
 */
export function systemResistance(system: HydraulicSystem): number {
	const specificGravity = system.specificGravity ?? 1;
	const authority = Math.min(0.999, Math.max(0.001, system.valveAuthority));
	if (system.ratedKv <= 0) return 0;
	return ((1 - authority) * specificGravity) / (authority * system.ratedKv ** 2);
}

/**
 * Flow through the valve when the pressure drop across it depends on the flow.
 *
 * Substituting dP_valve = dP_total - k_sys * Q^2 into the liquid sizing equation
 * gives a quadratic in Q^2 that solves in closed form, so the installed
 * characteristic needs no iteration:
 *
 *     Q = sqrt( a * dP_total / (1 + a * k_sys) ),   a = Kv^2 / SG
 */
export function installedFlow(
	system: HydraulicSystem,
	opening: number,
	characteristic: InherentCharacteristic,
	options: CharacteristicOptions = {}
): { flowM3PerHour: number; valvePressureDropBar: number; systemPressureDropBar: number } {
	const specificGravity = system.specificGravity ?? 1;
	const capacity = relativeCapacity(characteristic, opening, options);
	const kv = system.ratedKv * capacity;

	if (kv <= 0) {
		return {
			flowM3PerHour: 0,
			valvePressureDropBar: system.totalPressureDropBar,
			systemPressureDropBar: 0
		};
	}

	const a = kv ** 2 / specificGravity;
	const kSystem = systemResistance(system);
	const flowM3PerHour = Math.sqrt((a * system.totalPressureDropBar) / (1 + a * kSystem));
	const systemPressureDropBar = kSystem * flowM3PerHour ** 2;

	return {
		flowM3PerHour,
		valvePressureDropBar: Math.max(0, system.totalPressureDropBar - systemPressureDropBar),
		systemPressureDropBar
	};
}

export interface CharacteristicPoint {
	/** Stem position, 0..1. */
	opening: number;
	/** Inherent relative capacity at this position. */
	inherent: number;
	/** Installed flow as a fraction of the flow at full travel. */
	installed: number;
	/** Pressure drop across the valve, bar. */
	valvePressureDropBar: number;
}

/**
 * Sample both curves over the full travel range, which is what the lab chart
 * plots. Curves are normalised so the two can be compared on one axis: the
 * comparison that matters is the shape, not the absolute capacity.
 */
export function characteristicCurve(
	system: HydraulicSystem,
	characteristic: InherentCharacteristic,
	samples = 41,
	options: CharacteristicOptions = {}
): CharacteristicPoint[] {
	const fullFlow = installedFlow(system, 1, characteristic, options).flowM3PerHour;
	const points: CharacteristicPoint[] = [];

	for (let i = 0; i < samples; i++) {
		const opening = i / (samples - 1);
		const installed = installedFlow(system, opening, characteristic, options);
		points.push({
			opening,
			inherent: relativeCapacity(characteristic, opening, options),
			installed: fullFlow > 0 ? installed.flowM3PerHour / fullFlow : 0,
			valvePressureDropBar: installed.valvePressureDropBar
		});
	}

	return points;
}

/**
 * Gain of the installed characteristic at an operating point, expressed as the
 * change in fractional flow per unit of travel. A flat region here is where a
 * control loop feels sluggish, a steep region is where it oscillates.
 */
export function installedGain(
	system: HydraulicSystem,
	characteristic: InherentCharacteristic,
	opening: number,
	options: CharacteristicOptions = {},
	step = 0.01
): number {
	const low = Math.max(0, opening - step / 2);
	const high = Math.min(1, opening + step / 2);
	if (high <= low) return 0;

	const fullFlow = installedFlow(system, 1, characteristic, options).flowM3PerHour;
	if (fullFlow <= 0) return 0;

	const flowLow = installedFlow(system, low, characteristic, options).flowM3PerHour;
	const flowHigh = installedFlow(system, high, characteristic, options).flowM3PerHour;

	return (flowHigh - flowLow) / fullFlow / (high - low);
}

/** Convert a flow in m3/h to a mass flow in kg/h at the given density. */
export function flowToMassFlow(flowM3PerHour: number, densityKgPerM3: number): number {
	return flowM3PerHour * densityKgPerM3;
}

/** Convert a mass flow in kg/h to kg/s for the integrator. */
export function massFlowToPerSecond(kgPerHour: number): number {
	return kgPerHour / SECONDS_PER_HOUR;
}
