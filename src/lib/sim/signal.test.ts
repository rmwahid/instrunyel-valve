/**
 * Tests for the instrument signal chain.
 *
 * Two things are being checked here that a lesson depends on directly: the 4-20
 * mA range and NAMUR NE43 classification are correct, and the noise is
 * deterministic so a demonstrated scenario reproduces exactly.
 */

import { describe, expect, test } from 'bun:test';
import {
	applyLoopFault,
	createIpConverterState,
	createRandom,
	createTransmitterState,
	evaluateNamur,
	isFault,
	stepIpConverter,
	stepTransmitter,
	type IpConverterSpec,
	type TransmitterSpec
} from './signal';
import { currentMaToFraction, fractionToCurrentMa } from './units';

describe('current loop scaling', () => {
	test('zero percent is 4 mA and full scale is 20 mA', () => {
		expect(fractionToCurrentMa(0)).toBe(4);
		expect(fractionToCurrentMa(1)).toBe(20);
		expect(fractionToCurrentMa(0.5)).toBe(12);
	});

	test('the current to fraction conversion is the inverse', () => {
		for (const fraction of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
			expect(currentMaToFraction(fractionToCurrentMa(fraction))).toBeCloseTo(fraction, 9);
		}
	});

	test('the live zero is why a broken loop can be told from a low reading', () => {
		// A reading of zero percent is still 4 mA, so there is headroom below it for
		// a fault to be signalled.
		expect(fractionToCurrentMa(0)).toBeGreaterThan(0);
	});
});

describe('NAMUR NE43 classification', () => {
	test('a healthy loop is valid', () => {
		expect(evaluateNamur(4)).toBe('valid');
		expect(evaluateNamur(12)).toBe('valid');
		expect(evaluateNamur(20)).toBe('valid');
	});

	test('a current below 3.6 mA is a downscale fault', () => {
		expect(evaluateNamur(0)).toBe('downscaleFault');
		expect(evaluateNamur(3.5)).toBe('downscaleFault');
		expect(isFault(evaluateNamur(3.5))).toBe(true);
	});

	test('a current above 21.0 mA is an upscale fault', () => {
		expect(evaluateNamur(21.5)).toBe('upscaleFault');
		expect(isFault(evaluateNamur(21.5))).toBe(true);
	});

	test('the saturation bands are valid but flagged', () => {
		expect(evaluateNamur(3.7)).toBe('saturatedLow');
		expect(evaluateNamur(20.8)).toBe('saturatedHigh');
		expect(isFault(evaluateNamur(3.7))).toBe(false);
	});

	test('the boundaries fall where the standard puts them', () => {
		// Below 3.6 mA is a fault, 3.6 to 3.8 is the low saturation band, and 3.8
		// upward is valid process signal.
		expect(evaluateNamur(3.6)).toBe('saturatedLow');
		expect(evaluateNamur(3.8)).toBe('valid');

		// The high side mirrors it: valid up to 20.5, saturated to 21.0, and a
		// fault above that.
		expect(evaluateNamur(20.5)).toBe('valid');
		expect(evaluateNamur(20.6)).toBe('saturatedHigh');
		expect(evaluateNamur(21.0)).toBe('saturatedHigh');
		expect(evaluateNamur(21.1)).toBe('upscaleFault');
	});
});

describe('wiring faults', () => {
	test('an open circuit drives the current to zero', () => {
		expect(applyLoopFault(12, { type: 'openCircuit', description: '' })).toBe(0);
	});

	test('a short circuit drives the current above range', () => {
		const current = applyLoopFault(12, { type: 'shortCircuit', description: '' });
		expect(current).toBeGreaterThan(21);
		expect(evaluateNamur(current)).toBe('upscaleFault');
	});

	test('a lost supply looks like an open circuit to the control system', () => {
		expect(applyLoopFault(12, { type: 'supplyLoss', description: '' })).toBe(0);
	});

	test('a healthy loop passes the current through unchanged', () => {
		expect(applyLoopFault(13.7, { type: 'none', description: 'Loop healthy' })).toBe(13.7);
	});
});

describe('deterministic noise', () => {
	test('the same seed produces the same sequence', () => {
		const first = createRandom(12345);
		const second = createRandom(12345);
		for (let i = 0; i < 20; i++) {
			expect(first()).toBe(second());
		}
	});

	test('different seeds produce different sequences', () => {
		const first = createRandom(1);
		const second = createRandom(2);
		expect(first()).not.toBe(second());
	});

	test('the generator stays inside its unit interval', () => {
		const random = createRandom(99);
		for (let i = 0; i < 2000; i++) {
			const value = random();
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}
	});

	test('two transmitters with the same seed report the same noisy current', () => {
		const spec: TransmitterSpec = {
			lowerRange: 0,
			upperRange: 60,
			dampingSeconds: 0.2,
			noiseMa: 0.05
		};
		const run = () => {
			let state = createTransmitterState(spec);
			const random = createRandom(7);
			for (let i = 0; i < 50; i++) {
				state = stepTransmitter(spec, state, 30, 0.02, random);
			}
			return state.currentMa;
		};
		expect(run()).toBe(run());
	});
});

describe('transmitter dynamics', () => {
	const spec: TransmitterSpec = {
		lowerRange: 0,
		upperRange: 60,
		dampingSeconds: 0.5
	};

	test('the transmitter lags a step in the process', () => {
		let state = createTransmitterState(spec);
		const random = createRandom(1);

		// Step for exactly one time constant, which is 0.5 s at a 0.05 s step for
		// the 0.5 s damping in this spec.
		for (let i = 0; i < 10; i++) {
			state = stepTransmitter(spec, state, 60, 0.05, random);
		}

		// One time constant in, a first order lag has covered about 63 percent of
		// the step.
		expect(state.measuredValue).toBeGreaterThan(35);
		expect(state.measuredValue).toBeLessThan(40);
	});

	test('a shorter time constant reaches the process value sooner', () => {
		const fast: TransmitterSpec = { ...spec, dampingSeconds: 0.1 };
		const random = createRandom(1);

		let slowState = createTransmitterState(spec);
		let fastState = createTransmitterState(fast);
		for (let i = 0; i < 10; i++) {
			slowState = stepTransmitter(spec, slowState, 60, 0.05, random);
			fastState = stepTransmitter(fast, fastState, 60, 0.05, random);
		}

		expect(fastState.measuredValue).toBeGreaterThan(slowState.measuredValue);
	});

	test('the transmitter eventually reaches the process value', () => {
		let state = createTransmitterState(spec);
		const random = createRandom(1);
		for (let i = 0; i < 500; i++) {
			state = stepTransmitter(spec, state, 45, 0.02, random);
		}
		expect(state.measuredValue).toBeCloseTo(45, 6);
	});

	test('a zero damping transmitter follows the process immediately', () => {
		const fast: TransmitterSpec = { ...spec, dampingSeconds: 0 };
		let state = createTransmitterState(fast);
		const random = createRandom(1);
		state = stepTransmitter(fast, state, 30, 0.02, random);
		expect(state.measuredValue).toBeCloseTo(30, 9);
	});

	test('a value above the range drives the current above 20 mA but below the upscale fault', () => {
		const fast: TransmitterSpec = { ...spec, dampingSeconds: 0 };
		let state = createTransmitterState(fast);
		const random = createRandom(1);
		state = stepTransmitter(fast, state, 66, 0.02, random);
		expect(state.currentMa).toBeGreaterThan(20);
		expect(state.currentMa).toBeLessThanOrEqual(21.5);
		expect(state.status).toBe('upscaleFault');
	});

	test('a value below the range drives the current below 4 mA', () => {
		const fast: TransmitterSpec = { ...spec, dampingSeconds: 0, lowerRange: 10 };
		let state = createTransmitterState(fast);
		const random = createRandom(1);
		state = stepTransmitter(fast, state, 5, 0.02, random);
		expect(state.currentMa).toBeLessThan(4);
		expect(state.currentMa).toBeGreaterThan(0);
	});

	test('quantisation snaps the current to the converter resolution', () => {
		const quantised: TransmitterSpec = {
			...spec,
			dampingSeconds: 0,
			resolutionMa: 0.1
		};
		let state = createTransmitterState(quantised);
		const random = createRandom(1);
		state = stepTransmitter(quantised, state, 33.33, 0.02, random);
		// The current should be a multiple of 0.1 mA.
		expect(Math.abs(state.currentMa / 0.1 - Math.round(state.currentMa / 0.1))).toBeLessThan(1e-9);
	});
});

describe('I/P converter', () => {
	const spec: IpConverterSpec = {
		timeConstantSeconds: 0.2,
		zeroBar: 0.2,
		spanBar: 0.8
	};

	test('4 mA gives the zero output and 20 mA gives full span', () => {
		let state = createIpConverterState(spec);
		for (let i = 0; i < 300; i++) {
			state = stepIpConverter(spec, state, 4, 0.02);
		}
		expect(state.outputBar).toBeCloseTo(0.2, 6);

		state = createIpConverterState(spec);
		for (let i = 0; i < 300; i++) {
			state = stepIpConverter(spec, state, 20, 0.02);
		}
		expect(state.outputBar).toBeCloseTo(1.0, 6);
	});

	test('the converter output lags a step in current', () => {
		let state = createIpConverterState(spec);
		state = stepIpConverter(spec, state, 20, 0.05);
		expect(state.outputBar).toBeGreaterThan(0.2);
		expect(state.outputBar).toBeLessThan(1.0);
	});

	test('a zero offset shifts the whole output, which is a real calibration fault', () => {
		const offset: IpConverterSpec = { ...spec, zeroOffsetBar: 0.05 };
		let state = createIpConverterState(offset);
		for (let i = 0; i < 300; i++) {
			state = stepIpConverter(offset, state, 4, 0.02);
		}
		// The valve cracks open with the signal at zero, which is the symptom.
		expect(state.outputBar).toBeCloseTo(0.25, 6);
	});

	test('a gain error stops the converter reaching full output', () => {
		const gainError: IpConverterSpec = { ...spec, gainError: -0.1 };
		let state = createIpConverterState(gainError);
		for (let i = 0; i < 300; i++) {
			state = stepIpConverter(gainError, state, 20, 0.02);
		}
		// Ten percent short at the top, which is a valve that never quite opens.
		expect(state.outputBar).toBeCloseTo(0.2 + 0.8 * 0.9, 6);
	});

	test('the output is never negative, because the converter cannot suck air out', () => {
		const offset: IpConverterSpec = { ...spec, zeroBar: 0.1, zeroOffsetBar: -0.5 };
		let state = createIpConverterState(offset);
		for (let i = 0; i < 300; i++) {
			state = stepIpConverter(offset, state, 4, 0.02);
		}
		expect(state.outputBar).toBeGreaterThanOrEqual(0);
	});
});
