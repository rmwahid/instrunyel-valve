/**
 * Build a running simulator from a scenario.
 *
 * The mapping from scenario data to engine configuration lives here rather than in
 * a component, so a scenario can be started in a test or a script as easily as it
 * can in the browser. That is what makes the scenarios verifiable rather than just
 * descriptive.
 */

import {
	createProcessPort,
	createSimulator,
	type ProcessPort,
	type Simulator,
	type SimulatorConfig
} from '$lib/sim/engine';
import { createControlValve, createGateValve, createGlobeValve } from '$lib/sim/valves/linear';
import {
	createBallValve,
	createButterflyValve,
	createPlugValve,
	createRotaryActuator,
	quarterTurnStrokeM
} from '$lib/sim/valves/rotary';
import { createCheckValve } from '$lib/sim/valves/selfActing';
import { buildValveModel } from '$lib/sim/valves/catalogue';
import { FRICTION_PRESETS } from '$lib/sim/friction';
import type { PidSpec } from '$lib/sim/pid';
import type { ValveModel } from '$lib/sim/valves/types';
import { DEFAULT_FLOW_LOOP, DEFAULT_LEVEL_LOOP, createFlowLoop, createLevelLoop } from '$lib/sim/process';
import { createCheckValveRig, createReliefVessel, DEFAULT_CHECK_VALVE_RIG, DEFAULT_RELIEF_VESSEL } from '$lib/sim/process';
import { createProcessForScenario, type Scenario } from './scenario';

/** The fixed simulation step, in seconds. */
export const SIMULATION_STEP_SECONDS = 0.02;

/**
 * Replace the packing on a valve to reproduce a maintenance fault.
 *
 * Worn graphite packing is the classic case: the valve worked on the bench and
 * sticks in service. Exposing it as a scenario option means the lab can show the
 * difference rather than only describing it.
 */
function applyWornPacking<T extends ValveModel>(model: T): T {
	return {
		...model,
		spec: {
			...model.spec,
			friction: { ...FRICTION_PRESETS.graphiteWorn }
		}
	};
}

/**
 * Build the valve a scenario asks for.
 *
 * The catalogue defaults are used where the scenario says nothing, and every
 * override is applied on top. Building through the same factories the catalogue
 * uses keeps a scenario valve identical to a catalogue valve with the same
 * settings, which is what makes a scenario a configuration of the catalogue rather
 * than a separate thing.
 */
export function buildScenarioValve(scenario: Scenario): ValveModel {
	const withPositioner = scenario.withPositioner ?? true;
	const balanced = scenario.balanced ?? false;
	const size = scenario.nominalSizeInch;
	const strokeM = 0.04;

	switch (scenario.valveId) {
		case 'gate':
			return createGateValve({ nominalSizeInch: size });

		case 'globe':
			return createGlobeValve({ nominalSizeInch: size });

		case 'controlValve': {
			const model = createControlValve({
				nominalSizeInch: size,
				ratedKv: scenario.ratedKv ?? 63,
				characteristic: scenario.characteristic ?? 'equalPercentage',
				withPositioner,
				balanced,
				strokeM,
				flowToOpen: true,
				failAction: 'failClosed',
				supplyPressureBar: scenario.supplyPressureBar
			});
			return scenario.wornPacking ? applyWornPacking(model) : model;
		}

		case 'ball':
			return createBallValve({ nominalSizeInch: size, characterised: false });

		case 'ballCharacterised': {
			const model = createBallValve({
				nominalSizeInch: size,
				ratedKv: scenario.ratedKv ?? 90,
				characterised: true,
				actuator: withPositioner
					? createRotaryActuator({
							nominalSizeInch: size,
							strokeM: quarterTurnStrokeM(size),
							withPositioner: true,
							failAction: 'failClosed',
							supplyPressureBar: scenario.supplyPressureBar
						})
					: null
			});
			return scenario.wornPacking ? applyWornPacking(model) : model;
		}

		case 'butterfly': {
			const model = createButterflyValve({
				nominalSizeInch: size,
				ratedKv: scenario.ratedKv ?? 1150,
				actuator: withPositioner
					? createRotaryActuator({
							nominalSizeInch: size,
							// A butterfly needs a larger actuator than its size suggests,
							// because its dynamic torque peaks at part travel.
							effectiveAreaM2: 0.04,
							strokeM: quarterTurnStrokeM(size),
							withPositioner: true,
							failAction: 'failClosed',
							supplyPressureBar: scenario.supplyPressureBar
						})
					: null
			});
			return scenario.wornPacking ? applyWornPacking(model) : model;
		}

		case 'plug':
			return createPlugValve({ nominalSizeInch: size });

		case 'check-swing':
			return createCheckValve({ nominalSizeInch: size, design: 'swing' });

		case 'check-dualPlate':
			return createCheckValve({ nominalSizeInch: size, design: 'dualPlate' });

		case 'relief': {
			const relief = buildValveModel('relief');
			return scenario.wornPacking ? applyWornPacking(relief) : relief;
		}
	}
}

/** Build the PID specification a scenario asks for, or null when it is manual. */
export function pidForScenario(scenario: Scenario): PidSpec | null {
	if (scenario.pidGain === undefined) return null;
	return {
		gain: scenario.pidGain,
		integralSeconds: scenario.pidIntegralSeconds ?? 0,
		derivativeSeconds: scenario.pidDerivativeSeconds ?? 0,
		outputMinPercent: 0,
		outputMaxPercent: 100,
		action: 'reverse'
	};
}

export interface ScenarioSimulator {
	simulator: Simulator;
	/** The ported process, which owns the operator controls. */
	process: ProcessPort;
}

/**
 * Build a simulator and its process for a scenario.
 *
 * The process range comes from the process model itself rather than from the
 * scenario, so the transmitter is always scaled to what the process can actually
 * produce and a scenario cannot accidentally configure an instrument that clips.
 */
export function createSimulatorForScenario(scenario: Scenario): ScenarioSimulator {
	const valve = buildScenarioValve(scenario);
	const process = createProcessPort(createProcessForScenario(scenario));

	const config: SimulatorConfig = {
		valve,
		process,
		fluid: scenario.fluid,
		temperatureK: scenario.temperatureK,
		dtSeconds: SIMULATION_STEP_SECONDS,
		transmitter: {
			lowerRange: process.controlledRange.min,
			upperRange: process.controlledRange.max,
			dampingSeconds: 0.15,
			noiseMa: 0.02,
			resolutionMa: 0.001,
			unit: process.controlledUnit
		},
		pid: pidForScenario(scenario),
		ipConverter: {
			timeConstantSeconds: 0.25,
			zeroBar: 0.2,
			spanBar: 0.8,
			gainError: scenario.ipGainError ?? 0,
			zeroOffsetBar: scenario.ipZeroOffsetBar ?? 0
		},
		flowToOpen: true,
		seed: 20260911
	};

	const simulator = createSimulator(config);

	if (scenario.setpoint !== undefined) simulator.setSetpoint(scenario.setpoint);
	if (scenario.manualOutputPercent !== undefined) {
		simulator.setManualOutputPercent(scenario.manualOutputPercent);
	}

	return { simulator, process };
}

/**
 * Build a valve for a catalogue entry, so the gallery can show a valve outside the
 * context of any scenario.
 */
export function buildValveForCatalogue(id: Parameters<typeof buildValveModel>[0]): ValveModel {
	return buildValveModel(id);
}

/** The default process specifications, exposed so a script can reproduce a scenario. */
export const PROCESS_DEFAULTS = {
	flowLoop: DEFAULT_FLOW_LOOP,
	levelLoop: DEFAULT_LEVEL_LOOP,
	checkValveRig: DEFAULT_CHECK_VALVE_RIG,
	reliefVessel: DEFAULT_RELIEF_VESSEL
} as const;

export { createFlowLoop, createLevelLoop, createCheckValveRig, createReliefVessel };
