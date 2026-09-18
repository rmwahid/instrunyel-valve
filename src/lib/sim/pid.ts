/**
 * PID controller in the form a distributed control system actually implements.
 *
 * Three details separate a textbook PID from a working one, and all three are
 * modelled here:
 *
 *  - Derivative acts on the measurement, not the error, so a setpoint step does
 *    not produce a derivative kick that slams the valve.
 *  - The derivative is filtered, because differentiating a noisy 4-20 mA signal
 *    produces more noise than information.
 *  - The integral is clamped while the output is saturated, so a valve that is
 *    already wide open does not keep winding the integral up.
 */

export type ControllerAction = 'direct' | 'reverse';

export interface PidSpec {
	/** Proportional gain. Dimensionless: output percent per engineering unit of error. */
	gain: number;
	/** Integral time in seconds. Zero disables the integral term. */
	integralSeconds: number;
	/** Derivative time in seconds. Zero disables the derivative term. */
	derivativeSeconds: number;
	/** Output at zero error, percent. Provides manual reset so a PI loop can sit at a bias. */
	biasPercent?: number;
	/** Lower output limit, percent. */
	outputMinPercent: number;
	/** Upper output limit, percent. */
	outputMaxPercent: number;
	/** Derivative filter time constant, seconds. */
	derivativeFilterSeconds?: number;
	/**
	 * Setpoint weight on the proportional term, 0 to 1. Below 1 softens the
	 * response to a setpoint change without slowing the response to a disturbance.
	 */
	setpointWeight?: number;
	action: ControllerAction;
}

export interface PidState {
	/** Integral contribution to the output, in percent. */
	integralPercent: number;
	/** Filtered derivative of the measurement, engineering units per second. */
	filteredDerivative: number;
	/** Previous measurement, for computing the derivative. */
	previousMeasurement: number;
	/** Last computed output, percent. */
	outputPercent: number;
	/** True while the output is against a limit. */
	saturated: boolean;
	/** Proportional contribution of the last scan, percent, for the breakdown display. */
	proportionalPercent: number;
	/** Derivative contribution of the last scan, percent. */
	derivativePercent: number;
}

export interface PidInput {
	setpoint: number;
	measurement: number;
	dtSeconds: number;
}

export function createPidState(spec: PidSpec, initialMeasurement: number): PidState {
	return {
		integralPercent: spec.biasPercent ?? 0,
		filteredDerivative: 0,
		previousMeasurement: initialMeasurement,
		outputPercent: spec.biasPercent ?? 0,
		saturated: false,
		proportionalPercent: 0,
		derivativePercent: 0
	};
}

/**
 * Advance the controller by one scan.
 *
 * The derivative uses the exact first order filter discretisation so a slow scan
 * rate cannot make the filter unstable.
 */
export function stepPid(spec: PidSpec, state: PidState, input: PidInput): PidState {
	const { setpoint, measurement, dtSeconds } = input;
	if (dtSeconds <= 0) return state;

	const error = spec.action === 'reverse' ? setpoint - measurement : measurement - setpoint;

	// Proportional term, with setpoint weighting so a setpoint change can be
	// softened without changing the loop's response to a disturbance.
	const setpointWeight = spec.setpointWeight ?? 1;
	const proportionalInput =
		spec.action === 'reverse'
			? setpointWeight * setpoint - measurement
			: measurement - setpointWeight * setpoint;
	const proportionalPercent = spec.gain * proportionalInput;

	// Derivative on measurement, negated so that a rising measurement reduces the
	// output of a reverse acting controller.
	const rawDerivative = (measurement - state.previousMeasurement) / dtSeconds;
	const filterTime = spec.derivativeFilterSeconds ?? 0;
	const derivativeAlpha = filterTime > 0 ? 1 - Math.exp(-dtSeconds / filterTime) : 1;
	const filteredDerivative =
		state.filteredDerivative + (rawDerivative - state.filteredDerivative) * derivativeAlpha;

	const derivativeDirection = spec.action === 'reverse' ? -1 : 1;
	const derivativePercent = derivativeDirection * spec.gain * spec.derivativeSeconds * filteredDerivative;

	// Integral term, advanced only when doing so would not drive the output
	// further into a limit. This is the clamping form of anti-windup.
	const integralRate = spec.integralSeconds > 0 ? (spec.gain / spec.integralSeconds) * error : 0;
	const integralDelta = integralRate * dtSeconds;

	const unsaturated =
		(state.integralPercent + integralDelta) + proportionalPercent + derivativePercent;
	const pushingUp = unsaturated > spec.outputMaxPercent && integralDelta > 0;
	const pushingDown = unsaturated < spec.outputMinPercent && integralDelta < 0;

	const integralPercent =
		pushingUp || pushingDown ? state.integralPercent : state.integralPercent + integralDelta;

	const rawOutput = integralPercent + proportionalPercent + derivativePercent;
	const outputPercent = Math.min(
		spec.outputMaxPercent,
		Math.max(spec.outputMinPercent, rawOutput)
	);

	return {
		integralPercent,
		filteredDerivative,
		previousMeasurement: measurement,
		outputPercent,
		saturated: rawOutput > spec.outputMaxPercent || rawOutput < spec.outputMinPercent,
		proportionalPercent,
		derivativePercent
	};
}

/**
 * Proportional band as a field instrument would show it.
 *
 * A controller with gain 2 has a 50 percent proportional band: the output
 * travels its full range when the error moves 50 percent of the measurement span.
 */
export function proportionalBandPercent(spec: PidSpec): number {
	if (spec.gain <= 0) return Infinity;
	return 100 / spec.gain;
}

export interface ProcessReactionCurve {
	/** Process gain: engineering units of measurement per percent of controller output. */
	processGain: number;
	/** Apparent time constant, seconds. */
	timeConstantSeconds: number;
	/** Apparent dead time, seconds. */
	deadTimeSeconds: number;
}

export interface PidTuning {
	gain: number;
	integralSeconds: number;
	derivativeSeconds: number;
	/** The rule the values came from. */
	method: string;
}

/**
 * Ziegler-Nichols open loop tuning, from a process reaction curve.
 *
 * The rule is deliberately aggressive: it is designed for quarter amplitude
 * damping, which is more oscillatory than most plants want today. It is included
 * because it is the rule every instrumentation course teaches, and the lab lets
 * you dial the result back to something calmer.
 */
export function zieglerNicholsOpenLoop(curve: ProcessReactionCurve): PidTuning {
	const { processGain, timeConstantSeconds, deadTimeSeconds } = curve;
	if (processGain <= 0 || timeConstantSeconds <= 0 || deadTimeSeconds <= 0) {
		return { gain: 1, integralSeconds: 0, derivativeSeconds: 0, method: 'not applicable' };
	}
	return {
		gain: (1.2 * timeConstantSeconds) / (processGain * deadTimeSeconds),
		integralSeconds: 2 * deadTimeSeconds,
		derivativeSeconds: 0.5 * deadTimeSeconds,
		method: 'Ziegler-Nichols open loop, PID'
	};
}

/** A calmer starting point: half the Ziegler-Nichols gain with the same times. */
export function conservativeTuning(curve: ProcessReactionCurve): PidTuning {
	const zn = zieglerNicholsOpenLoop(curve);
	return {
		gain: zn.gain / 2,
		integralSeconds: zn.integralSeconds * 2,
		derivativeSeconds: zn.derivativeSeconds,
		method: 'Half gain, double integral time'
	};
}

/**
 * Estimated process reaction curve for a first order plus dead time process.
 *
 * Used by the lab to suggest a starting tune from the identified process rather
 * than making the user guess.
 */
export function firstOrderPlusDeadTimeCurve(
	processGain: number,
	timeConstantSeconds: number,
	deadTimeSeconds: number
): ProcessReactionCurve {
	return { processGain, timeConstantSeconds, deadTimeSeconds };
}

export function describePid(spec: PidSpec): string {
	const parts = [`Gain ${spec.gain.toFixed(2)}`];
	parts.push(
		spec.integralSeconds > 0 ? `Integral ${spec.integralSeconds.toFixed(1)} s` : 'Integral off'
	);
	parts.push(
		spec.derivativeSeconds > 0 ? `Derivative ${spec.derivativeSeconds.toFixed(1)} s` : 'Derivative off'
	);
	if (spec.gain > 0) parts.push(`Proportional band ${(100 / spec.gain).toFixed(0)} percent`);
	return parts.join(', ');
}
