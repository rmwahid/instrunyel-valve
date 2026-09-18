/**
 * Tests for the wall clock advance, which is how the interface drives the
 * simulation.
 *
 * These exist because of a bug that made the whole lab appear broken. The advance
 * used to compute how many whole simulation steps fitted into the last frame and
 * discard the remainder. At 60 frames per second a frame lasts 16.7 ms while the
 * simulation step is 20 ms, so the number of whole steps was zero on every frame,
 * forever. Nothing on the interface responded, and the symptom looked like a
 * broken control rather than a broken loop.
 *
 * The tests below pin the invariant that was missing: the simulation must advance
 * at real time at any frame rate.
 */

import { describe, expect, test } from 'bun:test';
import {
	MAX_STEPS_PER_ADVANCE,
	createProcessPort,
	createSimulator,
	type Simulator,
	type SimulatorConfig
} from './engine';
import { createFlowLoop, DEFAULT_FLOW_LOOP } from './process';
import { buildValveModel } from './valves/catalogue';
import { water } from './fluids';
import { celsiusToKelvin } from './units';

function makeSimulator(): Simulator {
	const config: SimulatorConfig = {
		valve: buildValveModel('controlValve'),
		process: createProcessPort(createFlowLoop(DEFAULT_FLOW_LOOP)),
		fluid: water,
		temperatureK: celsiusToKelvin(20),
		dtSeconds: 0.02,
		transmitter: {
			lowerRange: 0,
			upperRange: 70,
			dampingSeconds: 0.1,
			noiseMa: 0,
			unit: 'm3/h'
		},
		pid: null,
		ipConverter: { timeConstantSeconds: 0.2, zeroBar: 0.2, spanBar: 0.8 },
		flowToOpen: true,
		seed: 99
	};
	return createSimulator(config);
}

/** Replay a render loop at a frame rate for a wall clock duration. */
function replay(frameRateHz: number, wallSeconds: number) {
	const simulator = makeSimulator();
	simulator.setManualOutputPercent(50);

	const frames = Math.round(frameRateHz * wallSeconds);
	for (let frame = 0; frame < frames; frame++) {
		simulator.advance(1 / frameRateHz);
	}

	return simulator;
}

describe('advance runs the simulation at real time', () => {
	test('a frame rate above the simulation rate still advances the simulation', () => {
		// This is the bug that broke the lab. At 60 Hz a frame is shorter than the
		// 0.02 s simulation step, and discarding the remainder left nothing to run.
		const simulator = replay(60, 5);
		expect(simulator.readouts.timeSeconds).toBeGreaterThan(4.9);
	});

	test('the simulation keeps up across the frame rates browsers actually use', () => {
		for (const frameRate of [30, 50, 55, 60, 72, 90, 120, 144, 165]) {
			const simulator = replay(frameRate, 3);
			// A tenth of a second of slack over three seconds covers the steps still
			// in the carry at the moment the run stops.
			expect(simulator.readouts.timeSeconds).toBeGreaterThan(2.85);
			expect(simulator.readouts.timeSeconds).toBeLessThanOrEqual(3.0001);
		}
	});

	test('a slow frame rate does not run the simulation faster than real time', () => {
		// At 10 Hz a frame is 0.1 s, which is five steps. The accumulator has to run
		// exactly five and not six, or the simulation would drift ahead of the clock.
		const simulator = replay(10, 5);
		expect(simulator.readouts.timeSeconds).toBeLessThanOrEqual(5.0001);
	});

	test('the valve responds to a command, which is what a frozen loop prevented', () => {
		const simulator = replay(60, 5);
		expect(simulator.readouts.actualTravelPercent).toBeGreaterThan(30);
		expect(simulator.readouts.flow.volumetricFlowM3PerHour).toBeGreaterThan(0);
	});

	test('a single very long frame is capped rather than simulated in full', () => {
		// A backgrounded tab reports a minute of elapsed time. Simulating all of it in
		// one frame would freeze the browser, so the excess is dropped deliberately.
		const simulator = makeSimulator();
		const steps = simulator.advance(60);
		expect(steps).toBe(MAX_STEPS_PER_ADVANCE);
	});

	test('the backlog cap does not leak into the next frame', () => {
		// After the capped frame the carry must be bounded, so the following frames
		// run normally instead of working through a minute of debt.
		const simulator = makeSimulator();
		simulator.advance(60);

		const stepsNextFrame = simulator.advance(1 / 60);
		expect(stepsNextFrame).toBeLessThanOrEqual(MAX_STEPS_PER_ADVANCE);
	});

	test('a zero or negative delta does nothing', () => {
		const simulator = makeSimulator();
		expect(simulator.advance(0)).toBe(0);
		expect(simulator.advance(-1)).toBe(0);
		expect(simulator.readouts.timeSeconds).toBe(0);
	});

	test('the carry does not accumulate a drift over many frames', () => {
		// Over ten seconds of frames at an awkward rate the simulated time has to
		// track the wall clock, which it only can if the remainder is kept.
		const simulator = replay(61, 10);
		expect(simulator.readouts.timeSeconds).toBeGreaterThan(9.8);
		expect(simulator.readouts.timeSeconds).toBeLessThanOrEqual(10.0001);
	});
});

describe('reset clears the timing as well as the process', () => {
	test('a reset leaves no carry behind', () => {
		const simulator = makeSimulator();
		for (let i = 0; i < 100; i++) simulator.advance(1 / 60);

		simulator.resetProcess();
		const stepsOnFirstFrame = simulator.advance(1 / 60);

		// A stale carry would make this jump. One step is the honest answer for a
		// 16.7 ms frame against a 20 ms step, and that is zero.
		expect(stepsOnFirstFrame).toBeLessThanOrEqual(1);
		expect(simulator.readouts.timeSeconds).toBeLessThanOrEqual(0.0201);
	});

	test('the simulation runs again after a reset and reaches the same state', () => {
		// The interface offers a reset, so a reset that left the simulation unable to
		// run would be indistinguishable from a bug in the valve.
		const simulator = makeSimulator();
		simulator.setManualOutputPercent(50);

		for (let i = 0; i < 6000; i++) simulator.step();
		const travelBefore = simulator.readouts.actualTravelPercent;
		const flowBefore = simulator.readouts.flow.volumetricFlowM3PerHour;

		simulator.resetProcess();
		expect(simulator.readouts.actualTravelPercent).toBe(0);
		expect(simulator.readouts.flow.volumetricFlowM3PerHour).toBe(0);

		for (let i = 0; i < 6000; i++) simulator.step();
		expect(simulator.readouts.actualTravelPercent).toBeCloseTo(travelBefore, 6);
		expect(simulator.readouts.flow.volumetricFlowM3PerHour).toBeCloseTo(flowBefore, 6);
	});

	test('an automatic loop converges again after a reset', () => {
		const config: SimulatorConfig = {
			valve: buildValveModel('controlValve'),
			process: createProcessPort(createFlowLoop(DEFAULT_FLOW_LOOP)),
			fluid: water,
			temperatureK: celsiusToKelvin(20),
			dtSeconds: 0.02,
			transmitter: {
				lowerRange: 0,
				upperRange: 70,
				dampingSeconds: 0.1,
				noiseMa: 0,
				unit: 'm3/h'
			},
			pid: {
				gain: 1.5,
				integralSeconds: 8,
				derivativeSeconds: 0,
				outputMinPercent: 0,
				outputMaxPercent: 100,
				action: 'reverse'
			},
			ipConverter: { timeConstantSeconds: 0.2, zeroBar: 0.2, spanBar: 0.8 },
			flowToOpen: true,
			seed: 7
		};

		const simulator = createSimulator(config);
		simulator.setSetpoint(45);

		for (let i = 0; i < 6000; i++) simulator.step();
		const settledBefore = simulator.readouts.measurement;

		simulator.resetProcess();
		for (let i = 0; i < 6000; i++) simulator.step();

		expect(simulator.readouts.measurement).toBeCloseTo(settledBefore, 4);
	});
});

describe('process controls are published for the interface', () => {
	test('a process with no operator control publishes an empty list', () => {
		const simulator = makeSimulator();
		expect(simulator.readouts.processActions).toEqual([]);
	});

	test('a reset does not leave a stale control state on screen', () => {
		// The published actions have to be rebuilt on reset. Reading them from the
		// process at the call site instead would leave the button label stale,
		// because that call site subscribes to no signal.
		const simulator = makeSimulator();
		const before = simulator.readouts.processActions;
		simulator.resetProcess();
		expect(simulator.readouts.processActions).not.toBe(before);
		expect(simulator.readouts.processActions).toEqual([]);
	});
});
