/**
 * Lab scenarios: a valve, a process and the settings that make a point worth
 * demonstrating.
 *
 * A scenario is what turns the engine into a lesson. The same control valve can
 * be used to show force balance, stiction, cavitation or tuning, and the
 * difference is entirely in the process it is placed in and the settings it is
 * given. Keeping that as data means the UI has nothing to decide.
 */

import { celsiusToKelvin } from '$lib/sim/units';
import type { ValveId } from '$lib/sim/valves/catalogue';
import {
	DEFAULT_FLOW_LOOP,
	DEFAULT_LEVEL_LOOP,
	DEFAULT_RELIEF_VESSEL,
	DEFAULT_CHECK_VALVE_RIG,
	createFlowLoop,
	createLevelLoop,
	createReliefVessel,
	createCheckValveRig,
	type ProcessModel
} from '$lib/sim/process';
import { saturatedSteam, water, type Fluid } from '$lib/sim/fluids';
import type { InherentCharacteristic } from '$lib/sim/characteristic';

export type ProcessKind = 'flowLoop' | 'levelLoop' | 'checkValveRig' | 'reliefVessel';

export interface Scenario {
	id: string;
	name: string;
	valveId: ValveId;
	processKind: ProcessKind;
	fluid: Fluid;
	temperatureK: number;
	/** One paragraph on what this scenario is for. */
	purpose: string;
	/** The instructions a student should follow. */
	steps: string[];
	/** Characteristic to build the valve with, when the valve has a choice. */
	characteristic?: InherentCharacteristic;
	/** Nominal size in inches. */
	nominalSizeInch: number;
	/** Rated flow coefficient, overriding the catalogue default. */
	ratedKv?: number;
	/** True to fit a positioner, when the actuator supports one. */
	withPositioner?: boolean;
	/** True to use a balanced trim. */
	balanced?: boolean;
	/** True to use the worn graphite packing that produces noticeable stiction. */
	wornPacking?: boolean;
	/** Loop tuning, when the scenario runs in automatic. */
	pidGain?: number;
	pidIntegralSeconds?: number;
	pidDerivativeSeconds?: number;
	/** Initial setpoint, in the controlled variable's units. */
	setpoint?: number;
	/** Initial manual output, percent. */
	manualOutputPercent?: number;
	/** Air supply pressure, bar gauge, when the headroom matters. */
	supplyPressureBar?: number;
	/** I/P converter calibration, when a fault is the point. */
	ipGainError?: number;
	ipZeroOffsetBar?: number;
	/**
	 * Overrides for the process specification.
	 *
	 * A scenario is a complete system design, not just a valve on a bench, so the
	 * piping around the valve has to suit the valve. The same flow loop that makes a
	 * 2 inch control valve work would leave a 6 inch butterfly wide open for its
	 * whole range, because the butterfly's capacity dwarfs the resistance of the
	 * line it is sitting in. Stating the system resistance per scenario is what
	 * keeps each lesson about the valve rather than about a mismatch.
	 */
	processOverrides?: Partial<ProcessSpecs>;
}

/** The process specifications a scenario can override. */
export interface ProcessSpecs {
	supplyPressureBar: number;
	dischargePressureBar: number;
	systemKv: number;
	flowRangeM3PerHour: number;
	tankAreaM2: number;
	drainKv: number;
	levelRangeM: number;
	upsetInflowKgPerHour: number;
	normalInflowKgPerHour: number;
	designPressureBarGauge: number;
}

/**
 * Build the process model a scenario asks for.
 *
 * The process models are constructed here rather than stored on the scenario, so a
 * scenario is plain data that can be listed, compared and serialised.
 */
export function createProcessForScenario(scenario: Scenario): ProcessModel<unknown> {
	const overrides = scenario.processOverrides ?? {};

	switch (scenario.processKind) {
		case 'flowLoop':
			return createFlowLoop({
				...DEFAULT_FLOW_LOOP,
				...(overrides.supplyPressureBar !== undefined
					? { supplyPressureBar: overrides.supplyPressureBar }
					: {}),
				...(overrides.dischargePressureBar !== undefined
					? { dischargePressureBar: overrides.dischargePressureBar }
					: {}),
				...(overrides.systemKv !== undefined ? { systemKv: overrides.systemKv } : {}),
				...(overrides.flowRangeM3PerHour !== undefined
					? { flowRangeM3PerHour: overrides.flowRangeM3PerHour }
					: {})
			}) as ProcessModel<unknown>;

		case 'levelLoop':
			return createLevelLoop({
				...DEFAULT_LEVEL_LOOP,
				...(overrides.systemKv !== undefined ? { drainKv: overrides.systemKv } : {}),
				...(overrides.levelRangeM !== undefined
					? { levelRangeM: overrides.levelRangeM }
					: {}),
				...(overrides.tankAreaM2 !== undefined ? { tankAreaM2: overrides.tankAreaM2 } : {})
			}) as ProcessModel<unknown>;

		case 'checkValveRig':
			return createCheckValveRig(DEFAULT_CHECK_VALVE_RIG) as ProcessModel<unknown>;

		case 'reliefVessel':
			return createReliefVessel({
				...DEFAULT_RELIEF_VESSEL,
				...(overrides.upsetInflowKgPerHour !== undefined
					? { upsetInflowKgPerHour: overrides.upsetInflowKgPerHour }
					: {}),
				...(overrides.normalInflowKgPerHour !== undefined
					? { normalInflowKgPerHour: overrides.normalInflowKgPerHour }
					: {}),
				...(overrides.designPressureBarGauge !== undefined
					? { designPressureBarGauge: overrides.designPressureBarGauge }
					: {})
			}) as ProcessModel<unknown>;
	}
}

/** True when the scenario's process is driven by a controller rather than by hand. */
export function isControllerScenario(scenario: Scenario): boolean {
	return scenario.pidGain !== undefined;
}

const WATER_20C = celsiusToKelvin(20);
const STEAM_160C = celsiusToKelvin(160);

export const SCENARIOS: readonly Scenario[] = [
	{
		id: 'gate-isolation',
		name: 'Gate valve: isolation and its limits',
		valveId: 'gate',
		processKind: 'flowLoop',
		fluid: water,
		temperatureK: WATER_20C,
		nominalSizeInch: 2,
		manualOutputPercent: 50,
		purpose:
			'A gate valve wide open passes far more than a globe valve of the same size. Open it fully and watch the flow, then try to throttle with it and see how little control the position actually gives you over a wide band.',
		steps: [
			'Set the command to 100 percent and note the flow. The straight through path means almost no pressure drop.',
			'Set the command to 50 percent. The flow falls, but the curve is steep and the setting is not precise.',
			'Compare the flow at 45 and 55 percent. A valve meant for control would resolve this finely; a gate valve does not.',
			'Look at the unbalance force readout. The full bore area carries the pressure drop, which is why a large gate valve needs a gearbox to operate.'
		]
	},
	{
		id: 'gate-vs-globe',
		name: 'Gate against globe: pressure drop',
		valveId: 'globe',
		processKind: 'flowLoop',
		fluid: water,
		temperatureK: WATER_20C,
		nominalSizeInch: 2,
		manualOutputPercent: 100,
		purpose:
			'The same line size and the same fully open position, but a globe valve drops several times the pressure of a gate valve. That lost pressure is the price of controllability.',
		steps: [
			'With the valve fully open, note the flow and the pressure drop across the valve.',
			'Switch to the gate valve scenario and compare at the same opening.',
			'The globe valve passes much less because its flow coefficient is lower: the tortuous path is the point.',
			'Now imagine the plant paying for that pressure drop continuously. This is why a globe valve is not used for isolation.'
		]
	},
	{
		id: 'control-loop-basic',
		name: 'Control valve: automatic flow control',
		valveId: 'controlValve',
		processKind: 'flowLoop',
		fluid: water,
		temperatureK: WATER_20C,
		nominalSizeInch: 2,
		ratedKv: 63,
		characteristic: 'equalPercentage',
		withPositioner: true,
		pidGain: 1.5,
		pidIntegralSeconds: 8,
		pidDerivativeSeconds: 0,
		setpoint: 45,
		purpose:
			'The valve now closes a loop. The controller decides the command from the flow measurement, and the whole signal chain runs: measurement, 4-20 mA, controller, I/P converter, positioner, actuator.',
		steps: [
			'Watch the loop settle on the setpoint. The valve finds a position and stays there.',
			'Change the setpoint and watch the valve move. The integral term removes the offset that proportional alone would leave.',
			'Turn the positioner off in the actuator settings and watch how much less accurately the valve follows its command.',
			'Read the following error: it is the gap between what the controller asked for and where the valve actually is.'
		]
	},
	{
		id: 'control-valve-authority',
		name: 'Valve authority and installed characteristic',
		valveId: 'controlValve',
		processKind: 'flowLoop',
		fluid: water,
		temperatureK: WATER_20C,
		nominalSizeInch: 2,
		ratedKv: 63,
		characteristic: 'equalPercentage',
		withPositioner: true,
		manualOutputPercent: 50,
		purpose:
			'The valve owns only about a third of the total pressure drop, so as it opens it loses the pressure drop it needs. The chart shows the installed characteristic departing from the inherent one, which is the reason equal percentage is the usual choice.',
		steps: [
			'Open the characteristic chart and compare the two curves.',
			'Set the valve to 30 percent and note the pressure drop it keeps. Then set it to 90 percent and note it again.',
			'The valve has less pressure drop available exactly when it is passing the most flow.',
			'Switch the trim to linear and watch the installed curve steepen. That steepness is what makes a loop oscillate at high flow.'
		]
	},
	{
		id: 'control-valve-stiction',
		name: 'Control valve: stiction and deadband',
		valveId: 'controlValve',
		processKind: 'flowLoop',
		fluid: water,
		temperatureK: WATER_20C,
		nominalSizeInch: 2,
		ratedKv: 63,
		characteristic: 'equalPercentage',
		withPositioner: false,
		wornPacking: true,
		manualOutputPercent: 50,
		purpose:
			'A valve with worn graphite packing and no positioner. The packing holds the stem until enough force builds up, then it jumps. This is the behaviour that no amount of controller tuning can fix.',
		steps: [
			'Change the command in small steps of one or two percent and watch the travel readout. It does not move until it suddenly does.',
			'Note the deadband figure in the force balance panel. That is the travel the valve loses every time it reverses.',
			'Compare this scenario with the positioned valve. The positioner keeps increasing the pressure until the stem breaks away, which is why it hides the stiction.'
		]
	},
	{
		id: 'control-valve-force-balance',
		name: 'Control valve: force balance and unbalance',
		valveId: 'controlValve',
		processKind: 'flowLoop',
		fluid: water,
		temperatureK: WATER_20C,
		nominalSizeInch: 2,
		ratedKv: 63,
		characteristic: 'equalPercentage',
		withPositioner: false,
		balanced: false,
		manualOutputPercent: 20,
		purpose:
			'The actuator is a force balance, not a position servo. Watch the four forces change as the valve moves and the pressure drop changes with it.',
		steps: [
			'Look at the force panel at a low opening. The fluid force on the plug is a significant share of the diaphragm force.',
			'Open the valve further. The pressure drop falls, so the fluid force falls with it, and the spring compresses further.',
			'Switch on the balanced trim and watch the fluid force collapse. That is why a balanced plug needs a smaller actuator.',
			'Note the bench set. It is the two air pressures at which the stem just leaves its seat and just reaches full travel.'
		]
	},
	{
		id: 'control-valve-air-failure',
		name: 'Control valve: air failure and fail action',
		valveId: 'controlValve',
		processKind: 'flowLoop',
		fluid: water,
		temperatureK: WATER_20C,
		nominalSizeInch: 2,
		ratedKv: 63,
		characteristic: 'equalPercentage',
		withPositioner: true,
		manualOutputPercent: 70,
		supplyPressureBar: 1.4,
		purpose:
			'This valve is air to open, so it fails closed. Set the I/P calibration to drift and watch the valve stop reaching full travel, which is the same symptom a sagging air supply produces.',
		steps: [
			'Note the valve position at 100 percent command. It should reach full travel.',
			'Apply a negative gain error in the I/P settings and watch the valve fall short of full travel.',
			'A positioner hides this until its own supply runs out, which is why a valve can appear correct in the workshop and fail on site.',
			'Consider the fail direction: this valve closes on air failure, so the process would lose its flow.'
		]
	},
	{
		id: 'control-loop-level',
		name: 'Level loop: an integrating process',
		valveId: 'controlValve',
		processKind: 'levelLoop',
		fluid: water,
		temperatureK: WATER_20C,
		nominalSizeInch: 2,
		ratedKv: 63,
		characteristic: 'equalPercentage',
		withPositioner: true,
		// Tuned by identification against this process, not copied from the flow loop.
		// The process gain at the setpoint is 0.057 m per percent of valve command and
		// the tank time constant is about 40 s, so the loop needs a much higher gain
		// than a flow loop and settles in about three minutes.
		pidGain: 15,
		pidIntegralSeconds: 25,
		pidDerivativeSeconds: 0,
		setpoint: 0.75,
		purpose:
			'A control valve fills a tank that drains by gravity. The drain resists the inflow, so the tank finds a resting level rather than running away, but the process is far slower than a flow loop and its gain falls as the level rises.',
		steps: [
			'Watch the valve open and the level climb. The tank starts well below its setpoint because filling it is the demonstration.',
			'The drain flow rises with the square root of the level, so the process gain falls as the tank fills. The loop slows down as it approaches the setpoint.',
			'Change the setpoint and note how much longer this takes than the flow loop. A volume has to be moved, not just a flow established.',
			'Compare the tune with the flow loop scenario. A level loop needs a much higher gain and a much shorter integral time, because its process gain is small and its time constant is large.'
		]
	},
	{
		id: 'ball-isolation',
		name: 'Ball valve: geometry against throttling',
		valveId: 'ball',
		processKind: 'flowLoop',
		fluid: water,
		temperatureK: WATER_20C,
		nominalSizeInch: 2,
		manualOutputPercent: 50,
		purpose:
			'A standard ball valve has the lowest pressure drop of any common valve, and a capacity curve that makes it useless for control. The geometry is the reason, and it is visible in the 3D model.',
		steps: [
			'Set the opening to 25 percent. The valve passes only a few percent of its capacity.',
			'Set it to 75 percent. Most of the capacity has appeared in that last quarter turn.',
			'The 3D model shows why: the bore opening in the ball is a circle sliding past a circular seat.',
			'Compare the curve with the characterised ball valve, which has a V notch instead of a round bore.'
		]
	},
	{
		id: 'ball-characterised',
		name: 'Characterised ball valve: throttling that works',
		valveId: 'ballCharacterised',
		processKind: 'flowLoop',
		fluid: water,
		temperatureK: WATER_20C,
		nominalSizeInch: 2,
		ratedKv: 90,
		withPositioner: true,
		pidGain: 2,
		pidIntegralSeconds: 10,
		pidDerivativeSeconds: 0,
		setpoint: 35,
		purpose:
			'The V notch turns a useless throttling characteristic into an equal percentage one, while keeping the quarter turn actuator and the straight through bore.',
		steps: [
			'Watch the loop control the flow. The same body as the previous scenario now works.',
			'The notch keeps a defined opening as it closes, which is what gives resolution at low flow.',
			'Check the recovery factor. It is still low, so the cavitation risk of a ball valve remains.'
		]
	},
	{
		id: 'butterfly-torque',
		name: 'Butterfly valve: dynamic torque',
		valveId: 'butterfly',
		processKind: 'flowLoop',
		fluid: water,
		temperatureK: WATER_20C,
		nominalSizeInch: 6,
		ratedKv: 700,
		withPositioner: true,
		manualOutputPercent: 60,
		// A 6 inch line is a different system from a 2 inch one: the piping it sits
		// in has far more capacity, and the flow instrument has to cover the range
		// the line can actually pass.
		processOverrides: { systemKv: 300, flowRangeM3PerHour: 420 },
		purpose:
			'A butterfly valve is a good throttling valve on large lines, but its actuator is sized on a torque that peaks in the middle of the stroke rather than at either end.',
		steps: [
			'Look at the fluid force readout at 10 percent, at 60 percent, and at 95 percent.',
			'The largest force is in the middle, not at the ends. That is the dynamic torque.',
			'The disc is symmetric about its shaft, so static pressure gives almost no torque. The asymmetry of the flow gives this one.',
			'This is why a butterfly that strokes freely on a bench can fail to move with flow through it.'
		]
	},
	{
		id: 'butterfly-cavitation',
		name: 'Butterfly valve: cavitation risk',
		valveId: 'butterfly',
		processKind: 'flowLoop',
		fluid: water,
		temperatureK: celsiusToKelvin(120),
		nominalSizeInch: 6,
		ratedKv: 700,
		withPositioner: true,
		manualOutputPercent: 45,
		processOverrides: { systemKv: 300, flowRangeM3PerHour: 420, supplyPressureBar: 5 },
		purpose:
			'Hot water and a short, straight through body: high pressure recovery, a low vena contracta pressure, and cavitation. The valve reports it, and the bubbles appear at the vena contracta in the 3D view.',
		steps: [
			'Look at the cavitation readout and the bubbles downstream of the disc.',
			'Open the valve further and watch the cavitation state change as the pressure drop falls.',
			'A globe valve would handle this duty because its recovery is lower. Compare the pressure recovery factors in the catalogue.',
			'The fix in practice is a lower recovery valve, a hardened trim, or splitting the drop across two valves.'
		]
	},
	{
		id: 'plug-dirty-service',
		name: 'Plug valve: quick opening for dirty service',
		valveId: 'plug',
		processKind: 'flowLoop',
		fluid: water,
		temperatureK: WATER_20C,
		nominalSizeInch: 2,
		manualOutputPercent: 50,
		purpose:
			'The plug valve throttles poorly, and it is still the right choice for slurry and fibrous service because its seat wipes itself clean on every stroke.',
		steps: [
			'Note the capacity curve: most of the capacity arrives in the first part of the turn.',
			'The seat is held closed by the process pressure and wipes clean on each stroke.',
			'For control duty, the characterised ball valve is the better quarter turn choice. For dirty duty, this one survives.'
		]
	},
	{
		id: 'check-valve-swing',
		name: 'Check valve: pump discharge and closing surge',
		valveId: 'check-swing',
		processKind: 'checkValveRig',
		fluid: water,
		temperatureK: WATER_20C,
		nominalSizeInch: 2,
		purpose:
			'A pump discharges through the check valve into a pressurised header. Stop the pump and the header pushes back, and the valve has to close before too much reverse flow gets through.',
		steps: [
			'Start the pump in the process panel. The valve opens and the flow is forward.',
			'Stop the pump and watch the flow reverse briefly before the valve shuts.',
			'A swing check has a heavy disc on a long hinge, so that reverse slug is large.',
			'That slug is what produces water hammer when it finally stops.'
		]
	},
	{
		id: 'check-valve-dual-plate',
		name: 'Check valve: a faster closure',
		valveId: 'check-dualPlate',
		processKind: 'checkValveRig',
		fluid: water,
		temperatureK: WATER_20C,
		nominalSizeInch: 2,
		purpose:
			'The same rig with a dual plate check valve. The closure is lighter and its travel is shorter, so it shuts before much reverse flow can build up.',
		steps: [
			'Start and stop the pump as before and compare the reverse flow with the swing check.',
			'The lighter closure and shorter travel are the whole design difference.',
			'The trade is a slightly higher cracking pressure and less tolerance of fouling.'
		]
	},
	{
		id: 'relief-valve',
		name: 'Relief valve: capacity against set pressure',
		valveId: 'relief',
		processKind: 'reliefVessel',
		fluid: water,
		temperatureK: WATER_20C,
		nominalSizeInch: 2,
		purpose:
			'A vessel whose outlet becomes blocked while liquid keeps entering. Whether the relief valve protects it depends on one comparison: is its capacity larger than the upset inflow?',
		steps: [
			'Note the set pressure, the reseat pressure and the full lift pressure in the valve panel.',
			'Trigger the upset condition and watch the vessel pressure rise to the set point.',
			'The pressure stops rising only if the relief capacity exceeds the inflow. That is a mass balance, not a setting.',
			'Watch the blowdown: the valve does not reseat the instant the pressure dips, and that is deliberate.'
		]
	},
	{
		id: 'relief-valve-choked',
		name: 'Relief valve: gas relief is choked',
		valveId: 'relief',
		processKind: 'reliefVessel',
		fluid: saturatedSteam,
		temperatureK: STEAM_160C,
		nominalSizeInch: 2,
		// The inlet has to be set against what this orifice actually passes on steam.
		// The same 830 mm2 orifice that relieves 45000 kg/h of water passes only
		// around 5200 kg/h of steam at the same pressure, because steam is a gas and
		// its density is two orders of magnitude lower. That difference is the point
		// of the scenario, so the inflow is set to a value the valve can hold.
		processOverrides: { upsetInflowKgPerHour: 4000, normalInflowKgPerHour: 800 },
		purpose:
			'On a steam service the relief valve discharges to atmosphere, so the flow is choked. The discharge pressure then has no effect on capacity at all, and the same orifice passes far less mass flow than it would on water.',
		steps: [
			'Note the choked indicator in the capacity readout.',
			'Because the flow is choked, a larger discharge pipe would not increase the capacity by a single kilogram per hour.',
			'Compare the relieving capacity with the water scenario. The same orifice passes roughly a tenth as much steam, because steam is a gas.',
			'Set pressure decides when it opens. Only capacity decides whether that helps, and capacity on a gas duty is fixed by the orifice.'
		]
	}
];

export function findScenario(id: string): Scenario | undefined {
	return SCENARIOS.find((scenario) => scenario.id === id);
}
