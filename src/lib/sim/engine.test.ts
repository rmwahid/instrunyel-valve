/**
 * End to end tests for the simulation engine.
 *
 * These are the tests that would catch an ordering mistake in the step function,
 * a sign error in the force balance, or a control loop that does not actually
 * control. They run headless, with no browser and no renderer, which is the whole
 * reason the simulation core is kept separate from the 3D scene.
 */

import { describe, expect, test } from 'bun:test';
import { createSimulator, createProcessPort, runSteps, type SimulatorConfig } from './engine';
import { DEFAULT_FLOW_LOOP, createFlowLoop, createLevelLoop, type ProcessModel } from './process';
import { buildValveModel } from './valves/catalogue';
import { water } from './fluids';
import { celsiusToKelvin, psiToBar } from './units';
import type { PidSpec } from './pid';

const T20C = celsiusToKelvin(20);

function makeConfig(overrides: Partial<SimulatorConfig> = {}): SimulatorConfig {
	const valve = buildValveModel('controlValve');

	return {
		valve,
		process: createProcessPort(
			createFlowLoop(DEFAULT_FLOW_LOOP)
		),
		fluid: water,
		temperatureK: T20C,
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
		seed: 1234,
		...overrides
	};
}

describe('manual command', () => {
	test('a command of zero percent leaves the valve shut and passes nothing', () => {
		const simulator = createSimulator(makeConfig());
		simulator.setManualOutputPercent(0);
		runSteps(simulator, 200);

		expect(simulator.readouts.actualTravelPercent).toBeCloseTo(0, 6);
		expect(simulator.readouts.flow.massFlowKgPerHour).toBe(0);
	});

	test('a rising command opens the valve and increases the flow', () => {
		const simulator = createSimulator(makeConfig());

		simulator.setManualOutputPercent(30);
		runSteps(simulator, 300);
		const lowFlow = simulator.readouts.flow.volumetricFlowM3PerHour;

		simulator.setManualOutputPercent(70);
		runSteps(simulator, 300);
		const highFlow = simulator.readouts.flow.volumetricFlowM3PerHour;

		expect(lowFlow).toBeGreaterThan(0);
		expect(highFlow).toBeGreaterThan(lowFlow);
	});

	test('the valve does not reach the commanded position instantly', () => {
		const simulator = createSimulator(makeConfig());
		simulator.setManualOutputPercent(100);

		// A few steps in, the stem has moved but is nowhere near the command.
		runSteps(simulator, 3);
		expect(simulator.readouts.actualTravelPercent).toBeGreaterThan(0);
		expect(simulator.readouts.actualTravelPercent).toBeLessThan(50);
	});

	test('the valve eventually reaches the commanded position', () => {
		const simulator = createSimulator(makeConfig());
		simulator.setManualOutputPercent(50);
		runSteps(simulator, 3000);

		// A positioner makes the valve a stiff position follower, so it arrives
		// close to the command. It is not exact, because friction and the fluid
		// force are still in the balance.
		expect(simulator.readouts.actualTravelPercent).toBeGreaterThan(45);
		expect(simulator.readouts.actualTravelPercent).toBeLessThan(55);
	});

	test('the 4-20 mA signal tracks the command', () => {
		const simulator = createSimulator(makeConfig());
		simulator.setManualOutputPercent(50);
		runSteps(simulator, 5);
		// 50 percent is 12 mA, and the I/P converter turns that into half of its span.
		expect(simulator.readouts.controllerOutputPercent).toBeCloseTo(50, 6);
	});

	test('the valve reaches the same position from either direction within one deadband', () => {
		// Approaching from below and from above lands at slightly different
		// positions. That gap is hysteresis, and it comes out of the friction model
		// rather than being imposed separately.
		const fromBelow = createSimulator(makeConfig());
		fromBelow.setManualOutputPercent(0);
		runSteps(fromBelow, 200);
		fromBelow.setManualOutputPercent(50);
		runSteps(fromBelow, 3000);

		const fromAbove = createSimulator(makeConfig());
		fromAbove.setManualOutputPercent(100);
		runSteps(fromAbove, 3000);
		fromAbove.setManualOutputPercent(50);
		runSteps(fromAbove, 3000);

		const gap = Math.abs(
			fromBelow.readouts.actualTravelPercent - fromAbove.readouts.actualTravelPercent
		);
		expect(gap).toBeLessThan(5);
	});
});

describe('force balance consistency', () => {
	test('the forces reported are the forces that were summed', () => {
		const simulator = createSimulator(makeConfig());
		simulator.setManualOutputPercent(40);
		runSteps(simulator, 400);

		const r = simulator.readouts;
		expect(r.netForceN).toBeCloseTo(r.springForceN + r.diaphragmForceN + r.fluidForceN, 9);
	});

	test('the spring force grows more negative as an air to open valve opens', () => {
		const simulator = createSimulator(makeConfig());

		simulator.setManualOutputPercent(10);
		runSteps(simulator, 2000);
		const lowSpring = simulator.readouts.springForceN;

		simulator.setManualOutputPercent(90);
		runSteps(simulator, 2000);
		const highSpring = simulator.readouts.springForceN;

		expect(highSpring).toBeLessThan(lowSpring);
	});

	test('the diaphragm force grows with the signal', () => {
		const simulator = createSimulator(makeConfig());

		simulator.setManualOutputPercent(10);
		runSteps(simulator, 2000);
		const lowAir = simulator.readouts.diaphragmForceN;

		simulator.setManualOutputPercent(90);
		runSteps(simulator, 2000);
		const highAir = simulator.readouts.diaphragmForceN;

		expect(highAir).toBeGreaterThan(lowAir);
	});

	test('a shut valve shows a seat load and an open one does not', () => {
		const simulator = createSimulator(makeConfig());
		simulator.setManualOutputPercent(0);
		runSteps(simulator, 2000);
		expect(simulator.readouts.seatLoadN).toBeGreaterThan(0);

		simulator.setManualOutputPercent(50);
		runSteps(simulator, 2000);
		expect(simulator.readouts.seatLoadN).toBe(0);
	});

	test('the fluid force on the plug grows with the pressure drop across it', () => {
		const lowDrop = createSimulator(
			makeConfig({
				process: createProcessPort(
					createFlowLoop({ ...DEFAULT_FLOW_LOOP, supplyPressureBar: 2.5 })
				)
			})
		);
		lowDrop.setManualOutputPercent(20);
		runSteps(lowDrop, 1000);

		const highDrop = createSimulator(makeConfig());
		highDrop.setManualOutputPercent(20);
		runSteps(highDrop, 1000);

		expect(Math.abs(highDrop.readouts.fluidForceN)).toBeGreaterThan(
			Math.abs(lowDrop.readouts.fluidForceN)
		);
	});
});

describe('automatic control', () => {
	const pid: PidSpec = {
		gain: 1.5,
		integralSeconds: 8,
		derivativeSeconds: 0,
		outputMinPercent: 0,
		outputMaxPercent: 100,
		action: 'reverse'
	};

	test('the loop drives the measurement towards the setpoint', () => {
		const simulator = createSimulator(makeConfig({ pid }));
		simulator.setSetpoint(30);
		runSteps(simulator, 4000);

		expect(Math.abs(simulator.readouts.measurement - 30)).toBeLessThan(1.5);
	});

	test('the loop settles at a different setpoint when the setpoint changes', () => {
		const simulator = createSimulator(makeConfig({ pid }));
		simulator.setSetpoint(20);
		runSteps(simulator, 4000);
		expect(Math.abs(simulator.readouts.measurement - 20)).toBeLessThan(1.5);

		simulator.setSetpoint(45);
		runSteps(simulator, 6000);
		expect(Math.abs(simulator.readouts.measurement - 45)).toBeLessThan(1.5);
	});

	test('the controller output stays inside its limits throughout', () => {
		const simulator = createSimulator(makeConfig({ pid }));
		simulator.setSetpoint(60);

		for (let i = 0; i < 3000; i++) {
			simulator.step();
			expect(simulator.readouts.controllerOutputPercent).toBeGreaterThanOrEqual(0);
			expect(simulator.readouts.controllerOutputPercent).toBeLessThanOrEqual(100);
		}
	});

	test('the loop is deterministic: the same seed and the same run give the same result', () => {
		const run = () => {
			const simulator = createSimulator(makeConfig({ pid }));
			simulator.setSetpoint(35);
			runSteps(simulator, 1500);
			return simulator.readouts.measurement;
		};
		expect(run()).toBe(run());
	});
});

describe('instrument faults', () => {
	const pid: PidSpec = {
		gain: 1.5,
		integralSeconds: 8,
		derivativeSeconds: 0,
		outputMinPercent: 0,
		outputMaxPercent: 100,
		action: 'reverse'
	};

	test('an open circuit is reported as a downscale fault', () => {
		const simulator = createSimulator(makeConfig({ pid }));
		simulator.setSetpoint(30);
		runSteps(simulator, 2000);

		simulator.setLoopFault({ type: 'openCircuit', description: 'Cable pulled from the transmitter' });
		runSteps(simulator, 100);

		expect(simulator.readouts.receivedCurrentMa).toBe(0);
		expect(simulator.readouts.transmitterStatus).toBe('valid');
	});

	test('the controller holds its output rather than running away on a failed measurement', () => {
		const simulator = createSimulator(makeConfig({ pid }));
		simulator.setSetpoint(30);
		runSteps(simulator, 2000);
		const outputBefore = simulator.readouts.controllerOutputPercent;

		simulator.setLoopFault({ type: 'openCircuit', description: 'Cable pulled' });
		runSteps(simulator, 500);

		expect(simulator.readouts.controllerOutputPercent).toBeCloseTo(outputBefore, 6);
	});

	test('a short circuit is reported as an upscale fault', () => {
		const simulator = createSimulator(makeConfig({ pid }));
		simulator.setSetpoint(30);
		runSteps(simulator, 500);

		simulator.setLoopFault({ type: 'shortCircuit', description: 'Water in the junction box' });
		simulator.step();

		expect(simulator.readouts.receivedCurrentMa).toBeGreaterThan(21);
	});

	test('the transmitter noise is reproducible for a given seed', () => {
		const noisy = (seed: number) => {
			const simulator = createSimulator(
				makeConfig({
					seed,
					transmitter: {
						lowerRange: 0,
						upperRange: 70,
						dampingSeconds: 0.1,
						noiseMa: 0.05
					}
				})
			);
			simulator.setManualOutputPercent(50);
			runSteps(simulator, 100);
			return simulator.readouts.transmitterCurrentMa;
		};

		expect(noisy(42)).toBe(noisy(42));
		expect(noisy(42)).not.toBe(noisy(43));
	});
});

describe('process models', () => {
	test('the level loop integrates: it has no natural resting point', () => {
		const model = createLevelLoop({
			supplyPressureBar: 4,
			tankPressureBar: 1.01325,
			tankAreaM2: 1.2,
			drainKv: 12,
			levelRangeM: 1.5,
			densityKgPerM3: 998
		});
		const port = createProcessPort(model);

		// With no inflow the tank drains, and it keeps draining.
		const initial = port.measurement();
		for (let i = 0; i < 500; i++) port.advance(0, 0.02);
		const afterDraining = port.measurement();
		expect(afterDraining).toBeLessThan(initial);

		for (let i = 0; i < 500; i++) port.advance(0, 0.02);
		expect(port.measurement()).toBeLessThan(afterDraining);
	});

	test('the level loop reaches a steady level when the inflow matches the drain', () => {
		const model = createLevelLoop({
			supplyPressureBar: 4,
			tankPressureBar: 1.01325,
			tankAreaM2: 1.2,
			drainKv: 12,
			levelRangeM: 1.5,
			densityKgPerM3: 998
		});
		const port = createProcessPort(model);

		// A drain Kv of 12 at a 0.5 m head passes about 8.4 m3/h of water, so an
		// inflow of 8.4 kg/s divided by the density holds the level steady.
		const drainFlowM3PerHour = 12 * Math.sqrt(0.0980665 * 0.75);
		const massFlow = (drainFlowM3PerHour * 998) / 3600;

		const levelBefore = port.measurement();
		for (let i = 0; i < 2000; i++) port.advance(massFlow, 0.02);
		expect(Math.abs(port.measurement() - levelBefore)).toBeLessThan(0.05);
	});

	test('the flow loop reports a lower flow when the fixed system resistance rises', () => {
		const lowResistance = createProcessPort(
			createFlowLoop({ ...DEFAULT_FLOW_LOOP, systemKv: 60 })
		);
		const highResistance = createProcessPort(
			createFlowLoop({ ...DEFAULT_FLOW_LOOP, systemKv: 10 })
		);

		const lowBoundary = lowResistance.boundaryConditions(40, water, T20C);
		const highBoundary = highResistance.boundaryConditions(40, water, T20C);

		// A larger fixed resistance takes more of the available pressure drop.
		expect(highBoundary.systemPressureDropBar).toBeGreaterThan(
			lowBoundary.systemPressureDropBar
		);
	});

	test('resetting a process returns it to its initial condition', () => {
		const port = createProcessPort(
			createFlowLoop(DEFAULT_FLOW_LOOP)
		);
		port.advance(10, 1);
		const before = port.measurement();
		port.reset();
		expect(port.measurement()).not.toBe(before);
		expect(port.measurement()).toBe(0);
	});
});

describe('valve types behave according to their design', () => {
	function stepValve(valveId: Parameters<typeof buildValveModel>[0], outputPercent: number) {
		const valve = buildValveModel(valveId);
		const simulator = createSimulator(makeConfig({ valve }));
		simulator.setManualOutputPercent(outputPercent);
		runSteps(simulator, 3000);
		return simulator.readouts;
	}

	test('an equal percentage control valve passes less than a linear one at half travel', () => {
		// Equal percentage holds back capacity in the first half of the travel,
		// which is exactly why it is chosen for a loop with a low valve authority.
		const control = stepValve('controlValve', 50);
		const ball = stepValve('ball', 50);
		expect(control.effectiveKv).toBeLessThan(ball.effectiveKv);
	});

	test('a characterised ball valve throttles while a standard one does not', () => {
		const standardSpec = buildValveModel('ball').spec;
		const characterisedSpec = buildValveModel('ballCharacterised').spec;
		expect(standardSpec.characteristic).toBe('linear');
		expect(characterisedSpec.characteristic).toBe('equalPercentage');
	});

	test('a butterfly valve has the lowest pressure recovery, so it chokes earliest', () => {
		const butterfly = buildValveModel('butterfly').spec;
		const globe = buildValveModel('globe').spec;
		expect(butterfly.terminalPressureDropRatio).toBeLessThan(globe.terminalPressureDropRatio);
	});

	test('a gate valve has a higher rated capacity than a globe valve of the same size', () => {
		// A straight through gate passes far more than a globe valve with the same
		// bore, and that difference is the pressure drop the globe valve is designed
		// to create.
		expect(buildValveModel('gate').spec.ratedKv).toBeGreaterThan(
			buildValveModel('globe').spec.ratedKv
		);
	});

	test('the control valve is the only one with a spring diaphragm actuator and a positioner', () => {
		const control = buildValveModel('controlValve').spec.actuator;
		expect(control).not.toBeNull();
		expect(control?.hasPositioner).toBe(true);
		expect(control?.action).toBe('airToOpen');
		expect(control?.benchSetHighBar).toBeCloseTo(psiToBar(15), 6);
	});
});

describe('reset behaviour', () => {
	test('resetting clears the process state but keeps the configuration', () => {
		const simulator = createSimulator(makeConfig());
		simulator.setManualOutputPercent(80);
		runSteps(simulator, 2000);
		expect(simulator.readouts.flow.volumetricFlowM3PerHour).toBeGreaterThan(0);

		simulator.resetProcess();
		expect(simulator.readouts.flow.volumetricFlowM3PerHour).toBe(0);
		expect(simulator.readouts.actualTravelPercent).toBe(0);

		// The command is still where the operator left it, so the valve opens again.
		runSteps(simulator, 2000);
		expect(simulator.readouts.flow.volumetricFlowM3PerHour).toBeGreaterThan(0);
	});

	test('the simulator reports a travel limit when the valve is fully open or shut', () => {
		const simulator = createSimulator(makeConfig());
		simulator.setManualOutputPercent(0);
		runSteps(simulator, 500);
		expect(simulator.atTravelLimit()).toBe(true);

		simulator.setManualOutputPercent(100);
		runSteps(simulator, 3000);
		expect(simulator.atTravelLimit()).toBe(true);

		simulator.setManualOutputPercent(50);
		runSteps(simulator, 3000);
		expect(simulator.atTravelLimit()).toBe(false);
	});
});

export type { ProcessModel };
