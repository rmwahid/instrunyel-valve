/**
 * Tests for the relief valve and the vessel it protects.
 *
 * These cover the behaviour that the scenario smoke test found to be wrong the
 * first time: a relief valve that passed no flow at all, and a vessel whose
 * pressure integration was unstable. Both were real bugs and both would have been
 * visible to any student, which is why they are pinned here.
 */

import { describe, expect, test } from 'bun:test';
import { createProcessPort, createSimulator, runSteps, type SimulatorConfig } from './engine';
import {
	DEFAULT_RELIEF_VESSEL,
	createReliefVessel,
	type ReliefVesselSpec
} from './process';
import { buildValveModel, isReliefValve } from './valves/catalogue';
import { saturatedSteam, water } from './fluids';
import { celsiusToKelvin } from './units';

const T20C = celsiusToKelvin(20);
const T160C = celsiusToKelvin(160);

function makeReliefConfig(options: {
	fluid?: typeof water;
	temperatureK?: number;
	vessel?: Partial<ReliefVesselSpec>;
} = {}): SimulatorConfig {
	const process = createProcessPort(
		createReliefVessel({ ...DEFAULT_RELIEF_VESSEL, ...(options.vessel ?? {}) })
	);

	return {
		valve: buildValveModel('relief'),
		process,
		fluid: options.fluid ?? water,
		temperatureK: options.temperatureK ?? T20C,
		dtSeconds: 0.02,
		transmitter: {
			lowerRange: 0,
			upperRange: 25,
			dampingSeconds: 0.1,
			noiseMa: 0,
			unit: 'bar'
		},
		pid: null,
		ipConverter: { timeConstantSeconds: 0.25, zeroBar: 0.2, spanBar: 0.8 },
		flowToOpen: true,
		seed: 4242
	};
}

/** Run the vessel with the upset active and report the settled condition. */
function runUpset(config: SimulatorConfig, steps = 6000) {
	const simulator = createSimulator(config);
	for (const action of config.process.actions) action.apply(true);
	runSteps(simulator, steps);
	return simulator.readouts;
}

describe('relief valve capacity equations', () => {
	test('a liquid duty passes far more mass than a gas duty through the same orifice', () => {
		// This comparison is why the two equations both exist. Water is about 800
		// times denser than air, so the same orifice passes roughly two orders of
		// magnitude more mass on a liquid duty. Sizing a liquid relief valve with the
		// gas equation would badly undersize it, and sizing a gas relief valve with
		// the liquid equation would badly oversize it. The valve picks the branch
		// from the fluid phase for exactly this reason.
		const valve = buildValveModel('relief');
		if (!isReliefValve(valve)) throw new Error('expected a relief valve');

		const gasCapacityKgPerHour = valve.capacity({
			inletPressureBarAbsolute: 12,
			outletPressureBarAbsolute: 1.01325,
			temperatureK: T20C,
			molarMassKgPerMol: 0.0289645,
			specificHeatRatio: 1.4
		}).massFlowKgPerHour;

		const orificeAreaM2 = valve.orificeAreaM2();
		const liquidCapacityKgPerHour =
			0.65 * orificeAreaM2 * Math.sqrt((2 * (12 - 1.01325) * 1e5) / 998) * 998 * 3600;

		// Both figures are physically sensible in their own right.
		expect(gasCapacityKgPerHour).toBeGreaterThan(1000);
		expect(gasCapacityKgPerHour).toBeLessThan(20000);
		expect(liquidCapacityKgPerHour).toBeGreaterThan(50000);

		// And the liquid duty is the larger of the two by a wide margin.
		expect(liquidCapacityKgPerHour).toBeGreaterThan(gasCapacityKgPerHour * 5);
	});

	test('the gas capacity is unaffected by the discharge pressure when choked', () => {
		const valve = buildValveModel('relief');
		if (!isReliefValve(valve)) throw new Error('expected a relief valve');

		const base = {
			inletPressureBarAbsolute: 12,
			temperatureK: T20C,
			molarMassKgPerMol: 0.0289645,
			specificHeatRatio: 1.4
		};

		const toAtmosphere = valve.capacity({ ...base, outletPressureBarAbsolute: 1.01325 });
		const toPressurised = valve.capacity({ ...base, outletPressureBarAbsolute: 4 });

		expect(toAtmosphere.choked).toBe(true);
		expect(toPressurised.massFlowKgPerHour).toBeCloseTo(toAtmosphere.massFlowKgPerHour, 6);
	});
});

describe('relief valve through the engine', () => {
	test('the valve passes nothing while the vessel is below its set pressure', () => {
		const config = makeReliefConfig({ vessel: { initialPressureBar: 4 } });
		const simulator = createSimulator(config);
		// No upset: the vessel sits at its initial pressure, well below the 10 bar
		// gauge set point.
		runSteps(simulator, 1000);

		expect(simulator.readouts.actualTravelPercent).toBeCloseTo(0, 6);
		expect(simulator.readouts.flow.massFlowKgPerHour).toBe(0);
	});

	test('the valve lifts when the vessel pressure reaches the set point', () => {
		const config = makeReliefConfig();
		const readouts = runUpset(config);

		expect(readouts.actualTravelPercent).toBeGreaterThan(0);
		expect(readouts.flow.massFlowKgPerHour).toBeGreaterThan(0);
	});

	test('the pressure settles below the design pressure when the capacity is sufficient', () => {
		// The whole point of the relief scenario: a correctly sized valve holds the
		// vessel pressure, so the mass balance closes and the pressure stops rising.
		const config = makeReliefConfig();
		const readouts = runUpset(config);
		const gaugeBar = readouts.measurement - 1.01325;

		expect(gaugeBar).toBeGreaterThan(9);
		expect(gaugeBar).toBeLessThan(DEFAULT_RELIEF_VESSEL.designPressureBarGauge);
	});

	test('the relieving flow balances the upset inflow', () => {
		// A settled relief valve passes exactly what is entering the vessel. If it
		// did not, the pressure would still be moving.
		const config = makeReliefConfig();
		const readouts = runUpset(config);

		expect(readouts.flow.massFlowKgPerHour).toBeCloseTo(
			DEFAULT_RELIEF_VESSEL.upsetInflowKgPerHour,
			0
		);
	});

	test('the settled condition is steady rather than oscillating', () => {
		// The blowdown hysteresis has to keep the valve open instead of letting it
		// chatter, which is what it is for. Ten more seconds must not move it.
		const config = makeReliefConfig();
		const simulator = createSimulator(config);
		for (const action of config.process.actions) action.apply(true);

		runSteps(simulator, 6000);
		const settled = simulator.readouts.measurement;
		const settledTravel = simulator.readouts.actualTravelPercent;

		runSteps(simulator, 500);
		expect(simulator.readouts.measurement).toBeCloseTo(settled, 6);
		expect(simulator.readouts.actualTravelPercent).toBeCloseTo(settledTravel, 6);
	});

	test('the pressure keeps rising when the capacity is genuinely exceeded', () => {
		// The other half of the lesson. With an inflow far above the orifice
		// capacity, no set pressure can save the vessel.
		const config = makeReliefConfig({
			vessel: { upsetInflowKgPerHour: 400000, designPressureBarGauge: 12 }
		});
		const readouts = runUpset(config);

		expect(readouts.measurement - 1.01325).toBeGreaterThan(
			DEFAULT_RELIEF_VESSEL.designPressureBarGauge
		);
	});
});

describe('relief vessel pressure model', () => {
	test('a gas service and a liquid service give different capacitances', () => {
		// A gas filled vessel moves far faster for the same mass inflow, because its
		// capacitance is the vessel volume rather than a vapour space above a liquid.
		const liquid = runUpset(makeReliefConfig({ vessel: { upsetInflowKgPerHour: 20000 } }));
		const gas = runUpset(
			makeReliefConfig({
				fluid: saturatedSteam,
				temperatureK: T160C,
				vessel: { upsetInflowKgPerHour: 20000 }
			})
		);

		// Both end up relieving, but the gas vessel reaches its relief pressure far
		// sooner, which shows up as a higher final pressure for the same inflow cap.
		expect(gas.measurement).toBeGreaterThan(0);
		expect(liquid.measurement).toBeGreaterThan(0);
		expect(gas.measurement).not.toBeCloseTo(liquid.measurement, 1);
	});

	test('the vessel reports its own phase-appropriate inventory', () => {
		const liquidPort = createProcessPort(createReliefVessel(DEFAULT_RELIEF_VESSEL));
		liquidPort.boundaryConditions(1, water, T20C);
		const liquidLabels = liquidPort.readouts().map((item) => item.label);
		expect(liquidLabels).toContain('Liquid inventory');

		const gasPort = createProcessPort(createReliefVessel(DEFAULT_RELIEF_VESSEL));
		gasPort.boundaryConditions(1, saturatedSteam, T160C);
		const gasLabels = gasPort.readouts().map((item) => item.label);
		expect(gasLabels).toContain('Gas inventory');
	});

	test('resetting the vessel clears its inventory and its relief state', () => {
		const port = createProcessPort(createReliefVessel(DEFAULT_RELIEF_VESSEL));
		port.boundaryConditions(1, water, T20C);
		for (const action of port.actions) action.apply(true);

		for (let i = 0; i < 2000; i++) port.advance(12, 0.02);
		expect(port.measurement()).toBeGreaterThan(DEFAULT_RELIEF_VESSEL.initialPressureBar);

		port.reset();
		expect(port.measurement()).toBeCloseTo(DEFAULT_RELIEF_VESSEL.initialPressureBar, 6);
	});
});

describe('relief valve model contract', () => {
	test('the relief valve states its own flow and opening laws', () => {
		const valve = buildValveModel('relief');
		expect(valve.computeFlow).toBeDefined();
		expect(valve.computeOpening).toBeDefined();
	});

	test('a check valve does not state its own laws, because a spring ramp describes it', () => {
		const check = buildValveModel('check-swing');
		expect(check.computeFlow).toBeUndefined();
		expect(check.computeOpening).toBeUndefined();
	});

	test('the relief opening law holds the valve open below the set pressure once lifted', () => {
		// This is blowdown, and it is the reason the settled condition in the engine
		// test above is steady rather than chattering.
		const valve = buildValveModel('relief');
		if (!isReliefValve(valve) || !valve.computeOpening) {
			throw new Error('expected a relief valve with an opening law');
		}

		const justBelowSet = valve.setPressureBarGauge() - 0.2;

		const neverOpened = valve.computeOpening({
			pressureDifferenceBar: justBelowSet,
			wasOpen: false,
			fluid: water
		});
		const alreadyOpen = valve.computeOpening({
			pressureDifferenceBar: justBelowSet,
			wasOpen: true,
			fluid: water
		});

		expect(neverOpened).toBe(0);
		expect(alreadyOpen).toBeGreaterThan(0);
	});
});
