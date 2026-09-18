/**
 * Valve sizing following the structure of IEC 60534-2-1.
 *
 * The flow coefficient Kv is defined as the volumetric flow of water in m3/h at
 * 15 C that passes through a wide open valve at a pressure drop of 1 bar. From
 * that definition the liquid equation follows directly:
 *
 *     Q = Kv * sqrt(dP / SG)          SG = rho / 1000
 *
 * Turning it into a mass flow and substituting for Q gives the general orifice
 * form used for every phase in this module:
 *
 *     W = sqrt(1000) * Kv * sqrt(rho1 * dP)
 *
 * That leading sqrt(1000) is the constant IEC 60534-2-1 tabulates as N6. It is
 * derived here instead of hard coded so the origin stays visible, and it agrees
 * with the US customary constant: converting N6 = 63.3 (lb/h, psia, lb/ft3 with
 * Cv) into kg/h, bar, kg/m3 with Kv lands on 31.6, the same value.
 *
 * Gases add the expansion factor Y and stop gaining flow once the pressure drop
 * ratio reaches the valve's terminal value xT, which is choked flow. Liquids stop
 * gaining flow once the vena contracta pressure falls to the vapour pressure,
 * which is cavitation or, if the pressure never recovers, flashing.
 */

import type { Fluid } from './fluids';
import { CV_PER_KV, MM_PER_INCH, SECONDS_PER_HOUR, diameterMmToAreaM2 } from './units';

export { CV_PER_KV };

/** sqrt(1000): the constant that bridges the Kv definition to an orifice equation. */
export const SIZING_CONSTANT = Math.sqrt(1000);

/**
 * Vapour pressure ratio factor from IEC 60534-2-1. Used to find the pressure at
 * the vena contracta where cavitation begins.
 */
export function liquidCriticalPressureRatio(
	vaporPressureBar: number,
	criticalPressureBar: number
): number {
	if (criticalPressureBar <= 0) return 1;
	const ratio = Math.min(1, Math.max(0, vaporPressureBar / criticalPressureBar));
	return 0.96 - 0.28 * Math.sqrt(ratio);
}

export type CavitationState =
	/** Single phase liquid throughout the valve. */
	| 'none'
	/** Vapour bubbles form and collapse; noise, erosion and reduced capacity. */
	| 'cavitation'
	/** Outlet pressure is at or below vapour pressure; bubbles never collapse. */
	| 'flashing';

export interface FlowInput {
	fluid: Fluid;
	/** Effective flow coefficient of the valve at its current opening, in Kv. */
	kv: number;
	/** Upstream absolute pressure, bar. */
	upstreamPressureBar: number;
	/** Downstream absolute pressure, bar. */
	downstreamPressureBar: number;
	/** Flowing temperature, K. */
	temperatureK: number;
	/**
	 * Liquid pressure recovery factor FL. Sets where liquid flow chokes.
	 * Typical values: 0.9 single seat globe, 0.8 double seat, 0.7 butterfly.
	 */
	pressureRecoveryFactor?: number;
	/**
	 * Terminal pressure drop ratio xT. Sets where gas flow chokes.
	 * Typical values: 0.72 globe, 0.35 butterfly, 0.15 ball.
	 */
	terminalPressureDropRatio?: number;
	/** Specific heat ratio of the gas, used for the F-gamma correction. */
	specificHeatRatio?: number;
	/**
	 * Piping geometry factor Fp, IEC 60534-2-3. Values below 1 account for
	 * reducers and fittings. Defaults to 1 (valve same size as the pipe).
	 */
	pipingGeometryFactor?: number;
	/** Sigma value at which cavitation becomes audible, valve specific. */
	incipientCavitationSigma?: number;
}

export interface FlowResult {
	/** Volumetric flow at upstream conditions, m3/h. */
	volumetricFlowM3PerHour: number;
	/** Mass flow, kg/h. */
	massFlowKgPerHour: number;
	/** Mass flow in the integrator unit, kg/s. */
	massFlowKgPerSecond: number;
	/** Pressure drop the equation actually used, bar. */
	effectivePressureDropBar: number;
	/** Pressure drop between the given upstream and downstream pressures, bar. */
	availablePressureDropBar: number;
	/** True when the flow is limited by choking rather than by downstream pressure. */
	choked: boolean;
	/** Expansion factor Y. One for liquids. */
	expansionFactor: number;
	/** Pressure drop ratio x = dP / P1 actually used. Zero for liquids. */
	pressureDropRatio: number;
	/** Cavitation index sigma = (P1 - Pv) / (P1 - P2). Null for gases. */
	sigmaIndex: number | null;
	cavitation: CavitationState;
	/** Velocity through the valve body bore, m/s, for noise and erosion discussion. */
	bodyVelocityMPerSecond: number;
}

const DEFAULTS = {
	pressureRecoveryFactor: 0.9,
	terminalPressureDropRatio: 0.72,
	specificHeatRatio: 1.4,
	pipingGeometryFactor: 1,
	incipientCavitationSigma: 2.0
} as const;

/** Valve body bore used for the velocity indicator, derived from Kv. */
function estimateBoreDiameterMm(kv: number): number {
	// A wide open valve at 1 bar drop passes Kv m3/h of water. Rearranging the
	// orifice equation for an area at a reasonable body velocity gives a bore
	// estimate that scales with the square root of capacity.
	const referenceVelocity = 3;
	const areaM2 = kv / SECONDS_PER_HOUR / referenceVelocity;
	const diameterM = Math.sqrt((4 * areaM2) / Math.PI);
	return diameterM * 1000;
}

/**
 * Compute the flow through a valve for the given pressures and opening.
 *
 * This is the single entry point used by every valve model. It decides between
 * the liquid and compressible branches, applies the appropriate choke limit and
 * reports why the flow stopped increasing.
 */
export function computeFlow(input: FlowInput): FlowResult {
	const {
		fluid,
		kv,
		upstreamPressureBar: p1,
		downstreamPressureBar: p2,
		temperatureK
	} = input;

	const pressureRecoveryFactor = input.pressureRecoveryFactor ?? DEFAULTS.pressureRecoveryFactor;
	const terminalPressureDropRatio =
		input.terminalPressureDropRatio ?? DEFAULTS.terminalPressureDropRatio;
	const specificHeatRatio = input.specificHeatRatio ?? DEFAULTS.specificHeatRatio;
	const pipingGeometryFactor = input.pipingGeometryFactor ?? DEFAULTS.pipingGeometryFactor;
	const incipientCavitationSigma =
		input.incipientCavitationSigma ?? DEFAULTS.incipientCavitationSigma;

	// A valve with no capacity, or with no pressure difference to work against,
	// passes nothing.
	const availablePressureDropBar = Math.max(0, p1 - p2);
	const effectiveKv = Math.max(0, kv) * pipingGeometryFactor;
	const density = fluid.density(p1, temperatureK);
	const boreDiameterMm = estimateBoreDiameterMm(effectiveKv);
	const boreAreaM2 = diameterMmToAreaM2(boreDiameterMm);

	const empty: FlowResult = {
		volumetricFlowM3PerHour: 0,
		massFlowKgPerHour: 0,
		massFlowKgPerSecond: 0,
		effectivePressureDropBar: 0,
		availablePressureDropBar,
		choked: false,
		expansionFactor: 1,
		pressureDropRatio: 0,
		sigmaIndex: null,
		cavitation: 'none',
		bodyVelocityMPerSecond: 0
	};

	if (effectiveKv <= 0 || availablePressureDropBar <= 0 || density <= 0) {
		return empty;
	}

	if (fluid.phase === 'liquid') {
		return computeLiquidFlow({
			fluid,
			effectiveKv,
			p1,
			p2,
			temperatureK,
			availablePressureDropBar,
			density,
			pressureRecoveryFactor,
			incipientCavitationSigma,
			boreAreaM2
		});
	}

	return computeCompressibleFlow({
		fluid,
		effectiveKv,
		p1,
		availablePressureDropBar,
		temperatureK,
		density,
		terminalPressureDropRatio,
		specificHeatRatio,
		boreAreaM2
	});
}

interface LiquidInput {
	fluid: Fluid;
	effectiveKv: number;
	p1: number;
	p2: number;
	temperatureK: number;
	availablePressureDropBar: number;
	density: number;
	pressureRecoveryFactor: number;
	incipientCavitationSigma: number;
	boreAreaM2: number;
}

function computeLiquidFlow(input: LiquidInput): FlowResult {
	const {
		fluid,
		effectiveKv,
		p1,
		p2,
		temperatureK,
		availablePressureDropBar,
		density,
		pressureRecoveryFactor,
		incipientCavitationSigma,
		boreAreaM2
	} = input;

	const vaporPressureBar = fluid.vaporPressure(temperatureK);
	const criticalPressureBar = fluid.criticalPressureBar();
	const criticalPressureRatio = liquidCriticalPressureRatio(vaporPressureBar, criticalPressureBar);

	// The vena contracta is the narrowest point of the jet, downstream of the
	// seat. Its pressure is lower than the outlet pressure by the recovery
	// factor, and cavitation starts when it reaches vapour pressure.
	const chokePressureDropBar =
		pressureRecoveryFactor ** 2 * Math.max(0, p1 - criticalPressureRatio * vaporPressureBar);

	const choked = availablePressureDropBar >= chokePressureDropBar && chokePressureDropBar > 0;
	const effectivePressureDropBar = choked ? chokePressureDropBar : availablePressureDropBar;

	const specificGravity = density / 1000;
	const volumetricFlowM3PerHour =
		effectiveKv * Math.sqrt(effectivePressureDropBar / Math.max(specificGravity, 1e-9));
	const massFlowKgPerHour = volumetricFlowM3PerHour * density;
	const massFlowKgPerSecond = massFlowKgPerHour / SECONDS_PER_HOUR;

	const denominator = p1 - Math.min(p2, p1);
	const sigmaIndex = denominator > 0 ? (p1 - vaporPressureBar) / denominator : null;

	let cavitation: CavitationState = 'none';
	if (p2 <= vaporPressureBar) {
		cavitation = 'flashing';
	} else if (choked) {
		cavitation = 'cavitation';
	} else if (sigmaIndex !== null && sigmaIndex < incipientCavitationSigma) {
		cavitation = 'cavitation';
	}

	return {
		volumetricFlowM3PerHour,
		massFlowKgPerHour,
		massFlowKgPerSecond,
		effectivePressureDropBar,
		availablePressureDropBar,
		choked,
		expansionFactor: 1,
		pressureDropRatio: 0,
		sigmaIndex,
		cavitation,
		bodyVelocityMPerSecond: massFlowKgPerSecond / (density * Math.max(boreAreaM2, 1e-9))
	};
}

interface CompressibleInput {
	fluid: Fluid;
	effectiveKv: number;
	p1: number;
	availablePressureDropBar: number;
	temperatureK: number;
	density: number;
	terminalPressureDropRatio: number;
	specificHeatRatio: number;
	boreAreaM2: number;
}

function computeCompressibleFlow(input: CompressibleInput): FlowResult {
	const {
		fluid,
		effectiveKv,
		p1,
		availablePressureDropBar,
		temperatureK,
		density,
		terminalPressureDropRatio,
		specificHeatRatio,
		boreAreaM2
	} = input;

	// F-gamma corrects the terminal ratio for gases whose specific heat ratio
	// differs from that of air, which is what the published xT values assume.
	const specificHeatRatioFactor = specificHeatRatio / 1.4;
	const chokeRatio = specificHeatRatioFactor * terminalPressureDropRatio;

	const requestedRatio = availablePressureDropBar / p1;
	const pressureDropRatio = Math.min(requestedRatio, chokeRatio);
	const choked = requestedRatio >= chokeRatio;

	// The expansion factor falls linearly from 1 as the gas accelerates, and is
	// never allowed below 2/3 because below that the gas is choked anyway.
	const expansionFactor = Math.max(2 / 3, 1 - pressureDropRatio / (3 * chokeRatio));

	const pressureDropBar = pressureDropRatio * p1;
	const massFlowKgPerHour =
		SIZING_CONSTANT * effectiveKv * expansionFactor * Math.sqrt(density * pressureDropBar);
	const massFlowKgPerSecond = massFlowKgPerHour / SECONDS_PER_HOUR;

	// Volumetric flow reported at upstream conditions, which is what a flow
	// meter installed at the valve inlet would see.
	const volumetricFlowM3PerHour = massFlowKgPerHour / density;

	return {
		volumetricFlowM3PerHour,
		massFlowKgPerHour,
		massFlowKgPerSecond,
		effectivePressureDropBar: pressureDropBar,
		availablePressureDropBar,
		choked,
		expansionFactor,
		pressureDropRatio,
		sigmaIndex: null,
		cavitation: 'none',
		bodyVelocityMPerSecond: massFlowKgPerSecond / (density * Math.max(boreAreaM2, 1e-9))
	};
}

export interface RequiredKvInput {
	fluid: Fluid;
	/** Required mass flow, kg/h. */
	massFlowKgPerHour: number;
	upstreamPressureBar: number;
	downstreamPressureBar: number;
	temperatureK: number;
	pressureRecoveryFactor?: number;
	terminalPressureDropRatio?: number;
	specificHeatRatio?: number;
}

export interface RequiredKvResult {
	/** Flow coefficient needed to pass the requested flow, in Kv. */
	requiredKv: number;
	/** The same value expressed as Cv, the unit used on US datasheets. */
	requiredCv: number;
	/** True when the requested flow cannot be reached even at choked conditions. */
	choked: boolean;
	/** Suggested nominal Kv, rounded up to the next standard size. */
	suggestedKv: number;
}

/**
 * Reverse sizing: find the flow coefficient that passes a required flow.
 *
 * This is what a sizing engineer does when selecting a valve, and it is the
 * calculation the lab shows when you ask why a chosen valve is too small.
 */
export function computeRequiredKv(input: RequiredKvInput): RequiredKvResult {
	const {
		fluid,
		massFlowKgPerHour,
		upstreamPressureBar: p1,
		downstreamPressureBar: p2,
		temperatureK
	} = input;

	const pressureRecoveryFactor = input.pressureRecoveryFactor ?? DEFAULTS.pressureRecoveryFactor;
	const terminalPressureDropRatio =
		input.terminalPressureDropRatio ?? DEFAULTS.terminalPressureDropRatio;
	const specificHeatRatio = input.specificHeatRatio ?? DEFAULTS.specificHeatRatio;

	const density = fluid.density(p1, temperatureK);
	if (density <= 0 || massFlowKgPerHour <= 0) {
		return { requiredKv: 0, requiredCv: 0, choked: false, suggestedKv: 0 };
	}

	if (fluid.phase === 'liquid') {
		const vaporPressureBar = fluid.vaporPressure(temperatureK);
		const criticalPressureRatio = liquidCriticalPressureRatio(
			vaporPressureBar,
			fluid.criticalPressureBar()
		);
		const chokePressureDropBar =
			pressureRecoveryFactor ** 2 * Math.max(0, p1 - criticalPressureRatio * vaporPressureBar);
		const availablePressureDropBar = Math.max(0, p1 - p2);
		const choked = availablePressureDropBar > chokePressureDropBar;
		const pressureDropBar = choked ? chokePressureDropBar : availablePressureDropBar;
		if (pressureDropBar <= 0) {
			return { requiredKv: 0, requiredCv: 0, choked: true, suggestedKv: 0 };
		}

		const specificGravity = density / 1000;
		const volumetricFlow = massFlowKgPerHour / density;
		const requiredKv = volumetricFlow / Math.sqrt(pressureDropBar / specificGravity);
		return {
			requiredKv,
			requiredCv: requiredKv * CV_PER_KV,
			choked,
			suggestedKv: roundUpToStandardKv(requiredKv)
		};
	}

	const chokeRatio = (specificHeatRatio / 1.4) * terminalPressureDropRatio;
	const requestedRatio = Math.max(0, p1 - p2) / p1;
	const pressureDropRatio = Math.min(requestedRatio, chokeRatio);
	const choked = requestedRatio > chokeRatio;
	const expansionFactor = Math.max(2 / 3, 1 - pressureDropRatio / (3 * chokeRatio));
	const pressureDropBar = pressureDropRatio * p1;

	const denominator = SIZING_CONSTANT * expansionFactor * Math.sqrt(density * pressureDropBar);
	const requiredKv = denominator > 0 ? massFlowKgPerHour / denominator : 0;

	return {
		requiredKv,
		requiredCv: requiredKv * CV_PER_KV,
		choked,
		suggestedKv: roundUpToStandardKv(requiredKv)
	};
}

/**
 * Standard nominal flow coefficients, the sizes a valve catalogue actually
 * offers. Sizing always rounds up: a valve that is exactly at its maximum is
 * already at the edge of its controllable range.
 */
export const STANDARD_KV_SERIES: readonly number[] = [
	0.1, 0.16, 0.25, 0.4, 0.63, 1.0, 1.6, 2.5, 4.0, 6.3, 10, 16, 25, 40, 63, 100, 160, 250, 400,
	630, 1000
];

export function roundUpToStandardKv(requiredKv: number): number {
	for (const candidate of STANDARD_KV_SERIES) {
		if (candidate >= requiredKv) return candidate;
	}
	return STANDARD_KV_SERIES[STANDARD_KV_SERIES.length - 1];
}

/**
 * Rangeability check used in the lessons: a valve should normally run between
 * roughly 10 percent and 90 percent of its rated capacity so it stays inside the
 * controllable part of its characteristic.
 */
export function travelPercentForFlow(
	ratedKv: number,
	requiredKv: number
): { percent: number; withinRange: boolean } {
	if (ratedKv <= 0) return { percent: 0, withinRange: false };
	const ratio = requiredKv / ratedKv;
	const percent = ratio * 100;
	return { percent, withinRange: percent >= 10 && percent <= 90 };
}

/** Nominal pipe size in inches from a Kv, using a typical full bore Kv per DN. */
export function estimateNominalSizeInch(kv: number): number {
	// A full bore ball valve passes roughly this Kv for each nominal size. The
	// table is the practical shortcut sizing engineers use for a first guess.
	const table: readonly (readonly [number, number])[] = [
		[0.5, 8], [0.75, 18], [1, 32], [1.5, 75], [2, 130], [3, 290], [4, 520],
		[6, 1150], [8, 2000], [10, 3150], [12, 4500]
	];
	for (const [inch, capacity] of table) {
		if (kv <= capacity) return inch;
	}
	return table[table.length - 1][0];
}

export function inchToMillimetre(inch: number): number {
	return inch * MM_PER_INCH;
}
