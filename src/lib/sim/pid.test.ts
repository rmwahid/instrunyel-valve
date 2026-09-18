/**
 * Tests for the PID controller.
 *
 * The tests target the three implementation details that separate a working
 * controller from a textbook one: derivative on measurement, derivative
 * filtering, and integral clamping.
 */

import { describe, expect, test } from 'bun:test';
import {
	conservativeTuning,
	createPidState,
	proportionalBandPercent,
	stepPid,
	zieglerNicholsOpenLoop,
	type PidSpec
} from './pid';

const REVERSE: PidSpec = {
	gain: 2,
	integralSeconds: 10,
	derivativeSeconds: 0,
	outputMinPercent: 0,
	outputMaxPercent: 100,
	action: 'reverse'
};

describe('proportional action', () => {
	test('a reverse acting controller reduces its output when the measurement rises above setpoint', () => {
		let state = createPidState(REVERSE, 50);
		state = stepPid(REVERSE, state, { setpoint: 50, measurement: 60, dtSeconds: 1 });

		// The proportional contribution is strongly negative, which closes a
		// fail-closed valve. The output itself is clamped at its 0 percent limit.
		expect(state.proportionalPercent).toBeLessThan(0);
		expect(state.outputPercent).toBe(0);
	});

	test('the proportional contribution equals gain times error', () => {
		const proportionalOnly: PidSpec = { ...REVERSE, integralSeconds: 0 };
		let state = createPidState(proportionalOnly, 50);
		state = stepPid(proportionalOnly, state, { setpoint: 50, measurement: 45, dtSeconds: 1 });
		expect(state.proportionalPercent).toBeCloseTo(2 * 5, 6);
	});

	test('a direct acting controller increases its output when the measurement rises', () => {
		const direct: PidSpec = { ...REVERSE, action: 'direct' };
		let state = createPidState(direct, 50);
		state = stepPid(direct, state, { setpoint: 50, measurement: 60, dtSeconds: 1 });
		expect(state.proportionalPercent).toBeGreaterThan(0);
	});

	test('the proportional band is the reciprocal of the gain', () => {
		expect(proportionalBandPercent({ ...REVERSE, gain: 2 })).toBeCloseTo(50, 9);
		expect(proportionalBandPercent({ ...REVERSE, gain: 4 })).toBeCloseTo(25, 9);
	});
});

describe('integral action', () => {
	test('the integral term keeps accumulating while an error persists', () => {
		const integralOnly: PidSpec = { ...REVERSE, gain: 1, integralSeconds: 4, derivativeSeconds: 0 };
		let state = createPidState(integralOnly, 50);

		for (let i = 0; i < 10; i++) {
			state = stepPid(integralOnly, state, { setpoint: 60, measurement: 50, dtSeconds: 0.5 });
		}

		// Error of 10, gain 1, integral time 4 s, five seconds elapsed: the integral
		// contribution is 10 * 5 / 4 = 12.5 percent.
		expect(state.integralPercent).toBeCloseTo(12.5, 6);
	});

	test('integral action removes a standing offset that proportional action alone cannot', () => {
		const integralOnly: PidSpec = { ...REVERSE, gain: 1, integralSeconds: 5, derivativeSeconds: 0 };
		let state = createPidState(integralOnly, 50);
		for (let i = 0; i < 100; i++) {
			state = stepPid(integralOnly, state, { setpoint: 60, measurement: 50, dtSeconds: 0.5 });
		}
		// The output has driven well past what proportional action alone would give.
		expect(state.outputPercent).toBeGreaterThan(50);
	});

	test('a zero integral time disables the integral term instead of dividing by zero', () => {
		const noIntegral: PidSpec = { ...REVERSE, integralSeconds: 0 };
		let state = createPidState(noIntegral, 50);
		const before = state.integralPercent;
		for (let i = 0; i < 50; i++) {
			state = stepPid(noIntegral, state, { setpoint: 60, measurement: 50, dtSeconds: 0.5 });
		}
		expect(state.integralPercent).toBe(before);
	});
});

describe('derivative action', () => {
	const withDerivative: PidSpec = {
		...REVERSE,
		derivativeSeconds: 2,
		derivativeFilterSeconds: 0.5
	};

	test('a rising measurement reduces the output of a reverse acting controller', () => {
		let state = createPidState(withDerivative, 50);
		state = stepPid(withDerivative, state, { setpoint: 50, measurement: 55, dtSeconds: 0.5 });
		expect(state.derivativePercent).toBeLessThan(0);
	});

	test('derivative acts on the measurement, so a setpoint step causes no derivative kick', () => {
		// This is the reason for putting the derivative on the measurement. With
		// derivative on error, a setpoint step would produce a spike in the output
		// that a real valve could not follow.
		const noFilter: PidSpec = { ...REVERSE, derivativeSeconds: 2, derivativeFilterSeconds: 0 };
		let state = createPidState(noFilter, 50);

		// The measurement does not move, only the setpoint.
		state = stepPid(noFilter, state, { setpoint: 70, measurement: 50, dtSeconds: 1 });

		expect(state.derivativePercent).toBeCloseTo(0, 9);
	});

	test('a filtered derivative rises more slowly than an unfiltered one', () => {
		const unfiltered: PidSpec = { ...REVERSE, derivativeSeconds: 2, derivativeFilterSeconds: 0 };
		const filtered: PidSpec = { ...REVERSE, derivativeSeconds: 2, derivativeFilterSeconds: 2 };

		let unfilteredState = createPidState(unfiltered, 50);
		let filteredState = createPidState(filtered, 50);

		unfilteredState = stepPid(unfiltered, unfilteredState, {
			setpoint: 50,
			measurement: 55,
			dtSeconds: 0.5
		});
		filteredState = stepPid(filtered, filteredState, {
			setpoint: 50,
			measurement: 55,
			dtSeconds: 0.5
		});

		expect(Math.abs(filteredState.filteredDerivative)).toBeLessThan(
			Math.abs(unfilteredState.filteredDerivative)
		);
	});

	test('a steady measurement produces no derivative action', () => {
		let state = createPidState(withDerivative, 50);
		for (let i = 0; i < 40; i++) {
			state = stepPid(withDerivative, state, { setpoint: 50, measurement: 50, dtSeconds: 0.5 });
		}
		expect(state.filteredDerivative).toBeCloseTo(0, 6);
	});
});

describe('anti windup', () => {
	const limited: PidSpec = {
		gain: 5,
		integralSeconds: 2,
		derivativeSeconds: 0,
		outputMinPercent: 0,
		outputMaxPercent: 100,
		action: 'reverse'
	};

	test('the output never leaves its limits', () => {
		let state = createPidState(limited, 50);
		for (let i = 0; i < 400; i++) {
			state = stepPid(limited, state, { setpoint: 100, measurement: 0, dtSeconds: 0.5 });
		}
		expect(state.outputPercent).toBeLessThanOrEqual(100);
		expect(state.outputPercent).toBeGreaterThanOrEqual(0);
	});

	test('the integral does not wind up while the output is against its limit', () => {
		let state = createPidState(limited, 50);
		for (let i = 0; i < 400; i++) {
			state = stepPid(limited, state, { setpoint: 100, measurement: 0, dtSeconds: 0.5 });
		}
		const woundUp = state.integralPercent;

		// Another 200 scans with the same saturated condition must not increase it.
		for (let i = 0; i < 200; i++) {
			state = stepPid(limited, state, { setpoint: 100, measurement: 0, dtSeconds: 0.5 });
		}
		expect(state.integralPercent).toBeCloseTo(woundUp, 9);
	});

	test('the loop recovers immediately after saturation rather than staying stuck', () => {
		// This is the practical consequence of anti windup: a valve that was held
		// wide open for a long time must come back as soon as the error reverses,
		// not after the integral has unwound.
		let state = createPidState(limited, 50);
		for (let i = 0; i < 400; i++) {
			state = stepPid(limited, state, { setpoint: 100, measurement: 0, dtSeconds: 0.5 });
		}
		expect(state.outputPercent).toBeCloseTo(100, 6);

		// Error reverses strongly.
		state = stepPid(limited, state, { setpoint: 0, measurement: 100, dtSeconds: 0.5 });
		expect(state.outputPercent).toBeLessThan(100);
	});

	test('saturation is reported while the output is limited', () => {
		let state = createPidState(limited, 50);
		for (let i = 0; i < 200; i++) {
			state = stepPid(limited, state, { setpoint: 100, measurement: 0, dtSeconds: 0.5 });
		}
		expect(state.saturated).toBe(true);
	});
});

describe('tuning rules', () => {
	test('Ziegler-Nichols open loop produces the classic ratios', () => {
		const tuning = zieglerNicholsOpenLoop({
			processGain: 2,
			timeConstantSeconds: 10,
			deadTimeSeconds: 2
		});
		// Kp = 1.2 T / (K L), Ti = 2 L, Td = 0.5 L
		expect(tuning.gain).toBeCloseTo((1.2 * 10) / (2 * 2), 9);
		expect(tuning.integralSeconds).toBeCloseTo(4, 9);
		expect(tuning.derivativeSeconds).toBeCloseTo(1, 9);
	});

	test('a longer dead time calls for less gain, which is the whole point of the rule', () => {
		const fast = zieglerNicholsOpenLoop({
			processGain: 2,
			timeConstantSeconds: 10,
			deadTimeSeconds: 1
		});
		const sluggish = zieglerNicholsOpenLoop({
			processGain: 2,
			timeConstantSeconds: 10,
			deadTimeSeconds: 5
		});
		expect(sluggish.gain).toBeLessThan(fast.gain);
	});

	test('a degenerate process returns a safe no-op tuning rather than infinity', () => {
		const tuning = zieglerNicholsOpenLoop({
			processGain: 0,
			timeConstantSeconds: 0,
			deadTimeSeconds: 0
		});
		expect(Number.isFinite(tuning.gain)).toBe(true);
		expect(tuning.gain).toBe(1);
	});

	test('the conservative tuning detunes the aggressive rule', () => {
		const curve = { processGain: 2, timeConstantSeconds: 10, deadTimeSeconds: 2 };
		const aggressive = zieglerNicholsOpenLoop(curve);
		const calm = conservativeTuning(curve);
		expect(calm.gain).toBeLessThan(aggressive.gain);
		expect(calm.integralSeconds).toBeGreaterThan(aggressive.integralSeconds);
	});
});

describe('scan rate independence', () => {
	test('the integral contribution converges to the same value at different scan rates', () => {
		const spec: PidSpec = { ...REVERSE, gain: 1, integralSeconds: 8, derivativeSeconds: 0 };

		function integrate(dtSeconds: number, totalSeconds: number): number {
			let state = createPidState(spec, 50);
			const steps = Math.round(totalSeconds / dtSeconds);
			for (let i = 0; i < steps; i++) {
				state = stepPid(spec, state, { setpoint: 60, measurement: 50, dtSeconds });
			}
			return state.integralPercent;
		}

		const fast = integrate(0.1, 10);
		const slow = integrate(1, 10);
		expect(fast).toBeCloseTo(slow, 6);
	});
});
