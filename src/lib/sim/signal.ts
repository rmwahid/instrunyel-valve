/**
 * Instrument signal chain: transmitter, wiring, I/P converter.
 *
 * Almost every signal in a process plant travels the same path: a sensor drives
 * a 4-20 mA current loop, the control system digitises it, and on the way out an
 * I/P converter turns the current back into a pneumatic pressure that a valve
 * actuator can use. Each conversion adds lag, noise and a resolution limit, and
 * those imperfections are the reason a real loop never behaves like the textbook
 * block diagram. This module models them so the lab can show the difference.
 *
 * Randomness is generated from an explicit seed so a given scenario always
 * reproduces exactly. Determinism matters here: a lesson that drifts each time
 * it runs cannot be used to demonstrate anything.
 */

import {
	CURRENT_4_20_MA,
	NAMUR_NE43,
	currentMaToFraction,
	fractionToCurrentMa
} from './units';

/**
 * Small seeded pseudo random generator (mulberry32).
 *
 * Used instead of Math.random so that noise, and therefore every derived
 * measurement, is reproducible run to run.
 */
export function createRandom(seed: number): () => number {
	let state = seed >>> 0;
	return function next(): number {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Symmetric noise in the range -amplitude..+amplitude. */
export function noise(random: () => number, amplitude: number): number {
	if (amplitude <= 0) return 0;
	return (random() * 2 - 1) * amplitude;
}

export type SignalStatus =
	/** Inside the valid process range. */
	| 'valid'
	/** Below 3.6 mA: broken loop, dead transmitter or lost supply. */
	| 'downscaleFault'
	/** Above 21.0 mA: short circuit or overrange. */
	| 'upscaleFault'
	/** Between 3.6 and 3.8 mA: valid but outside the usable range. */
	| 'saturatedLow'
	/** Between 20.5 and 21.0 mA: valid but outside the usable range. */
	| 'saturatedHigh';

/**
 * Classify a loop current the way a control system does under NAMUR NE43.
 *
 * The standard exists so an operator can tell "the measurement really is at the
 * bottom of its range" apart from "the transmitter has failed". Both look like a
 * low reading, and only the current tells them apart.
 */
export function evaluateNamur(currentMa: number): SignalStatus {
	if (currentMa < NAMUR_NE43.downscaleFaultMa) return 'downscaleFault';
	if (currentMa > NAMUR_NE43.upscaleFaultMa) return 'upscaleFault';
	if (currentMa < NAMUR_NE43.lowerSaturationMa) return 'saturatedLow';
	if (currentMa > NAMUR_NE43.upperSaturationMa) return 'saturatedHigh';
	return 'valid';
}

export function signalStatusLabel(status: SignalStatus): string {
	switch (status) {
		case 'valid':
			return 'Valid';
		case 'downscaleFault':
			return 'Fault: downscale (below 3.6 mA)';
		case 'upscaleFault':
			return 'Fault: upscale (above 21.0 mA)';
		case 'saturatedLow':
			return 'Below usable range';
		case 'saturatedHigh':
			return 'Above usable range';
	}
}

export function isFault(status: SignalStatus): boolean {
	return status === 'downscaleFault' || status === 'upscaleFault';
}

export interface TransmitterSpec {
	/** Lower range value in engineering units. */
	lowerRange: number;
	/** Upper range value in engineering units. */
	upperRange: number;
	/**
	 * Damping time constant in seconds. A transmitter is specified with a damping
	 * that trades noise against response speed.
	 */
	dampingSeconds: number;
	/** Peak noise amplitude in mA, from the analogue electronics. */
	noiseMa?: number;
	/** Quantisation step in mA from the analogue to digital converter. */
	resolutionMa?: number;
	/** Unit label for display. */
	unit?: string;
}

export interface TransmitterState {
	/** Damped measurement in engineering units. */
	measuredValue: number;
	/** Loop current after noise and quantisation. */
	currentMa: number;
	status: SignalStatus;
}

export function createTransmitterState(spec: TransmitterSpec): TransmitterState {
	return {
		measuredValue: spec.lowerRange,
		currentMa: fractionToCurrentMa(0),
		status: 'valid'
	};
}

/**
 * Advance a transmitter by one step.
 *
 * The sensor element is modelled as a first order lag using the exact
 * discretisation, so a large time step cannot make the filter unstable.
 */
export function stepTransmitter(
	spec: TransmitterSpec,
	state: TransmitterState,
	processValue: number,
	dtSeconds: number,
	random: () => number
): TransmitterState {
	const timeConstant = Math.max(0, spec.dampingSeconds);
	const alpha = timeConstant > 0 ? 1 - Math.exp(-dtSeconds / timeConstant) : 1;
	const measuredValue = state.measuredValue + (processValue - state.measuredValue) * alpha;

	const span = spec.upperRange - spec.lowerRange;
	const fraction = span !== 0 ? (measuredValue - spec.lowerRange) / span : 0;
	const idealMa = fractionToCurrentMa(fraction);

	const resolution = spec.resolutionMa ?? 0;
	const withNoise = idealMa + noise(random, spec.noiseMa ?? 0);
	const quantised = resolution > 0 ? Math.round(withNoise / resolution) * resolution : withNoise;

	// A real loop cannot carry current below zero even when the electronics would
	// ask for it, and the transmitter itself saturates at about 21.5 mA.
	const currentMa = Math.min(21.5, Math.max(0, quantised));

	return {
		measuredValue,
		currentMa,
		status: evaluateNamur(currentMa)
	};
}

export function transmitterDescription(spec: TransmitterSpec): string {
	const unit = spec.unit ?? '';
	return `${spec.lowerRange} to ${spec.upperRange} ${unit}, ${spec.dampingSeconds.toFixed(1)} s damping`;
}

export interface IpConverterSpec {
	/** Lag between a change of current and the pneumatic output, seconds. */
	timeConstantSeconds: number;
	/** Output at 4 mA, bar gauge. */
	zeroBar: number;
	/** Output at 20 mA, bar gauge. */
	spanBar: number;
	/** Gain error as a fraction of span. Positive means the output overshoots. */
	gainError?: number;
	/** Zero offset in bar, the result of a calibration that has drifted. */
	zeroOffsetBar?: number;
}

export interface IpConverterState {
	outputBar: number;
}

export const DEFAULT_IP_CONVERTER: IpConverterSpec = {
	timeConstantSeconds: 0.3,
	zeroBar: 0.2,
	spanBar: 0.8
};

export function createIpConverterState(spec: IpConverterSpec): IpConverterState {
	return { outputBar: spec.zeroBar };
}

/**
 * Advance the I/P converter.
 *
 * The converter is never perfectly calibrated, so a gain error and a zero offset
 * are exposed. Both are common field faults: a valve that never quite reaches
 * full open, or one that cracks open when the signal says it should be shut.
 */
export function stepIpConverter(
	spec: IpConverterSpec,
	state: IpConverterState,
	currentMa: number,
	dtSeconds: number
): IpConverterState {
	const fraction = Math.min(1, Math.max(0, currentMaToFraction(currentMa, CURRENT_4_20_MA.minMa, CURRENT_4_20_MA.maxMa)));
	const gainError = spec.gainError ?? 0;
	const zeroOffsetBar = spec.zeroOffsetBar ?? 0;

	const targetBar =
		spec.zeroBar + fraction * spec.spanBar * (1 + gainError) + zeroOffsetBar;

	const timeConstant = Math.max(0, spec.timeConstantSeconds);
	const alpha = timeConstant > 0 ? 1 - Math.exp(-dtSeconds / timeConstant) : 1;
	const outputBar = state.outputBar + (targetBar - state.outputBar) * alpha;

	return { outputBar: Math.max(0, outputBar) };
}

export interface CurrentLoopFault {
	type: 'none' | 'openCircuit' | 'shortCircuit' | 'supplyLoss';
	/** Human readable description for the instrument panel. */
	description: string;
}

export const NO_FAULT: CurrentLoopFault = { type: 'none', description: 'Loop healthy' };

/**
 * Apply a wiring fault to a loop current.
 *
 * These are the two faults NAMUR NE43 was written to expose: an open circuit
 * drives the current to zero, a short drives it above range.
 */
export function applyLoopFault(currentMa: number, fault: CurrentLoopFault): number {
	switch (fault.type) {
		case 'openCircuit':
		case 'supplyLoss':
			return 0;
		case 'shortCircuit':
			return 23;
		case 'none':
			return currentMa;
	}
}
