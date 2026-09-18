/**
 * Process models the control valve works against.
 *
 * A valve on a bench has a fixed pressure drop and behaves exactly like its
 * datasheet. A valve in a plant does not, because the pressure drop it sees is
 * whatever the rest of the system leaves it. These models exist to put the valve
 * back in a system so the difference is visible.
 *
 * Two arrangements are provided, and between them they cover nearly everything a
 * first course in instrumentation needs:
 *
 *  - Flow loop: a header, a control valve, then a fixed resistance in series.
 *    The pressure between the two moves as the valve opens, so the installed
 *    characteristic differs from the inherent one.
 *  - Level loop: a valve filling a tank that drains by gravity. The process
 *    integrates, which is why level loops need a different tuning from flow loops.
 */

import type { Fluid } from './fluids';
import { SECONDS_PER_HOUR } from './units';

export interface HydraulicBoundary {
	/** Absolute pressure at the valve inlet, bar. */
	upstreamPressureBar: number;
	/** Absolute pressure at the valve outlet, bar. */
	downstreamPressureBar: number;
	/** Pressure drop taken by the fixed part of the system, bar. */
	systemPressureDropBar: number;
	/** Short notes explaining the current hydraulic situation. */
	notes: string[];
}

export interface ProcessModel<TState> {
	readonly id: string;
	readonly name: string;
	/** One paragraph explaining what the arrangement teaches. */
	readonly description: string;
	/** Unit of the controlled variable. */
	readonly controlledUnit: string;
	/** Range of the controlled variable, used to scale the transmitter. */
	readonly controlledRange: { min: number; max: number };
	/**
	 * Discrete operator controls this process exposes.
	 *
	 * A process that has no operator input leaves this undefined. A process with a
	 * pump start button or an upset trigger declares it here, so the UI can render
	 * the control without knowing which process it is looking at.
	 */
	readonly actions?: readonly ProcessAction<TState>[];
	initialState(): TState;
	/**
	 * Pressures the valve sees right now.
	 *
	 * The valve coefficient is the effective Kv at the current opening, which is
	 * what makes this a hydraulic solution rather than a lookup: the pressures
	 * depend on the flow, and the flow depends on the pressures.
	 */
	boundaryConditions(
		state: TState,
		valveKv: number,
		fluid: Fluid,
		temperatureK: number
	): HydraulicBoundary;
	/** Advance the state given the mass flow that actually passed through the valve. */
	step(state: TState, massFlowKgPerSecond: number, dtSeconds: number): TState;
	/** Controlled variable reading taken from the state. */
	measurement(state: TState): number;
	/** Secondary readings for the instrument panel. */
	readouts(state: TState): { label: string; value: number; unit: string }[];
}

/** A discrete operator control that a process exposes. */
export interface ProcessAction<TState> {
	readonly id: string;
	/** Label on the control when it is off, for example "Start pump". */
	readonly labelOn: string;
	/** Label when it is on, for example "Stop pump". */
	readonly labelOff: string;
	/** True when the action currently reads as on or active. */
	isActive(state: TState): boolean;
	/** Apply the action. */
	apply(state: TState, active: boolean): TState;
}

// ---------------------------------------------------------------------------
// Flow loop
// ---------------------------------------------------------------------------

export interface FlowLoopSpec {
	/** Supply header absolute pressure, bar. */
	supplyPressureBar: number;
	/** Absolute pressure the fixed part of the system discharges to, bar. */
	dischargePressureBar: number;
	/**
	 * Flow coefficient of the fixed part of the system, in Kv.
	 *
	 * A small value means pipe and fittings dominate, so the valve has low
	 * authority and its installed characteristic will not match its inherent one.
	 */
	systemKv: number;
	/** Time constant of the line dynamics, seconds. Zero for an instantaneous response. */
	lineTimeConstantSeconds: number;
	/** Flow transmitter upper range, m3/h. */
	flowRangeM3PerHour: number;
	/** Liquid density, kg/m3. */
	densityKgPerM3: number;
}

export interface FlowLoopState {
	/** Current flow, m3/h. Lags the hydraulic solution by the line time constant. */
	flowM3PerHour: number;
	/** Solved steady state flow, m3/h. */
	steadyFlowM3PerHour: number;
}

/**
 * Default flow loop, sized the way a real one would be.
 *
 * The numbers are chosen so the loop is a good teaching example rather than an
 * arbitrary arrangement. A 2 inch control valve with a Kv of 63 against a fixed
 * system Kv of 45 gives a valve authority near 0.34 at the wide open flow, which
 * is the 0.3 to 0.5 band a control engineer aims for: the valve owns enough of
 * the pressure drop to control the flow, but not so much that the rest of the
 * system becomes irrelevant. The 45 m3/h design flow lands at about 80 percent
 * travel, which leaves the valve room to respond to an increase in demand, and
 * the 70 m3/h transmitter range covers the 68 m3/h the valve can pass wide open so
 * the instrument is never the limit on the loop.
 *
 * The valve is deliberately not sized on its inherent characteristic alone.
 * Because the valve does not own most of the pressure drop, the pressure across it
 * grows as the flow falls, and that interaction is what the installed
 * characteristic lesson is about.
 */
export const DEFAULT_FLOW_LOOP: FlowLoopSpec = {
	supplyPressureBar: 5,
	dischargePressureBar: 1.5,
	systemKv: 45,
	lineTimeConstantSeconds: 0.4,
	flowRangeM3PerHour: 70,
	densityKgPerM3: 998
};

/**
 * Flow loop: the valve and a fixed resistance in series.
 *
 * The hydraulic solution has to be simultaneous. The valve passes flow according
 * to its own coefficient and the pressure left across it, the fixed resistance
 * takes a pressure drop that grows with the square of the flow, and the two
 * share a fixed total. Substituting one into the other gives a monotonic
 * equation in the flow, which is solved by bisection: reliable, and fast enough
 * to run every frame.
 */
export function createFlowLoop(spec: FlowLoopSpec): ProcessModel<FlowLoopState> {
	const totalPressureDropBar = Math.max(0, spec.supplyPressureBar - spec.dischargePressureBar);

	function solveSteadyFlow(valveKv: number, specificGravity: number): number {
		if (valveKv <= 0 || totalPressureDropBar <= 0) return 0;

		// Series flow coefficients combine as reciprocals of squares, so the
		// combined coefficient gives an upper bound on the flow.
		const combinedKv = 1 / Math.sqrt(1 / valveKv ** 2 + 1 / Math.max(spec.systemKv, 1e-9) ** 2);
		const upperBound = combinedKv * Math.sqrt(totalPressureDropBar / Math.max(specificGravity, 1e-9));

		// Pressure drop the fixed resistance takes at a trial flow.
		const systemDrop = (flow: number) =>
			((flow / Math.max(spec.systemKv, 1e-9)) ** 2) * specificGravity;

		const valveFlow = (flow: number) => {
			const valveDrop = totalPressureDropBar - systemDrop(flow);
			if (valveDrop <= 0) return upperBound;
			return valveKv * Math.sqrt(valveDrop / Math.max(specificGravity, 1e-9));
		};

		let low = 0;
		let high = upperBound;
		for (let i = 0; i < 40; i++) {
			const mid = (low + high) / 2;
			if (valveFlow(mid) > mid) {
				low = mid;
			} else {
				high = mid;
			}
		}
		return (low + high) / 2;
	}

	return {
		id: 'flowLoop',
		name: 'Flow control loop',
		description:
			'A control valve modulates flow from a supply header into a fixed system resistance. The pressure between the valve and the resistance moves as the valve opens, so the valve loses pressure drop exactly when it needs it most. This is what makes the installed characteristic differ from the inherent one.',
		controlledUnit: 'm3/h',
		controlledRange: { min: 0, max: spec.flowRangeM3PerHour },

		initialState(): FlowLoopState {
			return { flowM3PerHour: 0, steadyFlowM3PerHour: 0 };
		},

		boundaryConditions(
			_state: FlowLoopState,
			valveKv: number,
			fluid: Fluid,
			temperatureK: number
		): HydraulicBoundary {
			// The hydraulic solve needs the liquid density. Taking it from the fluid
			// rather than from a fixed number keeps the process and the valve sizing
			// consistent, which matters as soon as the temperature is changed.
			const densityKgPerM3 = fluid.density(spec.supplyPressureBar, temperatureK);
			const specificGravity = densityKgPerM3 / 1000;
			const steadyFlow = solveSteadyFlow(valveKv, specificGravity);
			const systemDrop = ((steadyFlow / Math.max(spec.systemKv, 1e-9)) ** 2) * specificGravity;
			const valveDrop = Math.max(0, totalPressureDropBar - systemDrop);

			const notes: string[] = [];
			const authority = totalPressureDropBar > 0 ? valveDrop / totalPressureDropBar : 0;
			if (authority < 0.15 && valveKv > 0) {
				notes.push(
					'Low valve authority: most of the pressure drop is in the fixed system, so the valve has little left to work with.'
				);
			}
			if (systemDrop > 0) {
				notes.push(
					`Fixed system takes ${systemDrop.toFixed(2)} bar, the valve keeps ${valveDrop.toFixed(2)} bar.`
				);
			}

			// The downstream pressure of the valve is the intermediate pressure
			// between the valve and the fixed resistance.
			return {
				upstreamPressureBar: spec.supplyPressureBar,
				downstreamPressureBar: spec.supplyPressureBar - valveDrop,
				systemPressureDropBar: systemDrop,
				notes
			};
		},

		// The state is carried through the hydraulic solve via the caller, so the
		// step only applies the line dynamics to the flow.
		step(state: FlowLoopState, massFlowKgPerSecond: number, dtSeconds: number): FlowLoopState {
			const steadyFlowM3PerHour = (massFlowKgPerSecond * SECONDS_PER_HOUR) / spec.densityKgPerM3;
			const tau = Math.max(0, spec.lineTimeConstantSeconds);
			const alpha = tau > 0 ? 1 - Math.exp(-dtSeconds / tau) : 1;
			const flowM3PerHour =
				state.flowM3PerHour + (steadyFlowM3PerHour - state.flowM3PerHour) * alpha;
			return { flowM3PerHour, steadyFlowM3PerHour };
		},

		measurement(state: FlowLoopState): number {
			return state.flowM3PerHour;
		},

		readouts(state: FlowLoopState) {
			return [
				{ label: 'Flow', value: state.flowM3PerHour, unit: 'm3/h' },
				{ label: 'Steady state flow', value: state.steadyFlowM3PerHour, unit: 'm3/h' }
			];
		}
	};
}

// ---------------------------------------------------------------------------
// Level loop
// ---------------------------------------------------------------------------

export interface LevelLoopSpec {
	/** Supply header absolute pressure, bar. */
	supplyPressureBar: number;
	/** Pressure above the liquid surface in the tank, bar absolute. */
	tankPressureBar: number;
	/** Tank cross sectional area, m2. */
	tankAreaM2: number;
	/** Flow coefficient of the gravity drain line, in Kv. */
	drainKv: number;
	/** Level transmitter range, m. */
	levelRangeM: number;
	/**
	 * Level at the start, as a fraction of the transmitter range.
	 *
	 * The demonstration needs a visible transient, so the tank starts below its
	 * setpoint and the loop has to fill it. Starting at the setpoint would show a
	 * loop that appears to do nothing, which teaches the opposite of the lesson.
	 */
	initialLevelFraction?: number;
	/** Liquid density, kg/m3. */
	densityKgPerM3: number;
}

export interface LevelLoopState {
	/** Liquid level above the outlet, m. */
	levelM: number;
}

/**
 * Default level loop, sized so the lesson fits in a couple of minutes.
 *
 * A gravity drained tank is a slow process, and the numbers have to be chosen
 * against that or the demonstration is unusable. The time constant of a tank with a
 * gravity drain is
 *
 *     tau = A / (dQout/dh)
 *
 * where the drain passes Kv sqrt(0.0980665 h) and therefore has a slope of
 * Kv sqrt(0.0980665) / (2 sqrt(h)). A 1.2 m2 tank draining through a Kv 12
 * restriction gives a time constant of half an hour, which is realistic for a plant
 * and far too slow to watch.
 *
 * The tank used here is a tall narrow vessel of 0.05 m2 draining through a Kv 25
 * restriction, which puts the time constant near 40 seconds at mid level. A well
 * tuned loop settles in about six of those, so the whole demonstration fits in
 * three or four minutes while keeping the character of the process: the drain
 * resists the inflow, so the level finds a resting point rather than running away.
 */
export const DEFAULT_LEVEL_LOOP: LevelLoopSpec = {
	supplyPressureBar: 4,
	tankPressureBar: 1.01325,
	tankAreaM2: 0.05,
	drainKv: 25,
	levelRangeM: 1.5,
	initialLevelFraction: 0.2,
	densityKgPerM3: 998
};

/** Head of liquid in bar for a column of a given height. */
export function headPressureBar(densityKgPerM3: number, heightM: number): number {
	return (densityKgPerM3 * 9.80665 * Math.max(0, heightM)) / 1e5;
}

/**
 * Level loop: a valve filling a tank that drains by gravity.
 *
 * The drain equation simplifies nicely. The driving pressure is the liquid
 * column, and the sizing equation divides that by the specific gravity, so the
 * density cancels and the drain flow depends only on the head in metres:
 *
 *     Q_drain = Kv * sqrt(0.0980665 * h)
 *
 * That is why a gravity drain is the same for any liquid, and why the level loop
 * has an integrating process: inflow and outflow balance at exactly one level,
 * and away from that level the tank fills or empties without limit.
 */
export function createLevelLoop(spec: LevelLoopSpec): ProcessModel<LevelLoopState> {
	return {
		id: 'levelLoop',
		name: 'Level control loop',
		description:
			'A control valve fills a tank that drains through a gravity line. The drain resists the inflow, so the tank finds a resting level rather than running away, but the process is far slower than a flow loop and its gain falls as the level rises. Those two properties are why a level controller cannot be tuned like a flow controller.',
		controlledUnit: 'm',
		controlledRange: { min: 0, max: spec.levelRangeM },

		initialState(): LevelLoopState {
			return { levelM: spec.levelRangeM * (spec.initialLevelFraction ?? 0.5) };
		},

		boundaryConditions(
			state: LevelLoopState,
			_valveKv: number,
			_density: Fluid,
			_temperatureK: number
		): HydraulicBoundary {
			const head = headPressureBar(spec.densityKgPerM3, state.levelM);
			const notes: string[] = [];
			const valveDrop = Math.max(0, spec.supplyPressureBar - spec.tankPressureBar - head);
			if (head > 0) {
				notes.push(
					`Liquid head adds ${head.toFixed(3)} bar at the valve outlet, taking it away from the valve.`
				);
			}
			return {
				// The valve discharges into the tank, so its outlet pressure is the
				// tank pressure plus the liquid column it is fighting.
				upstreamPressureBar: spec.supplyPressureBar,
				downstreamPressureBar: spec.tankPressureBar + head,
				systemPressureDropBar: valveDrop,
				notes
			};
		},

		step(state: LevelLoopState, massFlowKgPerSecond: number, dtSeconds: number): LevelLoopState {
			const density = spec.densityKgPerM3;

			// Drain flow depends only on the head in metres because the density
			// cancels between the driving pressure and the specific gravity.
			const drainFlowM3PerSecond =
				(spec.drainKv * Math.sqrt(0.0980665 * Math.max(0, state.levelM))) / SECONDS_PER_HOUR;
			const drainMassFlow = drainFlowM3PerSecond * density;

			const netMassFlowKgPerSecond = massFlowKgPerSecond - drainMassFlow;
			const levelM = state.levelM + (netMassFlowKgPerSecond / (density * spec.tankAreaM2)) * dtSeconds;

			return { levelM: Math.max(0, levelM) };
		},

		measurement(state: LevelLoopState): number {
			return state.levelM;
		},

		readouts(state: LevelLoopState) {
			const drainFlowM3PerHour =
				spec.drainKv * Math.sqrt(0.0980665 * Math.max(0, state.levelM));
			return [
				{ label: 'Level', value: state.levelM, unit: 'm' },
				{ label: 'Level', value: (state.levelM / spec.levelRangeM) * 100, unit: 'percent' },
				{ label: 'Gravity drain', value: drainFlowM3PerHour, unit: 'm3/h' }
			];
		}
	};
}

export const DEFAULT_FLOW_LOOP_SPEC = DEFAULT_FLOW_LOOP;
export const DEFAULT_LEVEL_LOOP_SPEC = DEFAULT_LEVEL_LOOP;

// ---------------------------------------------------------------------------
// Check valve test rig
// ---------------------------------------------------------------------------

export interface CheckValveRigSpec {
	/** Pump suction pressure, bar absolute. Taken from a tank at atmospheric pressure. */
	suctionPressureBar: number;
	/** Pump shutoff head, bar. The pressure the pump develops at zero flow. */
	pumpShutoffHeadBar: number;
	/** Pump flow at zero head, m3/h. The other end of the pump curve. */
	pumpMaxFlowM3PerHour: number;
	/** Pressure in the discharge header the pump feeds, bar absolute. Large enough to be a boundary. */
	headerPressureBar: number;
	/**
	 * Hydraulic capacitance of the discharge line between pump and check valve,
	 * m3 per bar. A short spool piece is stiff, a long line is compliant, and the
	 * value sets how fast the discharge pressure moves.
	 */
	dischargeCapacitanceM3PerBar: number;
	/** Flow transmitter range on the pump discharge, m3/h. */
	flowRangeM3PerHour: number;
}

export interface CheckValveRigState {
	/** Pressure in the discharge spool between the pump and the check valve, bar absolute. */
	dischargePressureBar: number;
	/** Flow through the check valve, m3/h. Positive means forward into the header. */
	flowM3PerHour: number;
	/** Pump flow, m3/h. Zero when the pump is stopped. */
	pumpFlowM3PerHour: number;
	/** True while the pump is running. */
	pumpRunning: boolean;
	/** True once the check valve has been open, used for its reseat hysteresis. */
	wasOpen: boolean;
}

export const DEFAULT_CHECK_VALVE_RIG: CheckValveRigSpec = {
	suctionPressureBar: 1.01325,
	pumpShutoffHeadBar: 6,
	pumpMaxFlowM3PerHour: 40,
	headerPressureBar: 4,
	dischargeCapacitanceM3PerBar: 0.004,
	flowRangeM3PerHour: 45
};

/**
 * Check valve test rig.
 *
 * This is the arrangement that shows what a check valve is actually for. A pump
 * discharges through the valve into a header that is already pressurised. While
 * the pump runs, the discharge pressure is above the header and the valve stands
 * open. Stop the pump and the header pressure is suddenly pushing back the other
 * way, so the discharge spool pressure collapses and the valve has to close
 * before the reverse flow becomes significant.
 *
 * The discharge spool between pump and valve is modelled as a lumped volume, so
 * its pressure is a state that integrates the difference between what the pump
 * delivers and what the valve passes. This is the standard way to break the
 * algebraic loop between a pump curve and a valve equation, and it has the
 * pleasant side effect of reproducing the pressure surge that travels back to
 * the pump when the valve finally shuts.
 */
export function createCheckValveRig(
	spec: CheckValveRigSpec = DEFAULT_CHECK_VALVE_RIG,
	densityKgPerM3 = 998
): ProcessModel<CheckValveRigState> {
	/** Pump curve: flow falls as the discharge pressure rises toward shutoff head. */
	function pumpFlowForPressure(dischargePressureBar: number, running: boolean): number {
		if (!running) return 0;
		const head = dischargePressureBar - spec.suctionPressureBar;
		if (head >= spec.pumpShutoffHeadBar) return 0;
		const ratio = 1 - head / spec.pumpShutoffHeadBar;
		return spec.pumpMaxFlowM3PerHour * Math.sqrt(Math.max(0, ratio));
	}

	return {
		id: 'checkValveRig',
		name: 'Check valve test rig',
		description:
			'A pump discharges through the check valve into a pressurised header. Stop the pump and the header pushes back, so the valve must close before reverse flow can build up. How fast it closes decides whether the piping sees a gentle stop or a water hammer.',
		controlledUnit: 'm3/h',
		controlledRange: { min: -spec.flowRangeM3PerHour / 2, max: spec.flowRangeM3PerHour },

		actions: [
			{
				id: 'pump',
				labelOn: 'Start pump',
				labelOff: 'Stop pump',
				isActive: (state) => state.pumpRunning,
				apply: (state, active) => ({
					...state,
					pumpRunning: active,
					pumpFlowM3PerHour: pumpFlowForPressure(state.dischargePressureBar, active)
				})
			}
		],

		initialState(): CheckValveRigState {
			return {
				dischargePressureBar: spec.headerPressureBar,
				flowM3PerHour: 0,
				pumpFlowM3PerHour: 0,
				pumpRunning: false,
				wasOpen: false
			};
		},

		boundaryConditions(
			state: CheckValveRigState,
			_valveKv: number,
			_fluid: Fluid,
			_temperatureK: number
		): HydraulicBoundary {
			const notes: string[] = [];
			if (state.pumpRunning) {
				notes.push(
					`Pump running, discharge ${state.dischargePressureBar.toFixed(2)} bar against a header at ${spec.headerPressureBar.toFixed(2)} bar.`
				);
			} else {
				notes.push(
					`Pump stopped. Header pressure is pushing back into the discharge spool, now at ${state.dischargePressureBar.toFixed(2)} bar.`
				);
			}

			return {
				// The check valve inlet is the pump discharge spool. The sizing module
				// decides the sign of the flow from the two pressures it is given, so
				// the rig reports them in flow order when the flow is forward and in
				// reverse order when the header is winning.
				upstreamPressureBar: Math.max(state.dischargePressureBar, spec.headerPressureBar),
				downstreamPressureBar: Math.min(state.dischargePressureBar, spec.headerPressureBar),
				systemPressureDropBar: Math.abs(state.dischargePressureBar - spec.headerPressureBar),
				notes
			};
		},

		step(state: CheckValveRigState, massFlowKgPerSecond: number, dtSeconds: number): CheckValveRigState {
			const pumpFlowM3PerHour = pumpFlowForPressure(state.dischargePressureBar, state.pumpRunning);
			const checkFlowM3PerHour = (massFlowKgPerSecond * SECONDS_PER_HOUR) / densityKgPerM3;

			// Hydraulic capacitance: the spool pressure rises when the pump puts in
			// more than the valve takes out, and collapses when the reverse happens.
			const netFlowM3PerHour = pumpFlowM3PerHour - checkFlowM3PerHour;
			const pressureChangeBar =
				((netFlowM3PerHour / SECONDS_PER_HOUR) * dtSeconds) /
				Math.max(spec.dischargeCapacitanceM3PerBar, 1e-9);

			const dischargePressureBar = Math.max(
				0.1,
				state.dischargePressureBar + pressureChangeBar
			);

			return {
				dischargePressureBar,
				flowM3PerHour: checkFlowM3PerHour,
				pumpFlowM3PerHour,
				pumpRunning: state.pumpRunning,
				wasOpen: state.wasOpen || checkFlowM3PerHour > 0.01
			};
		},

		measurement(state: CheckValveRigState): number {
			return state.flowM3PerHour;
		},

		readouts(state: CheckValveRigState) {
			return [
				{ label: 'Check valve flow', value: state.flowM3PerHour, unit: 'm3/h' },
				{ label: 'Discharge pressure', value: state.dischargePressureBar, unit: 'bar' },
				{ label: 'Pump flow', value: state.pumpFlowM3PerHour, unit: 'm3/h' }
			];
		}
	};
}

// ---------------------------------------------------------------------------
// Relief valve vessel
// ---------------------------------------------------------------------------

export interface ReliefVesselSpec {
	/** Total vessel volume, m3. */
	vesselVolumeM3: number;
	/**
	 * Fraction of the vessel occupied by liquid at the start, for a liquid service.
	 *
	 * The remaining fraction is the vapour space, and it is what makes the pressure
	 * respond the way it does: liquid entering the vessel compresses the gas above
	 * it, and a gas compresses readily where a liquid does not. Ignored on a gas
	 * service, where the whole vessel is gas.
	 */
	initialLiquidFraction: number;
	/** Vessel pressure at the initial condition, bar absolute. */
	initialPressureBar: number;
	/**
	 * Polytropic exponent for the vapour space on a liquid service.
	 *
	 * 1 is isothermal, which suits a vessel whose liquid and walls hold the gas at a
	 * steady temperature. 1.4 is isentropic, which suits a rapid event. The default
	 * sits between the two because a relief event is fast enough not to be
	 * isothermal and slow enough not to be isentropic.
	 */
	gasPolytropicExponent: number;
	/** Normal process inflow, kg/h. */
	normalInflowKgPerHour: number;
	/**
	 * Inflow during the upset, kg/h.
	 *
	 * A mass flow rather than a volume flow, because that is how a relief scenario
	 * is actually specified: the question a sizing engineer answers is how many
	 * kilograms per hour the valve has to pass, and the answer does not change with
	 * which phase those kilograms happen to be in.
	 */
	upsetInflowKgPerHour: number;
	/** Vessel design pressure, bar gauge. Shown against the relief set pressure. */
	designPressureBarGauge: number;
	/** Liquid density for a liquid service, kg/m3. Ignored on a gas service. */
	densityKgPerM3: number;
}

export interface ReliefVesselState {
	/** Vessel pressure, bar absolute. */
	pressureBar: number;
	/** Volume of liquid in the vessel, m3. Zero on a gas service. */
	liquidVolumeM3: number;
	/** Mass of gas in the vessel, kg. Zero on a liquid service. */
	gasMassKg: number;
	/** Inflow currently entering the vessel, kg/h. */
	inflowKgPerHour: number;
	/** True once the relief valve has lifted, used for its reseat hysteresis. */
	reliefOpen: boolean;
	/** True while the upset condition is active. */
	upset: boolean;
}

/**
 * Default relief vessel, sized so the lesson works.
 *
 * The vessel is 2.5 m3 with a quarter of it left as vapour space, and the upset
 * inflow of 45000 kg/h is just under the capacity of an 830 mm2 API J orifice at
 * the full lift pressure. The valve therefore copes and the pressure settles below
 * the design pressure, which is the case worth demonstrating: a correctly sized
 * relief valve holds the pressure, and the vessel only fails when the capacity is
 * genuinely exceeded.
 */
export const DEFAULT_RELIEF_VESSEL: ReliefVesselSpec = {
	vesselVolumeM3: 2.5,
	initialLiquidFraction: 0.75,
	initialPressureBar: 4,
	gasPolytropicExponent: 1.2,
	normalInflowKgPerHour: 8000,
	upsetInflowKgPerHour: 45000,
	designPressureBarGauge: 12,
	densityKgPerM3: 998
};

/** Universal gas constant, J/(mol K). */
const R_UNIVERSAL = 8.314462618;

/**
 * Relief valve vessel.
 *
 * A vessel receives fluid from a source. Under normal operation the outlet keeps up
 * with the inflow and the pressure sits below the relief valve set point. Then an
 * outlet is blocked, or an inlet valve sticks open, and the pressure climbs.
 *
 * Two things decide what happens next, and both are modelled here.
 *
 * The first is the mass balance, which is the whole lesson. Whether the relief
 * valve protects the vessel depends on one comparison: is its relieving capacity
 * greater than the inflow that is pressurising it? If it is, the pressure rises
 * until the valve passes that inflow and then stops. If it is not, the pressure
 * keeps rising whatever the set pressure is, and the vessel fails. That is why
 * relief valves are sized on a scenario rather than selected from a catalogue.
 *
 * The second is the capacitance, which decides how fast the pressure moves while
 * that balance is being found. It depends on the phase, so the vessel models both:
 *
 *   On a liquid service the liquid inventory compresses the vapour space above it.
 *   A gas is compressible and a liquid is not, so the vapour space is the
 *   capacitance of the whole system, and the vessel can absorb a large inflow for a
 *   modest pressure rise.
 *
 *   On a gas service the whole vessel is gas, so the mass of gas in a fixed volume
 *   sets the pressure through the ideal gas law. The capacitance is the vessel
 *   volume itself, which is why a gas filled vessel pressure moves far faster for
 *   the same mass inflow than a liquid filled one does.
 *
 * The phase is taken from the fluid the engine reports, so a steam drum and a water
 * vessel are described by the same model with no separate configuration.
 */
export function createReliefVessel(
	spec: ReliefVesselSpec = DEFAULT_RELIEF_VESSEL
): ProcessModel<ReliefVesselState> {
	/**
	 * The most recent fluid state the engine reported.
	 *
	 * The engine calls `boundaryConditions` immediately before it computes the flow
	 * and takes the step, so these values describe the same instant the step is
	 * integrated over. Keeping them here avoids duplicating the fluid configuration
	 * in the process spec, which is what makes one vessel model serve both a water
	 * service and a steam service.
	 */
	let serviceIsGas = false;
	let serviceMolarMassKgPerMol = 0.018;
	let serviceTemperatureK = 293.15;
	let serviceGasConstantJPerKgK = R_UNIVERSAL / serviceMolarMassKgPerMol;

	/** Initial mass of gas, used only on a gas service. */
	function initialGasMassKg(): number {
		return (
			(spec.initialPressureBar * 1e5 * spec.vesselVolumeM3) /
			(serviceGasConstantJPerKgK * serviceTemperatureK)
		);
	}

	/**
	 * Vapour space volume at the current liquid inventory, m3.
	 *
	 * A small floor is kept because the vessel can in principle be filled
	 * completely, and the polytropic relation would otherwise divide by zero. A real
	 * vessel in that condition has nowhere left for the pressure to go, which the
	 * floor approximates by making the pressure rise extremely steeply.
	 */
	function vapourVolumeM3(liquidVolumeM3: number): number {
		return Math.max(spec.vesselVolumeM3 * 0.002, spec.vesselVolumeM3 - liquidVolumeM3);
	}

	/** Vessel pressure for a vapour space volume, by the polytropic relation. */
	function pressureForVapourVolume(vapourVolumeM3: number): number {
		const initialVapourVolume = spec.vesselVolumeM3 * (1 - spec.initialLiquidFraction);
		return (
			spec.initialPressureBar *
			(initialVapourVolume / Math.max(vapourVolumeM3, 1e-9)) ** spec.gasPolytropicExponent
		);
	}

	/** Vessel pressure for a mass of gas in the fixed vessel volume, ideal gas law. */
	function pressureForGasMass(gasMassKg: number): number {
		return (
			(gasMassKg * serviceGasConstantJPerKgK * serviceTemperatureK) /
			(spec.vesselVolumeM3 * 1e5)
		);
	}

	return {
		id: 'reliefVessel',
		name: 'Relief valve vessel',
		description:
			'A vessel whose outlet becomes blocked while fluid continues to enter. The pressure rises until the relief valve lifts. Whether it then stops rising depends entirely on whether the relief capacity exceeds the upset inflow, which is a mass balance and not a matter of set pressure.',
		controlledUnit: 'bar',
		controlledRange: { min: 0, max: spec.designPressureBarGauge * 2 + 1.01325 },

		actions: [
			{
				id: 'upset',
				labelOn: 'Trigger blocked outlet',
				labelOff: 'Clear blocked outlet',
				isActive: (state) => state.upset,
				apply: (state, active) => ({
					...state,
					upset: active,
					inflowKgPerHour: active ? spec.upsetInflowKgPerHour : spec.normalInflowKgPerHour
				})
			}
		],

		initialState(): ReliefVesselState {
			return {
				pressureBar: spec.initialPressureBar,
				liquidVolumeM3: spec.vesselVolumeM3 * spec.initialLiquidFraction,
				gasMassKg: 0,
				inflowKgPerHour: spec.normalInflowKgPerHour,
				reliefOpen: false,
				upset: false
			};
		},

		boundaryConditions(
			state: ReliefVesselState,
			_valveKv: number,
			fluid: Fluid,
			temperatureK: number
		): HydraulicBoundary {
			// The fluid state recorded here is what the next step integrates over.
			serviceIsGas = fluid.phase !== 'liquid';
			serviceMolarMassKgPerMol = fluid.molarMassKgPerMol ?? 0.0289645;
			serviceTemperatureK = temperatureK;
			serviceGasConstantJPerKgK = R_UNIVERSAL / serviceMolarMassKgPerMol;

			const gaugeBar = state.pressureBar - 1.01325;
			const notes: string[] = [
				`Vessel at ${gaugeBar.toFixed(2)} bar gauge, design pressure ${spec.designPressureBarGauge.toFixed(1)} bar gauge.`
			];

			if (gaugeBar > spec.designPressureBarGauge) {
				notes.push('Vessel is above its design pressure.');
			}
			if (state.upset) {
				notes.push(
					`Upset condition active: inflow ${state.inflowKgPerHour.toFixed(0)} kg/h. The relief valve must pass this to hold the pressure.`
				);
			}

			if (!serviceIsGas) {
				const vapourFraction = vapourVolumeM3(state.liquidVolumeM3) / spec.vesselVolumeM3;
				if (vapourFraction < 0.1) {
					notes.push(
						`Vapour space down to ${(vapourFraction * 100).toFixed(1)} percent, so the pressure rises quickly now.`
					);
				}
			}

			return {
				// The relief valve discharges to atmosphere, so its outlet is the
				// atmospheric pressure and its inlet is the vessel pressure.
				upstreamPressureBar: state.pressureBar,
				downstreamPressureBar: 1.01325,
				systemPressureDropBar: Math.max(0, state.pressureBar - 1.01325),
				notes
			};
		},

		step(state: ReliefVesselState, massFlowKgPerSecond: number, dtSeconds: number): ReliefVesselState {
			const inflowKgPerSecond = state.inflowKgPerHour / SECONDS_PER_HOUR;
			const netMassKgPerSecond = inflowKgPerSecond - massFlowKgPerSecond;
			const netMassKg = netMassKgPerSecond * dtSeconds;

			if (serviceIsGas) {
				// A gas filled vessel: the mass of gas in a fixed volume sets the
				// pressure. The first step after the phase becomes known seeds the gas
				// mass from the current pressure, so switching service does not produce
				// a jump.
				const gasMassKg = Math.max(
					0,
					(state.gasMassKg > 0 ? state.gasMassKg : initialGasMassKg()) + netMassKg
				);

				return {
					...state,
					gasMassKg,
					liquidVolumeM3: 0,
					pressureBar: Math.max(0.01, pressureForGasMass(gasMassKg)),
					reliefOpen: state.reliefOpen || massFlowKgPerSecond > 1e-6
				};
			}

			// A liquid filled vessel: whatever enters and does not leave raises the
			// liquid inventory and squeezes the vapour space above it.
			const liquidVolumeM3 = Math.min(
				spec.vesselVolumeM3,
				Math.max(0, state.liquidVolumeM3 + (netMassKg / spec.densityKgPerM3))
			);

			return {
				...state,
				liquidVolumeM3,
				gasMassKg: 0,
				pressureBar: pressureForVapourVolume(vapourVolumeM3(liquidVolumeM3)),
				reliefOpen: state.reliefOpen || massFlowKgPerSecond > 1e-6
			};
		},

		measurement(state: ReliefVesselState): number {
			return state.pressureBar;
		},

		readouts(state: ReliefVesselState) {
			const readings = [
				{ label: 'Vessel pressure', value: state.pressureBar - 1.01325, unit: 'bar gauge' },
				{ label: 'Inflow', value: state.inflowKgPerHour, unit: 'kg/h' }
			];

			if (serviceIsGas) {
				readings.push({ label: 'Gas inventory', value: state.gasMassKg, unit: 'kg' });
			} else {
				readings.push({
					label: 'Liquid inventory',
					value: (state.liquidVolumeM3 / Math.max(spec.vesselVolumeM3, 1e-9)) * 100,
					unit: 'percent'
				});
			}

			return readings;
		}
	};
}
