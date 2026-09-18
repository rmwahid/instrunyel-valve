/**
 * Tests for the actuator force balance.
 *
 * These lock down the sign convention, because a sign error here would produce a
 * valve that opens when it should close and the whole lab would be quietly
 * wrong.
 */

import { describe, expect, test } from 'bun:test';
import {
	airForceN,
	positionFromPressure,
	pressureFromPosition,
	selfActingActuator,
	selfActingOpening,
	springForceN,
	springPreloadM,
	springRateNPerM,
	travelFraction,
	type ActuatorSpec
} from './actuator';
import { psiToBar } from './units';

const FAIL_CLOSED: ActuatorSpec = {
	effectiveAreaM2: 0.03,
	benchSetLowBar: psiToBar(3),
	benchSetHighBar: psiToBar(15),
	strokeM: 0.04,
	movingMassKg: 4.5,
	action: 'airToOpen'
};

const FAIL_OPEN: ActuatorSpec = {
	...FAIL_CLOSED,
	action: 'airToClose'
};

describe('spring rate from bench set', () => {
	test('the bench set span produces a spring that reaches full travel', () => {
		const k = springRateNPerM(FAIL_CLOSED);
		// k = A * (P_high - P_low) / stroke
		const pressureSpanPa = (FAIL_CLOSED.benchSetHighBar - FAIL_CLOSED.benchSetLowBar) * 1e5;
		expect(k).toBeCloseTo((0.03 * pressureSpanPa) / 0.04, 6);
	});

	test('spring preload balances the low bench set pressure', () => {
		const k = springRateNPerM(FAIL_CLOSED);
		const preload = springPreloadM(FAIL_CLOSED);
		const springForceAtPreloadN = k * preload;
		const airForceAtLowBenchSetN = FAIL_CLOSED.effectiveAreaM2 * FAIL_CLOSED.benchSetLowBar * 1e5;
		expect(springForceAtPreloadN).toBeCloseTo(airForceAtLowBenchSetN, 6);
	});
});

describe('force balance', () => {
	test('an air-to-open spring pushes closed, so its force is negative', () => {
		expect(springForceN(FAIL_CLOSED, 0)).toBeLessThan(0);
		// And it grows more negative as the spring compresses further.
		expect(springForceN(FAIL_CLOSED, FAIL_CLOSED.strokeM)).toBeLessThan(
			springForceN(FAIL_CLOSED, 0)
		);
	});

	test('an air-to-close spring pushes open, so its force is positive', () => {
		expect(springForceN(FAIL_OPEN, 0)).toBeGreaterThan(0);
		// And it relaxes as the valve opens.
		expect(springForceN(FAIL_OPEN, FAIL_OPEN.strokeM)).toBeLessThan(
			springForceN(FAIL_OPEN, 0)
		);
	});

	test('air pressure closes an air-to-close actuator', () => {
		expect(airForceN(FAIL_CLOSED, 1)).toBeGreaterThan(0);
		expect(airForceN(FAIL_OPEN, 1)).toBeLessThan(0);
	});

	test('the force balance is neutral at both ends of travel when the bench set is right', () => {
		// This is the definition of a correctly benched actuator: at the low bench
		// set the net force is zero at the closed position, and at the high bench
		// set it is zero at the open position.
		const atClosed = springForceN(FAIL_CLOSED, 0) + airForceN(FAIL_CLOSED, FAIL_CLOSED.benchSetLowBar);
		const atOpen =
			springForceN(FAIL_CLOSED, FAIL_CLOSED.strokeM) +
			airForceN(FAIL_CLOSED, FAIL_CLOSED.benchSetHighBar);

		expect(atClosed).toBeCloseTo(0, 3);
		expect(atOpen).toBeCloseTo(0, 3);
	});

	test('an air-to-close actuator balances at the same two pressures', () => {
		// An air-to-close valve rests fully open, so its spring balances the low
		// bench set pressure at full travel and the high bench set pressure at the
		// seat. The ends are swapped relative to an air-to-open actuator, which is
		// what makes the fail direction different.
		const atFullTravel =
			springForceN(FAIL_OPEN, FAIL_OPEN.strokeM) +
			airForceN(FAIL_OPEN, FAIL_OPEN.benchSetLowBar);
		const atSeat =
			springForceN(FAIL_OPEN, 0) + airForceN(FAIL_OPEN, FAIL_OPEN.benchSetHighBar);

		expect(atFullTravel).toBeCloseTo(0, 3);
		expect(atSeat).toBeCloseTo(0, 3);
	});

	test('an interrupted air supply drives the valve to its fail position', () => {
		// Air to open: no air means the spring wins and the valve is closed.
		const netWithoutAir = springForceN(FAIL_CLOSED, 0) + airForceN(FAIL_CLOSED, 0);
		expect(netWithoutAir).toBeLessThanOrEqual(0);

		// Air to close: no air means the spring wins and the valve is open.
		const netWithoutAirFailOpen = springForceN(FAIL_OPEN, 0) + airForceN(FAIL_OPEN, 0);
		expect(netWithoutAirFailOpen).toBeGreaterThanOrEqual(0);
	});
});

describe('bench set travel mapping', () => {
	test('travel runs from closed to open as pressure rises on an air-to-open valve', () => {
		expect(positionFromPressure(FAIL_CLOSED, FAIL_CLOSED.benchSetLowBar)).toBeCloseTo(0, 9);
		expect(positionFromPressure(FAIL_CLOSED, FAIL_CLOSED.benchSetHighBar)).toBeCloseTo(
			FAIL_CLOSED.strokeM,
			9
		);
		expect(travelFraction(FAIL_CLOSED, positionFromPressure(FAIL_CLOSED, 0.7))).toBeGreaterThan(0);
	});

	test('travel runs from open to closed as pressure rises on an air-to-close valve', () => {
		expect(positionFromPressure(FAIL_OPEN, FAIL_OPEN.benchSetLowBar)).toBeCloseTo(
			FAIL_OPEN.strokeM,
			9
		);
		expect(positionFromPressure(FAIL_OPEN, FAIL_OPEN.benchSetHighBar)).toBeCloseTo(0, 9);
	});

	test('pressure and position are inverses of each other', () => {
		for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
			const positionM = fraction * FAIL_CLOSED.strokeM;
			const pressureBar = pressureFromPosition(FAIL_CLOSED, positionM);
			expect(positionFromPressure(FAIL_CLOSED, pressureBar)).toBeCloseTo(positionM, 9);
		}
	});

	test('pressure outside the bench set clamps to the mechanical stops', () => {
		expect(positionFromPressure(FAIL_CLOSED, -2)).toBe(0);
		expect(positionFromPressure(FAIL_CLOSED, 99)).toBe(FAIL_CLOSED.strokeM);
	});
});

describe('self acting valves', () => {
	const checkValveActuator = selfActingActuator({
		effectiveAreaM2: 0.002,
		strokeM: 0.02,
		movingMassKg: 2,
		crackingPressureBar: 0.035,
		fullTravelPressureBar: 0.2
	});

	test('a check valve stays shut below its cracking pressure', () => {
		expect(selfActingOpening(checkValveActuator, 0)).toBe(0);
		expect(selfActingOpening(checkValveActuator, 0.034)).toBe(0);
	});

	test('a check valve is fully open at its full lift pressure', () => {
		expect(selfActingOpening(checkValveActuator, 0.2)).toBe(1);
		expect(selfActingOpening(checkValveActuator, 5)).toBe(1);
	});

	test('opening is proportional between cracking and full lift', () => {
		const midPressure = 0.035 + (0.2 - 0.035) / 2;
		expect(selfActingOpening(checkValveActuator, midPressure)).toBeCloseTo(0.5, 9);
	});

	test('reverse flow keeps a self acting valve shut', () => {
		expect(selfActingOpening(checkValveActuator, -1)).toBe(0);
	});
});
