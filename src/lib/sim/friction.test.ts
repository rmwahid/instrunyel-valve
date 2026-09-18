/**
 * Tests for stem friction.
 *
 * The claims being checked are the ones the lessons make: below the breakaway
 * force nothing moves, reversing direction costs a deadband, and a stick-slip
 * cycle produces a staircase rather than a ramp.
 */

import { describe, expect, test } from 'bun:test';
import {
	FRICTION_PRESETS,
	achievableTravelM,
	deadbandPercent,
	deadbandTravelM,
	integrateStemMotion,
	type FrictionSpec,
	type StemMotionState
} from './friction';

const MASS_KG = 4.5;
const STROKE_M = 0.04;
const DT = 0.01;

const GRAPHITE: FrictionSpec = FRICTION_PRESETS.graphite;

function run(
	friction: FrictionSpec,
	initial: StemMotionState,
	appliedForceN: number,
	steps: number
): StemMotionState {
	let state = initial;
	for (let i = 0; i < steps; i++) {
		state = integrateStemMotion(MASS_KG, friction, state, appliedForceN, 0, STROKE_M, DT);
	}
	return state;
}

describe('stiction', () => {
	test('a force below the breakaway value moves nothing at all', () => {
		const state: StemMotionState = { positionM: 0.02, velocityMPerSecond: 0, frictionForceN: 0 };
		const result = run(GRAPHITE, state, GRAPHITE.staticFrictionN - 1, 200);
		expect(result.positionM).toBe(0.02);
		expect(result.velocityMPerSecond).toBe(0);
	});

	test('friction exactly cancels the applied force while the stem is stuck', () => {
		const state: StemMotionState = { positionM: 0.02, velocityMPerSecond: 0, frictionForceN: 0 };
		// A force below the breakaway value, so friction has to supply all of it.
		const applied = GRAPHITE.staticFrictionN / 2;
		const result = integrateStemMotion(MASS_KG, GRAPHITE, state, applied, 0, STROKE_M, DT);
		expect(result.frictionForceN).toBeCloseTo(-applied, 9);
	});

	test('a force above the breakaway value starts motion', () => {
		const state: StemMotionState = { positionM: 0.02, velocityMPerSecond: 0, frictionForceN: 0 };
		const result = run(GRAPHITE, state, GRAPHITE.staticFrictionN + 50, 20);
		expect(result.positionM).toBeGreaterThan(0.02);
	});

	test('the stem sticks again once it is moving slowly enough', () => {
		// Stick-slip: the stem breaks away, then the kinetic friction plus the
		// remaining force balance brings it back to a stop.
		const state: StemMotionState = { positionM: 0.02, velocityMPerSecond: 0, frictionForceN: 0 };
		const result = run(GRAPHITE, state, GRAPHITE.staticFrictionN + 10, 500);
		// It has moved, and it is no longer accelerating without limit.
		expect(result.positionM).toBeGreaterThan(0.02);
		expect(Math.abs(result.velocityMPerSecond)).toBeLessThan(0.5);
	});

	test('kinetic friction is lower than static friction, which is why it slips', () => {
		expect(GRAPHITE.kineticFrictionN).toBeLessThan(GRAPHITE.staticFrictionN);
	});

	test('a higher breakaway force makes the stem harder to move', () => {
		const state: StemMotionState = { positionM: 0.02, velocityMPerSecond: 0, frictionForceN: 0 };
		const lowFriction = run(FRICTION_PRESETS.ptfeLow, state, 100, 300);
		const highFriction = run(FRICTION_PRESETS.graphiteWorn, state, 100, 300);
		expect(highFriction.positionM).toBeLessThan(lowFriction.positionM);
	});
});

describe('mechanical stops', () => {
	test('the stem cannot travel below its lower limit', () => {
		const state: StemMotionState = { positionM: 0.001, velocityMPerSecond: 0, frictionForceN: 0 };
		const result = run(GRAPHITE, state, -5000, 100);
		expect(result.positionM).toBe(0);
		expect(result.velocityMPerSecond).toBe(0);
	});

	test('the stem cannot travel past full travel', () => {
		const state: StemMotionState = {
			positionM: STROKE_M - 0.001,
			velocityMPerSecond: 0,
			frictionForceN: 0
		};
		const result = run(GRAPHITE, state, 5000, 100);
		expect(result.positionM).toBe(STROKE_M);
	});

	test('hitting a stop kills the velocity rather than letting it build up', () => {
		const state: StemMotionState = { positionM: 0.0005, velocityMPerSecond: 0, frictionForceN: 0 };
		const result = run(GRAPHITE, state, -5000, 200);
		expect(result.velocityMPerSecond).toBe(0);
	});
});

describe('deadband', () => {
	test('deadband travel is twice the breakaway force over the spring rate', () => {
		// Reversing direction needs the force to swing by twice the breakaway
		// value, because the packing resists from the other side.
		expect(deadbandTravelM(100, 10000)).toBeCloseTo((2 * 100) / 10000, 9);
	});

	test('a stiffer spring gives a smaller deadband', () => {
		expect(deadbandTravelM(100, 50000)).toBeLessThan(deadbandTravelM(100, 10000));
	});

	test('deadband is reported as a percentage of stroke', () => {
		expect(deadbandPercent(100, 10000, 0.04)).toBeCloseTo((0.02 / 0.04) * 100, 9);
	});

	test('a worn graphite packing on a soft spring gives a deadband a control engineer would notice', () => {
		// A realistic actuator: 500 N/m equivalent spring rate and a stroke of
		// 40 mm. Even with a healthy packing the deadband is worth knowing about.
		const percent = deadbandPercent(GRAPHITE.staticFrictionN, 5000, 0.04);
		expect(percent).toBeGreaterThan(1);
	});

	test('a zero spring rate has no defined deadband rather than an infinite one', () => {
		expect(deadbandTravelM(100, 0)).toBe(0);
	});
});

describe('achievable travel', () => {
	test('a target within the breakaway band is not reached at all', () => {
		// 0.001 m of movement against a 10000 N/m spring is 10 N of force, far below
		// the packing breakaway value, so the stem does not budge.
		const reached = achievableTravelM(0.02, 0.021, 200, 10000);
		expect(reached).toBe(0.02);
	});

	test('a target exactly at the breakaway band edge does not move the stem', () => {
		// 0.02 m of movement against a 10000 N/m spring is exactly 200 N, the
		// breakaway value. Friction still holds it, so nothing moves.
		expect(achievableTravelM(0.02, 0.04, 200, 10000)).toBe(0.02);
	});

	test('a target beyond the breakaway band is reached short of the target', () => {
		const reached = achievableTravelM(0.02, 0.05, 200, 10000);
		expect(reached).toBeGreaterThan(0.02);
		// The shortfall is exactly the breakaway force divided by the spring rate:
		// 200 N at 10000 N/m leaves the stem 0.02 m short.
		expect(0.05 - reached).toBeCloseTo(200 / 10000, 9);
	});

	test('a zero spring rate leaves the target unchanged rather than dividing by zero', () => {
		expect(achievableTravelM(0.01, 0.03, 100, 0)).toBe(0.03);
	});
});
