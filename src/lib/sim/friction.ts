/**
 * Stem friction: stiction, deadband and hysteresis.
 *
 * Packing grips the stem. Below a breakaway force the stem does not move at all,
 * which is stiction. Once it moves, the resisting force drops to a lower kinetic
 * value, so the stem jumps forward and sticks again. The result is the
 * stick-slip behaviour that shows up in a trend as a staircase and in a loop as
 * a limit cycle.
 *
 * Hysteresis is not modelled separately because it does not need to be: it falls
 * out of the stick-slip physics. Reversing direction requires overcoming static
 * friction from the other side, so the valve always travels a deadband before it
 * responds. That is exactly what hysteresis is.
 */

export interface FrictionSpec {
	/** Breakaway force, N. The stiction that must be exceeded to start motion. */
	staticFrictionN: number;
	/** Sliding force, N. Always lower than the breakaway force in a real packing. */
	kineticFrictionN: number;
	/** Viscous coefficient, N per m/s. Small compared to Coulomb friction for packing. */
	viscousNPerMetrePerSecond?: number;
	/** Speed below which the stem counts as stopped, m/s. */
	velocityThresholdMPerSecond?: number;
}

export interface StemMotionState {
	positionM: number;
	velocityMPerSecond: number;
	/** Signed friction force currently acting on the stem. */
	frictionForceN: number;
}

export const STICTION_VELOCITY_THRESHOLD = 1e-4;

/**
 * Well known packing and trim combinations, as force at the stem in newtons.
 *
 * Values are representative for a 25 to 50 mm valve, the size used throughout
 * this lab. The magnitude is worth sanity checking against the actuator: a
 * spring diaphragm actuator on this size of valve develops roughly 2500 N over
 * its stroke, so packing friction of tens of newtons is a few percent of the
 * available force. That is the ratio that decides deadband, and it is why a
 * control valve with a positioner holds position to a fraction of a percent while
 * a bare actuator drifts.
 */
export const FRICTION_PRESETS = {
	/** PTFE V-ring packing: low friction, common on small valves and clean service. */
	ptfeLow: { staticFrictionN: 25, kineticFrictionN: 18 },
	/** Graphite packing: higher friction, used for high temperature service. */
	graphite: { staticFrictionN: 50, kineticFrictionN: 36 },
	/** Graphite packing after a poor rebuild: the classic stiction complaint. */
	graphiteWorn: { staticFrictionN: 110, kineticFrictionN: 75 },
	/** Balanced trim with a soft seat: very low friction because the seal carries the load. */
	balancedSoftSeat: { staticFrictionN: 18, kineticFrictionN: 12 }
} as const satisfies Record<string, Pick<FrictionSpec, 'staticFrictionN' | 'kineticFrictionN'>>;

/**
 * Advance the stem state by one step under the given non-friction forces.
 *
 * `appliedForceN` is the sum of spring, diaphragm and fluid forces only. Friction
 * is resolved here, because whether the stem moves at all depends on it.
 */
export function integrateStemMotion(
	massKg: number,
	friction: FrictionSpec,
	state: StemMotionState,
	appliedForceN: number,
	lowerLimitM: number,
	upperLimitM: number,
	dtSeconds: number
): StemMotionState {
	const velocityThreshold = friction.velocityThresholdMPerSecond ?? STICTION_VELOCITY_THRESHOLD;
	const damping = friction.viscousNPerMetrePerSecond ?? 0;
	const stopped = Math.abs(state.velocityMPerSecond) < velocityThreshold;

	// Stick test: while stopped, friction can hold the stem against anything up
	// to the breakaway force. If it can, the stem does not move at all.
	if (stopped && Math.abs(appliedForceN) <= friction.staticFrictionN) {
		return {
			positionM: state.positionM,
			velocityMPerSecond: 0,
			frictionForceN: -appliedForceN
		};
	}

	// Slip: friction opposes the direction of travel, or of the impending travel.
	const direction = stopped ? Math.sign(appliedForceN) : Math.sign(state.velocityMPerSecond);
	const frictionForceN = -direction * friction.kineticFrictionN;

	const netForceN = appliedForceN + frictionForceN - damping * state.velocityMPerSecond;
	const acceleration = netForceN / Math.max(massKg, 1e-6);

	let velocityMPerSecond = state.velocityMPerSecond + acceleration * dtSeconds;
	let positionM = state.positionM + velocityMPerSecond * dtSeconds;

	// Mechanical stops. Hitting a stop kills the velocity, the stem cannot
	// travel past the seat or past the full open limit.
	if (positionM <= lowerLimitM) {
		positionM = lowerLimitM;
		if (velocityMPerSecond < 0) velocityMPerSecond = 0;
	} else if (positionM >= upperLimitM) {
		positionM = upperLimitM;
		if (velocityMPerSecond > 0) velocityMPerSecond = 0;
	}

	if (Math.abs(velocityMPerSecond) < velocityThreshold) velocityMPerSecond = 0;

	return { positionM, velocityMPerSecond, frictionForceN };
}

/**
 * Deadband in stem travel caused by friction.
 *
 * To reverse direction the actuator must first build up enough force to break
 * away on the other side, which takes twice the breakaway force of pressure
 * change. Dividing by the spring rate converts that force into travel, which is
 * the number quoted as valve deadband.
 */
export function deadbandTravelM(staticFrictionN: number, springRateNPerM: number): number {
	if (springRateNPerM <= 0) return 0;
	return (2 * staticFrictionN) / springRateNPerM;
}

/** Deadband expressed as a percentage of full stroke. */
export function deadbandPercent(
	staticFrictionN: number,
	springRateNPerM: number,
	strokeM: number
): number {
	if (strokeM <= 0) return 0;
	return (deadbandTravelM(staticFrictionN, springRateNPerM) / strokeM) * 100;
}

/** Pressure change needed to break the stem away, bar. */
export function breakawayPressureBar(staticFrictionN: number, effectiveAreaM2: number): number {
	if (effectiveAreaM2 <= 0) return 0;
	return staticFrictionN / effectiveAreaM2 / 1e5;
}

/**
 * Travel a valve actually reaches when driven to a target position, accounting
 * for friction holding it short of the target.
 *
 * Used by the static bench set calculation and by the lesson that explains why a
 * control valve will not sit exactly where the controller asks it to.
 */
export function achievableTravelM(
	currentPositionM: number,
	targetPositionM: number,
	staticFrictionN: number,
	springRateNPerM: number
): number {
	if (springRateNPerM <= 0) return targetPositionM;

	const requiredForceN = Math.abs(targetPositionM - currentPositionM) * springRateNPerM;
	if (requiredForceN <= staticFrictionN) return currentPositionM;

	// Only the force in excess of the breakaway moves the stem.
	const excessM = (requiredForceN - staticFrictionN) / springRateNPerM;
	return currentPositionM + Math.sign(targetPositionM - currentPositionM) * excessM;
}

/** A short label describing the friction level, used in the instrument panel. */
export function frictionSeverity(spec: FrictionSpec): 'low' | 'moderate' | 'high' {
	if (spec.staticFrictionN < 150) return 'low';
	if (spec.staticFrictionN < 400) return 'moderate';
	return 'high';
}
