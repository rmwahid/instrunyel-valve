/**
 * The fixed step simulation engine.
 *
 * One step of this file is one step of the real plant, in the same order a real
 * plant works in:
 *
 *   1. The transmitter reads the process and reports a current.
 *   2. The controller scans that current and decides an output.
 *   3. The I/P converter turns the output current into air pressure.
 *   4. The actuator converts that pressure into a force.
 *   5. The force balance, including friction and the fluid reaction, moves the
 *      stem.
 *   6. The new stem position changes the flow coefficient.
 *   7. The process integrates the resulting flow.
 *
 * Doing this in the wrong order, or reading a value that has not been updated
 * yet, is how a simulation produces behaviour that could never happen on a real
 * plant. The order is therefore explicit rather than left to the order of
 * statements in a loop.
 *
 * The engine holds no reference to Three.js, Rapier or the DOM. It runs headless
 * in a test, which is what makes the physics testable at all.
 *
 * The process model is generic in its own state type, and the engine must not
 * care what that type is. A process port solves the mismatch: it captures the
 * process state in a closure and exposes only the operations the engine needs.
 * That keeps the engine free of type casts and keeps each process model free of
 * engine bookkeeping.
 */

import {
	DEFAULT_DAMPING_N_PER_MPS,
	airForceN,
	applyCaseVolumeChange,
	caseGaugePressureBar,
	createActuatorCaseState,
	createPositionerState,
	fillActuatorCase,
	positionFromPressure,
	selfActingOpening,
	springForceN,
	springRateNPerM,
	stepPositioner,
	type ActuatorCaseState,
	type ActuatorSpec,
	type PositionerState
} from './actuator';
import {
	deadbandPercent,
	integrateStemMotion,
	type FrictionSpec,
	type StemMotionState
} from './friction';
import type { Fluid } from './fluids';
import { createPidState, stepPid, type PidSpec, type PidState } from './pid';
import type { HydraulicBoundary, ProcessModel } from './process';
import { computeFlow, type FlowResult } from './sizing';
import {
	NO_FAULT,
	applyLoopFault,
	createIpConverterState,
	createRandom,
	createTransmitterState,
	evaluateNamur,
	stepIpConverter,
	stepTransmitter,
	type CurrentLoopFault,
	type IpConverterSpec,
	type IpConverterState,
	type SignalStatus,
	type TransmitterSpec,
	type TransmitterState
} from './signal';
import { currentMaToFraction } from './units';
import type { ValveModel } from './valves/types';

/**
 * A process model with its state hidden inside it.
 *
 * The engine drives the process through this interface, so it never has to name
 * the process state type. Each process model provides its own port.
 */
export interface ProcessPort {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly controlledUnit: string;
	readonly controlledRange: { min: number; max: number };
	/**
	 * Discrete operator controls the process exposes.
	 *
	 * Empty for a process with no operator input. The view renders whatever is
	 * listed here, so adding a control to a process never requires a change in the
	 * UI.
	 */
	readonly actions: readonly ProcessActionPort[];
	/** Pressures the valve sees at the current process state. */
	boundaryConditions(valveKv: number, fluid: Fluid, temperatureK: number): HydraulicBoundary;
	/** Integrate the process forward with the mass flow that passed the valve. */
	advance(massFlowKgPerSecond: number, dtSeconds: number): void;
	/** Current value of the controlled variable, without instrument effects. */
	measurement(): number;
	/** Secondary readings for the instrument panel. */
	readouts(): { label: string; value: number; unit: string }[];
	/** Restore the initial process condition. */
	reset(): void;
}

/** An operator control a process exposes through its port. */
export interface ProcessActionPort {
	readonly id: string;
	readonly labelOn: string;
	readonly labelOff: string;
	/** True when the action reads as on or active at the current state. */
	isActive(): boolean;
	/** Apply the action. */
	apply(active: boolean): void;
}

/** Wrap a process model and its private state in a port the engine can drive. */
export function createProcessPort<TState>(model: ProcessModel<TState>): ProcessPort {
	let state = model.initialState();

	const actions: ProcessActionPort[] = (model.actions ?? []).map((action) => ({
		id: action.id,
		labelOn: action.labelOn,
		labelOff: action.labelOff,
		isActive: () => action.isActive(state),
		apply: (active: boolean) => {
			state = action.apply(state, active);
		}
	}));

	return {
		id: model.id,
		name: model.name,
		description: model.description,
		controlledUnit: model.controlledUnit,
		controlledRange: model.controlledRange,
		actions,
		boundaryConditions(valveKv, fluid, temperatureK) {
			return model.boundaryConditions(state, valveKv, fluid, temperatureK);
		},
		advance(massFlowKgPerSecond, dtSeconds) {
			state = model.step(state, massFlowKgPerSecond, dtSeconds);
		},
		measurement() {
			return model.measurement(state);
		},
		readouts() {
			return model.readouts(state);
		},
		reset() {
			state = model.initialState();
		}
	};
}

export interface SimulatorConfig {
	valve: ValveModel;
	process: ProcessPort;
	fluid: Fluid;
	temperatureK: number;
	/** Simulation step, seconds. Fixed so the behaviour is reproducible. */
	dtSeconds: number;
	/** Transmitter on the controlled variable. */
	transmitter: TransmitterSpec;
	/** Controller. Null when the exercise is manual only. */
	pid: PidSpec | null;
	/** I/P converter calibration. */
	ipConverter: IpConverterSpec;
	/** Which way the process flow enters the plug. */
	flowToOpen: boolean;
	/** Seed for the measurement noise, so every run reproduces. */
	seed: number;
}

export interface SimulatorReadouts {
	/** Simulated time, seconds. */
	timeSeconds: number;
	/** Controlled variable as the transmitter sees it, in engineering units. */
	measurement: number;
	/** True process value, without transmitter lag or noise. */
	trueMeasurement: number;
	setpoint: number;
	/** Controller output, percent. In manual mode this mirrors the manual current. */
	controllerOutputPercent: number;
	/** Transmitter loop current, mA. */
	transmitterCurrentMa: number;
	transmitterStatus: SignalStatus;
	/** Current arriving at the I/P converter after any wiring fault. */
	receivedCurrentMa: number;
	/**
	 * Status of the signal as the control system receives it.
	 *
	 * Distinct from `transmitterStatus`, which describes the transmitter's own
	 * output. When a wiring fault breaks the loop the transmitter is still healthy
	 * and reports a valid signal, while what arrives at the controller is a fault.
	 * An operator needs the second of those, because it is the one the loop acts on.
	 */
	receivedStatus: SignalStatus;
	/** Air pressure from the I/P converter, bar gauge. */
	airPressureBar: number;
	/**
	 * Air pressure the positioner is asking for, bar gauge.
	 *
	 * Shown alongside the case pressure because the difference between the two is
	 * the positioner at work, and because a positioner pinned at the supply
	 * pressure is the classic sign of a valve that cannot reach full travel.
	 */
	positionerPressureBar: number;
	/** Air pressure actually delivered to the diaphragm, after the positioner. */
	deliveredPressureBar: number;
	/** Commanded travel from the signal, percent. */
	commandedTravelPercent: number;
	/** Actual travel, percent. This is the number that differs from the command. */
	actualTravelPercent: number;
	/** Actual travel minus commanded travel, percent. */
	followingErrorPercent: number;
	frictionForceN: number;
	fluidForceN: number;
	springForceN: number;
	diaphragmForceN: number;
	netForceN: number;
	seatLoadN: number;
	deadbandPercent: number;
	/** Effective flow coefficient at the current opening. */
	effectiveKv: number;
	flow: FlowResult;
	/** Process specific secondary readings. */
	processReadouts: { label: string; value: number; unit: string }[];
	/**
	 * The operator controls the process exposes, with their current state.
	 *
	 * Published in the snapshot rather than read from the process directly, so the
	 * interface updates a button label through the same reactivity that updates a
	 * number. A control whose state is only reachable by calling a method on the
	 * process would leave its label stale, because the call site reads no signal.
	 */
	processActions: { id: string; label: string; active: boolean }[];
	/** Notes explaining the current hydraulic situation. */
	notes: string[];
	/** True when the valve has no external signal and works from the process alone. */
	selfActing: boolean;
}

export interface Simulator {
	readonly config: SimulatorConfig;
	readonly readouts: SimulatorReadouts;
	/** Advance by exactly one fixed step. */
	step(): void;
	/**
	 * Advance by a slice of wall clock time, at the fixed simulation step.
	 *
	 * This is the method a render loop calls. It carries the time it could not
	 * spend as a whole step forward to the next call, so the simulation runs at
	 * real time whatever the frame rate happens to be. See the implementation for
	 * why that carry matters.
	 */
	advance(deltaSeconds: number): number;
	/** Command the valve directly in manual mode, percent. */
	setManualOutputPercent(percent: number): void;
	/** Choose between manual command and automatic control. */
	setMode(mode: 'manual' | 'auto'): void;
	get mode(): 'manual' | 'auto';
	setSetpoint(value: number): void;
	/** Inject a wiring fault into the transmitter loop. */
	setLoopFault(fault: CurrentLoopFault): void;
	/** Replace the controller without losing the process state. */
	setPid(pid: PidSpec | null): void;
	/** Return the process to its initial condition and clear the signal chain. */
	resetProcess(): void;
	/** True when the valve is at or past a limit of travel. */
	atTravelLimit(): boolean;
}

const EMPTY_FLOW: FlowResult = {
	volumetricFlowM3PerHour: 0,
	massFlowKgPerHour: 0,
	massFlowKgPerSecond: 0,
	effectivePressureDropBar: 0,
	availablePressureDropBar: 0,
	choked: false,
	expansionFactor: 1,
	pressureDropRatio: 0,
	sigmaIndex: null,
	cavitation: 'none',
	bodyVelocityMPerSecond: 0
};

/**
 * Build a simulator.
 *
 * The simulator owns all mutable state in its closure, which keeps the call site
 * simple: the render loop calls `step` and reads `readouts`. Nothing outside can
 * put the engine into an inconsistent state by writing a field.
 */
export function createSimulator(config: SimulatorConfig): Simulator {
	const random = createRandom(config.seed);
	const actuator = config.valve.spec.actuator;
	const isSelfActing = config.valve.spec.actuation === 'selfActing';
	const closedPosition = config.valve.closedPosition();
	const openPosition = config.valve.openPosition();

	let timeSeconds = 0;
	let transmitter: TransmitterState = createTransmitterState(config.transmitter);
	let ipConverter: IpConverterState = createIpConverterState(config.ipConverter);
	let pidState: PidState | null = config.pid
		? createPidState(config.pid, config.process.measurement())
		: null;
	let stem: StemMotionState = { positionM: closedPosition, velocityMPerSecond: 0, frictionForceN: 0 };
	let actuatorCase: ActuatorCaseState = actuator
		? createActuatorCaseState(actuator, 0)
		: { pressureBar: 1.01325 };
	let positioner: PositionerState = createPositionerState(0);
	/**
	 * Whether a self acting valve was open at the previous step.
	 *
	 * A relief valve's blowdown is hysteresis by design, so its position depends on
	 * where it came from and not only on the pressure it sees. The state belongs
	 * here rather than in the valve model, because a model is a reusable description
	 * and the trajectory is a property of this particular run.
	 */
	let selfActingWasOpen = false;
	let valveOpening = 0;
	let manualCurrentMa = 4;
	let setpoint = (config.transmitter.lowerRange + config.transmitter.upperRange) / 2;
	let loopFault: CurrentLoopFault = NO_FAULT;
	let currentMode: 'manual' | 'auto' = config.pid ? 'auto' : 'manual';

	/**
	 * Wall clock time that has elapsed but has not yet been simulated.
	 *
	 * A render loop calls `advance` with whatever time the last frame took, which is
	 * almost never a whole number of simulation steps. Throwing that remainder away
	 * looks harmless and is not: at 60 frames per second a frame lasts 16.7 ms while
	 * the simulation step is 20 ms, so the remainder is the entire frame and the
	 * simulation never advances at all. Carrying it forward is what makes the
	 * simulation run at real time regardless of frame rate.
	 */
	let pendingSeconds = 0;

	/** Snapshot the operator controls so the interface can render their state. */
	function readProcessActions(): { id: string; label: string; active: boolean }[] {
		return config.process.actions.map((action) => {
			const active = action.isActive();
			return { id: action.id, label: active ? action.labelOff : action.labelOn, active };
		});
	}

	/**
	 * Friction seen by the stem, including the actuator's own damping.
	 *
	 * The packing friction comes from the valve spec. The damping is the
	 * actuator's, and it represents the resistance of the air being pushed out of
	 * the way as the diaphragm moves. Keeping them separate in the specs but
	 * merged here means the stem integrator only has to know about one friction
	 * model.
	 */
	const stemFriction: FrictionSpec = actuator
		? {
				...config.valve.spec.friction,
				viscousNPerMetrePerSecond:
					config.valve.spec.friction.viscousNPerMetrePerSecond ??
					actuator.dampingNPerMetrePerSecond ??
					DEFAULT_DAMPING_N_PER_MPS
			}
		: config.valve.spec.friction;

	/**
	 * The readouts at rest, with every value at its zero state.
	 *
	 * Used both when the simulator is built and when the process is reset. Sharing
	 * one construction between the two is what guarantees a reset cannot leave a
	 * stale value on screen: a partial update would quietly keep whatever the last
	 * step happened to publish.
	 */
	function idleReadouts(): SimulatorReadouts {
		return {
			timeSeconds: 0,
			measurement: config.process.measurement(),
			trueMeasurement: config.process.measurement(),
			setpoint,
			controllerOutputPercent: 0,
			transmitterCurrentMa: 4,
			transmitterStatus: 'valid',
			receivedCurrentMa: 4,
			receivedStatus: 'valid',
			airPressureBar: 0,
			positionerPressureBar: 0,
			deliveredPressureBar: 0,
			commandedTravelPercent: 0,
			actualTravelPercent: 0,
			followingErrorPercent: 0,
			frictionForceN: 0,
			fluidForceN: 0,
			springForceN: 0,
			diaphragmForceN: 0,
			netForceN: 0,
			seatLoadN: 0,
			deadbandPercent: 0,
			effectiveKv: 0,
			flow: EMPTY_FLOW,
			processReadouts: config.process.readouts(),
			processActions: readProcessActions(),
			notes: [],
			selfActing: isSelfActing
		};
	}

	let readouts: SimulatorReadouts = idleReadouts();

	function step(): void {
		const dt = config.dtSeconds;
		const valve = config.valve;

		// --- 1. Read the process and transmit the measurement -----------------
		const trueMeasurement = config.process.measurement();
		transmitter = stepTransmitter(
			config.transmitter,
			transmitter,
			trueMeasurement,
			dt,
			random
		);

		// --- 2. Decide the controller output ----------------------------------
		// The controller sees whatever current arrived, including a fault. That is
		// the point of modelling faults at all: the loop reacts to the fault, not
		// to the truth.
		const receivedCurrentMa = applyLoopFault(transmitter.currentMa, loopFault);
		const receivedStatus = evaluateNamur(receivedCurrentMa);
		const measurementFailed =
			receivedStatus === 'downscaleFault' || receivedStatus === 'upscaleFault';

		let controllerOutputPercent: number;
		if (currentMode === 'auto' && config.pid && pidState) {
			if (measurementFailed) {
				// A control system takes a failed measurement out of automatic. Holding
				// the last output is what an operator would see on the trend.
				controllerOutputPercent = pidState.outputPercent;
			} else {
				pidState = stepPid(config.pid, pidState, {
					setpoint,
					// A failed measurement is already handled above, so the controller
					// works from the transmitted value including its noise and lag.
					measurement: transmitter.measuredValue,
					dtSeconds: dt
				});
				controllerOutputPercent = pidState.outputPercent;
			}
		} else {
			controllerOutputPercent = ((manualCurrentMa - 4) / 16) * 100;
		}

		// --- 3. Convert the output to a pneumatic signal ----------------------
		const commandedCurrentMa =
			currentMode === 'auto' ? 4 + (controllerOutputPercent / 100) * 16 : manualCurrentMa;
		ipConverter = stepIpConverter(config.ipConverter, ipConverter, commandedCurrentMa, dt);

		// The commanded fraction of stroke, taken from the signal rather than from
		// the I/P output pressure. A positioner is calibrated so that the full
		// signal range maps onto the full stroke, which is a separate adjustment
		// from the actuator bench set.
		const commandedFraction = Math.min(1, Math.max(0, currentMaToFraction(commandedCurrentMa)));

		// --- 4. Force balance on the stem -------------------------------------
		const boundary = config.process.boundaryConditions(
			readouts.effectiveKv,
			config.fluid,
			config.temperatureK
		);
		const pressureDropBar = Math.max(
			0,
			boundary.upstreamPressureBar - boundary.downstreamPressureBar
		);

		let fluidForce = 0;
		let springForce = 0;
		let diaphragmForce = 0;
		let seatLoad = 0;
		let deliveredPressureBar = 0;
		let commandedTravelPercent: number;

		if (isSelfActing) {
			// A self acting valve has no signal. Its position comes from the pressure
			// difference acting against its spring. The closure is light and heavily
			// damped, so a static balance describes it well, except where the valve
			// states its own law: a relief valve's blowdown is hysteresis, so it needs
			// to know whether it was already open.
			const pressureDifferenceBar =
				boundary.upstreamPressureBar - boundary.downstreamPressureBar;

			valveOpening = valve.computeOpening
				? valve.computeOpening({
						pressureDifferenceBar,
						wasOpen: selfActingWasOpen,
						fluid: config.fluid
					})
				: actuator
					? selfActingOpening(actuator, pressureDifferenceBar)
					: 0;

			selfActingWasOpen = valveOpening > 0;
			stem = {
				positionM: valve.fromOpening(valveOpening),
				velocityMPerSecond: 0,
				frictionForceN: 0
			};
			fluidForce = valve.fluidForce(pressureDropBar, true, valveOpening);
			commandedTravelPercent = valveOpening * 100;
		} else if (actuator) {
			// The positioner trims the air pressure until the stem reaches the
			// commanded fraction of stroke, and the air in the case then takes time to
			// follow the pressure the positioner asks for. The positioner sets the
			// accuracy, the case fill and the air spring set the speed.
			positioner = stepPositioner(
				actuator,
				positioner,
				commandedFraction,
				ipConverter.outputBar,
				stem.positionM,
				dt
			);

			const mechanism = stepMechanism({
				actuator,
				friction: stemFriction,
				valve,
				caseState: actuatorCase,
				stem,
				commandPressureBar: positioner.outputBar,
				pressureDropBar,
				flowToOpen: config.flowToOpen,
				closedPosition,
				openPosition,
				dtSeconds: dt
			});

			stem = mechanism.stem;
			actuatorCase = mechanism.caseState;
			valveOpening = mechanism.valveOpening;
			springForce = mechanism.springForceN;
			diaphragmForce = mechanism.diaphragmForceN;
			fluidForce = mechanism.fluidForceN;

			deliveredPressureBar = caseGaugePressureBar(actuatorCase);
			seatLoad = computeSeatLoad(actuator, deliveredPressureBar, stem.positionM);
			commandedTravelPercent = travelPercentFromPressure(actuator, ipConverter.outputBar);
		} else {
			// A commandable valve with no actuator model, such as a handwheel gate
			// valve. The stem follows the command directly, because a person turning
			// a handwheel is a position source rather than a force source.
			valveOpening = Math.min(1, Math.max(0, controllerOutputPercent / 100));
			stem = {
				positionM: valve.fromOpening(valveOpening),
				velocityMPerSecond: 0,
				frictionForceN: 0
			};
			commandedTravelPercent = valveOpening * 100;
		}

		// --- 5. Flow through the valve at the new position ---------------------
		const effectiveKv = valve.flowCoefficient({
			opening: valveOpening,
			fluid: config.fluid,
			flowToOpen: config.flowToOpen
		});

		const upstreamDensity = config.fluid.density(
			boundary.upstreamPressureBar,
			config.temperatureK
		);

		/**
		 * Flow through the valve.
		 *
		 * A valve whose capacity is not described by a flow coefficient states its
		 * own law, and a relief valve is the case that matters: it is sized on an
		 * orifice area rather than on a Kv, so running the generic sizing equation on
		 * it would compute nothing at all. Everything else goes through the standard
		 * IEC 60534 equations.
		 */
		const flow: FlowResult = valve.computeFlow
			? (() => {
					const own = valve.computeFlow({
						opening: valveOpening,
						fluid: config.fluid,
						flowToOpen: config.flowToOpen,
						upstreamPressureBar: boundary.upstreamPressureBar,
						downstreamPressureBar: boundary.downstreamPressureBar,
						temperatureK: config.temperatureK,
						pressureDropBar,
						densityKgPerM3: upstreamDensity,
						molarMassKgPerMol: config.fluid.molarMassKgPerMol,
						specificHeatRatio: config.fluid.specificHeatRatio
					});
					return {
						...EMPTY_FLOW,
						volumetricFlowM3PerHour: own.volumetricFlowM3PerHour,
						massFlowKgPerHour: own.massFlowKgPerHour,
						massFlowKgPerSecond: own.massFlowKgPerHour / 3600,
						effectivePressureDropBar: own.effectivePressureDropBar,
						availablePressureDropBar: pressureDropBar,
						choked: own.choked,
						bodyVelocityMPerSecond:
							upstreamDensity > 0 && valve.spec.ports.portAreaM2 > 0
								? own.massFlowKgPerHour / 3600 / (upstreamDensity * valve.spec.ports.portAreaM2)
								: 0
					};
				})()
			: computeFlow({
					fluid: config.fluid,
					kv: valveOpening > 0 ? effectiveKv : 0,
					upstreamPressureBar: boundary.upstreamPressureBar,
					downstreamPressureBar: boundary.downstreamPressureBar,
					temperatureK: config.temperatureK,
					pressureRecoveryFactor: valve.spec.pressureRecoveryFactor,
					terminalPressureDropRatio: valve.spec.terminalPressureDropRatio,
					// The specific heat ratio of the actual fluid, for the F-gamma
					// correction to the terminal pressure drop ratio. Omitting it falls
					// back to the value for air, which silently sizes every gas as if it
					// were air and moves the choke point for hydrogen, carbon dioxide,
					// methane and steam.
					specificHeatRatio: config.fluid.specificHeatRatio,
					incipientCavitationSigma: valve.spec.incipientCavitationSigma
				});

		// --- 6. Integrate the process -----------------------------------------
		config.process.advance(flow.massFlowKgPerSecond, dt);
		timeSeconds += dt;

		// --- 7. Publish the readouts ------------------------------------------
		readouts = {
			timeSeconds,
			measurement: transmitter.measuredValue,
			trueMeasurement,
			setpoint,
			controllerOutputPercent,
			transmitterCurrentMa: transmitter.currentMa,
			transmitterStatus: transmitter.status,
			receivedCurrentMa,
			receivedStatus,
			airPressureBar: ipConverter.outputBar,
			positionerPressureBar: positioner.outputBar,
			deliveredPressureBar,
			commandedTravelPercent,
			actualTravelPercent: valveOpening * 100,
			followingErrorPercent: valveOpening * 100 - commandedTravelPercent,
			frictionForceN: stem.frictionForceN,
			fluidForceN: fluidForce,
			springForceN: springForce,
			diaphragmForceN: diaphragmForce,
			netForceN: springForce + diaphragmForce + fluidForce,
			seatLoadN: seatLoad,
			deadbandPercent: actuator
				? deadbandPercent(
						valve.spec.friction.staticFrictionN,
						springRateNPerM(actuator),
						actuator.strokeM
					)
				: 0,
			effectiveKv,
			flow,
			processReadouts: config.process.readouts(),
			processActions: readProcessActions(),
			notes: boundary.notes,
			selfActing: isSelfActing
		};
	}

	function resetProcess(): void {
		config.process.reset();
		transmitter = createTransmitterState(config.transmitter);
		ipConverter = createIpConverterState(config.ipConverter);
		pidState = config.pid
			? createPidState(config.pid, config.process.measurement())
			: null;
		stem = { positionM: closedPosition, velocityMPerSecond: 0, frictionForceN: 0 };
		actuatorCase = actuator
			? createActuatorCaseState(actuator, 0)
			: { pressureBar: 1.01325 };
		positioner = createPositionerState(0);
		selfActingWasOpen = false;
		valveOpening = 0;
		timeSeconds = 0;
		pendingSeconds = 0;
		readouts = idleReadouts();
	}

	return {
		config,
		get readouts() {
			return readouts;
		},
		get mode() {
			return currentMode;
		},
		step,

		advance(deltaSeconds: number): number {
			if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0;

			const available = pendingSeconds + deltaSeconds;

			// The step count comes from a division rather than from subtracting the
			// step size in a loop. Repeated subtraction accumulates error: after seven
			// subtractions of 0.02 the remainder is 0.019999999999999993, which is
			// below the step size, so a frame that should run eight steps runs seven
			// and the carry grows without limit. The tolerance absorbs the
			// representation error of the step size itself.
			const wantedSteps = Math.floor(available / config.dtSeconds + STEP_COUNT_TOLERANCE);
			const steps = Math.min(Math.max(0, wantedSteps), MAX_STEPS_PER_ADVANCE);

			for (let i = 0; i < steps; i++) step();

			// Backlog cap. A tab that was in the background for a minute reports a
			// minute of elapsed time, and simulating all of it in one frame would
			// freeze the browser for as long as that takes. Time beyond the cap is
			// dropped deliberately and the carry is cleared with it, so the frames
			// that follow run normally instead of working through a debt. Dropping
			// time is the honest choice: the alternative is a simulation that quietly
			// runs in fast forward to catch up.
			const maxBacklogSeconds = config.dtSeconds * MAX_STEPS_PER_ADVANCE;
			pendingSeconds =
				available > maxBacklogSeconds ? 0 : available - steps * config.dtSeconds;

			return steps;
		},

		setManualOutputPercent(percent: number) {
			manualCurrentMa = 4 + (Math.min(100, Math.max(0, percent)) / 100) * 16;
		},
		setMode(mode: 'manual' | 'auto') {
			currentMode = mode;
			// Handing over to automatic starts the controller from where the valve
			// already is, so the transfer does not bump the process.
			if (mode === 'auto' && config.pid) {
				pidState = createPidState(config.pid, readouts.actualTravelPercent);
				if (pidState) {
					pidState.integralPercent = readouts.actualTravelPercent;
					pidState.outputPercent = readouts.actualTravelPercent;
				}
			}
		},
		setSetpoint(value: number) {
			setpoint = value;
		},
		setLoopFault(fault: CurrentLoopFault) {
			loopFault = fault;
		},
		setPid(pid: PidSpec | null) {
			config.pid = pid;
			pidState = pid ? createPidState(pid, readouts.measurement) : null;
		},
		resetProcess,
		atTravelLimit() {
			return valveOpening <= 0 || valveOpening >= 1;
		}
	};
}

function computeSeatLoad(
	actuator: ActuatorSpec,
	pressureBar: number,
	positionM: number
): number {
	if (positionM > 1e-6) return 0;
	// A negative net force at zero travel is the force pressing the plug into the
	// seat, which is the seat load.
	const net = springForceN(actuator, 0) + airForceN(actuator, pressureBar);
	return net < 0 ? -net : 0;
}

/**
 * Upper bound on mechanical sub steps per simulation step.
 *
 * A correctly sized actuator needs a handful. The cap exists so that a pathological
 * configuration, such as a very stiff spring on a very light stem, degrades the
 * accuracy of the stroke rather than freezing the browser.
 */
const MAX_MECHANISM_SUBSTEPS = 64;

/**
 * Fraction of the stability limit used for the mechanical sub step.
 *
 * The stem is integrated with semi-implicit Euler, which is stable only while the
 * step stays below 2 / omega of the spring mass system it forms. Taking a fifth of
 * that limit leaves a wide margin and keeps the stroke shape accurate.
 */
const MECHANISM_STABILITY_FRACTION = 0.2;

export interface MechanismResult {
	stem: StemMotionState;
	caseState: ActuatorCaseState;
	springForceN: number;
	diaphragmForceN: number;
	fluidForceN: number;
	valveOpening: number;
}

/**
 * Integrate the stem, the air in the diaphragm case and the fluid reaction
 * together over one simulation step.
 *
 * The reason this needs its own loop is that the two halves of the problem run at
 * very different speeds. The air in the case has a time constant of roughly half a
 * second, while the stem and spring form a mass spring system oscillating at tens
 * of hertz. Integrating both at the simulation step would be either wildly
 * inaccurate for the stem or needlessly slow for the air, so the air is advanced
 * once per sub step and the stem is integrated at a step size derived from its own
 * natural frequency.
 *
 * Order within a sub step matters and is deliberate:
 *
 *   1. Air flows through the restriction toward the commanded pressure.
 *   2. The force balance uses the resulting case pressure.
 *   3. The stem moves.
 *   4. The stem motion changes the case volume, which changes the pressure that
 *      the next sub step starts from.
 *
 * Step 4 is what makes the actuator pneumatically damped, and without it the stem
 * accelerates without limit and slams into its stops within a single simulation
 * step.
 */
export function stepMechanism(input: {
	actuator: ActuatorSpec;
	friction: FrictionSpec;
	valve: ValveModel;
	caseState: ActuatorCaseState;
	stem: StemMotionState;
	commandPressureBar: number;
	pressureDropBar: number;
	flowToOpen: boolean;
	closedPosition: number;
	openPosition: number;
	dtSeconds: number;
}): MechanismResult {
	const {
		actuator,
		friction,
		valve,
		commandPressureBar,
		pressureDropBar,
		flowToOpen,
		closedPosition,
		openPosition,
		dtSeconds
	} = input;

	// Sub step size from the mechanical natural frequency. Only the mechanical
	// spring is used: the air spring softens the system rather than stiffening it,
	// so this is the conservative choice.
	const mechanicalSpringRate = springRateNPerM(actuator);
	const naturalFrequency =
		mechanicalSpringRate > 0
			? Math.sqrt(mechanicalSpringRate / Math.max(actuator.movingMassKg, 1e-6))
			: 0;
	const stabilityLimit = naturalFrequency > 0 ? 2 / naturalFrequency : dtSeconds;
	const targetSubStep = Math.max(1e-5, stabilityLimit * MECHANISM_STABILITY_FRACTION);
	const substeps = Math.min(
		MAX_MECHANISM_SUBSTEPS,
		Math.max(1, Math.ceil(dtSeconds / targetSubStep))
	);
	const subDt = dtSeconds / substeps;

	let caseState = input.caseState;
	let stem = input.stem;
	let valveOpening = valve.toOpening(stem.positionM);
	let springForce = 0;
	let diaphragmForce = 0;
	let fluidForce = 0;

	for (let i = 0; i < substeps; i++) {
		const previousPositionM = stem.positionM;

		// 1. Air exchange through the restriction.
		caseState = fillActuatorCase(actuator, caseState, commandPressureBar, previousPositionM, subDt);
		const caseGaugeBar = caseGaugePressureBar(caseState);

		// 2. Force balance at the pressure the case has now reached.
		springForce = springForceN(actuator, previousPositionM);
		diaphragmForce = airForceN(actuator, caseGaugeBar);
		fluidForce = valve.fluidForce(pressureDropBar, flowToOpen, valveOpening);
		const netForce = springForce + diaphragmForce + fluidForce;

		// 3. Stem motion.
		stem = integrateStemMotion(
			actuator.movingMassKg,
			friction,
			stem,
			netForce,
			closedPosition,
			openPosition,
			subDt
		);

		// 4. The diaphragm moved, so the case volume changed and with it the
		// pressure the next sub step starts from.
		caseState = applyCaseVolumeChange(actuator, caseState, previousPositionM, stem.positionM);
		valveOpening = valve.toOpening(stem.positionM);
	}

	return { stem, caseState, springForceN: springForce, diaphragmForceN: diaphragmForce, fluidForceN: fluidForce, valveOpening };
}

function travelPercentFromPressure(actuator: ActuatorSpec, pressureBar: number): number {
	if (actuator.strokeM <= 0) return 0;
	return (positionFromPressure(actuator, pressureBar) / actuator.strokeM) * 100;
}

/** Run the simulator for a number of steps. Used by the tests and the scrubber. */
export function runSteps(simulator: Simulator, steps: number): void {
	for (let i = 0; i < steps; i++) simulator.step();
}

/**
 * Tolerance used when converting elapsed time into a whole number of steps.
 *
 * A step size such as 0.02 s has no exact binary representation, so an elapsed
 * time that should contain exactly eight of them can divide to 7.999999999. The
 * tolerance is far smaller than any real fraction of a step and far larger than
 * that error.
 */
const STEP_COUNT_TOLERANCE = 1e-9;

/**
 * Most simulation steps a single `advance` call will take.
 *
 * Eight steps is 0.16 s of simulated time at the default 0.02 s step, which is
 * enough to catch up from a stutter without letting a long stall turn into a
 * freeze. Raising it makes a backgrounded tab recover more of its lost time and
 * makes the frame it returns on slower; lowering it makes the simulation lose
 * more time after a stutter.
 */
export const MAX_STEPS_PER_ADVANCE = 8;
