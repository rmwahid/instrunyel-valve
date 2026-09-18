/**
 * Fluid properties used by the sizing equations.
 *
 * Water and saturated steam are tabulated from standard steam tables and
 * interpolated linearly, because a fitted polynomial for vapour pressure would
 * be wrong exactly where it matters most: near the boiling point, which is where
 * cavitation and flashing start. Gases use the ideal gas law with the
 * compressibility factor exposed so a real-gas correction can be added later.
 */

import { MOLAR_MASS, R_UNIVERSAL, celsiusToKelvin, type GasSpecies } from './units';

export type FluidPhase = 'liquid' | 'gas' | 'steam';

export interface Fluid {
	readonly id: string;
	readonly name: string;
	readonly phase: FluidPhase;
	/** Density in kg/m3 at the given absolute pressure in bar and temperature in K. */
	density(pressureBar: number, temperatureK: number): number;
	/** Vapour pressure in bar absolute at the given temperature in K. */
	vaporPressure(temperatureK: number): number;
	/** Thermodynamic critical pressure in bar absolute. */
	criticalPressureBar(): number;
	/**
	 * Molar mass in kg/mol, for a gas or vapour.
	 *
	 * Exposed because the relief valve capacity equation works in molar terms and
	 * must use the same fluid properties as the rest of the simulation rather than
	 * assuming air. Undefined for a liquid, whose relief capacity is computed from
	 * the incompressible orifice equation instead.
	 */
	readonly molarMassKgPerMol?: number;
	/**
	 * Ratio of specific heats, for a gas or vapour. Undefined for a liquid.
	 */
	readonly specificHeatRatio?: number;
}

/**
 * Linear interpolation over a table sorted by ascending temperature.
 * Values outside the table clamp to the nearest end point.
 */
export function interpolateTable(
	table: readonly (readonly [number, number])[],
	temperatureK: number
): number {
	const first = table[0];
	const last = table[table.length - 1];
	if (temperatureK <= first[0]) return first[1];
	if (temperatureK >= last[0]) return last[1];

	for (let i = 1; i < table.length; i++) {
		const upper = table[i];
		if (temperatureK <= upper[0]) {
			const lower = table[i - 1];
			const span = upper[0] - lower[0];
			const ratio = span === 0 ? 0 : (temperatureK - lower[0]) / span;
			return lower[1] + ratio * (upper[1] - lower[1]);
		}
	}
	return last[1];
}

/**
 * Saturated liquid water. Temperature entries are in K, density in kg/m3 and
 * vapour pressure in bar absolute.
 *
 * Critical point: 647.096 K, 220.64 bar.
 */
const WATER_TABLE: readonly (readonly [number, number, number])[] = [
	[celsiusToKelvin(0), 999.8, 0.00611],
	[celsiusToKelvin(10), 999.7, 0.01228],
	[celsiusToKelvin(20), 998.2, 0.02339],
	[celsiusToKelvin(30), 995.6, 0.04246],
	[celsiusToKelvin(40), 992.2, 0.07384],
	[celsiusToKelvin(50), 988.0, 0.12352],
	[celsiusToKelvin(60), 983.2, 0.19946],
	[celsiusToKelvin(70), 977.8, 0.31188],
	[celsiusToKelvin(80), 971.8, 0.47390],
	[celsiusToKelvin(90), 965.3, 0.70130],
	[celsiusToKelvin(100), 958.4, 1.01418],
	[celsiusToKelvin(110), 951.0, 1.43300],
	[celsiusToKelvin(120), 943.1, 1.98670],
	[celsiusToKelvin(130), 934.8, 2.70130],
	[celsiusToKelvin(140), 926.1, 3.61660],
	[celsiusToKelvin(150), 917.0, 4.76160],
	[celsiusToKelvin(160), 907.4, 6.18050],
	[celsiusToKelvin(170), 897.3, 7.91940],
	[celsiusToKelvin(180), 886.9, 10.0270],
	[celsiusToKelvin(190), 876.1, 12.5510],
	[celsiusToKelvin(200), 864.7, 15.5490]
];

const WATER_TEMPERATURE_DENSITY = WATER_TABLE.map((row) => [row[0], row[1]] as const);
const WATER_TEMPERATURE_VAPOR_PRESSURE = WATER_TABLE.map((row) => [row[0], row[2]] as const);

export const WATER_CRITICAL_PRESSURE_BAR = 220.64;

/**
 * Water. Liquid water is close to incompressible over the pressure range of a
 * process plant, so density depends on temperature only.
 */
export const water: Fluid = {
	id: 'water',
	name: 'Water',
	phase: 'liquid',
	density(_pressureBar: number, temperatureK: number): number {
		return interpolateTable(WATER_TEMPERATURE_DENSITY, temperatureK);
	},
	vaporPressure(temperatureK: number): number {
		return interpolateTable(WATER_TEMPERATURE_VAPOR_PRESSURE, temperatureK);
	},
	criticalPressureBar(): number {
		return WATER_CRITICAL_PRESSURE_BAR;
	}
};

/**
 * Saturated steam. Tabulates the vapour line: pressure and vapour density for a
 * given saturation temperature.
 */
const STEAM_TABLE: readonly (readonly [number, number, number])[] = [
	[celsiusToKelvin(100), 1.013, 0.5977],
	[celsiusToKelvin(110), 1.433, 0.8267],
	[celsiusToKelvin(120), 1.985, 1.1215],
	[celsiusToKelvin(130), 2.701, 1.4963],
	[celsiusToKelvin(140), 3.613, 1.9666],
	[celsiusToKelvin(150), 4.758, 2.5477],
	[celsiusToKelvin(160), 6.180, 3.2581],
	[celsiusToKelvin(170), 7.916, 4.1229],
	[celsiusToKelvin(180), 10.027, 5.1570],
	[celsiusToKelvin(190), 12.551, 6.3902],
	[celsiusToKelvin(200), 15.549, 7.8618]
];

const STEAM_TEMPERATURE_DENSITY = STEAM_TABLE.map((row) => [row[0], row[2]] as const);
const STEAM_TEMPERATURE_PRESSURE = STEAM_TABLE.map((row) => [row[0], row[1]] as const);

export const saturatedSteam: Fluid = {
	id: 'saturated-steam',
	name: 'Saturated steam',
	phase: 'steam',
	molarMassKgPerMol: MOLAR_MASS.steam,
	// Superheated steam is about 1.3; saturated steam is close to 1.135 because
	// some of the enthalpy goes into evaporation rather than into raising the
	// temperature. The higher figure is used here because the relief capacity
	// equation is written for a gas whose specific heats are constant, and the
	// conservative choice for capacity is the one that gives less flow.
	specificHeatRatio: 1.3,
	density(_pressureBar: number, temperatureK: number): number {
		return interpolateTable(STEAM_TEMPERATURE_DENSITY, temperatureK);
	},
	vaporPressure(temperatureK: number): number {
		// Saturated steam is at its saturation pressure by definition, so the
		// vapour pressure equals the pressure that pairs with the temperature.
		return interpolateTable(STEAM_TEMPERATURE_PRESSURE, temperatureK);
	},
	criticalPressureBar(): number {
		return WATER_CRITICAL_PRESSURE_BAR;
	}
};

export interface GasOptions {
	species: GasSpecies;
	/** Compressibility factor. 1 is the ideal gas assumption. */
	z?: number;
}

/**
 * Gas or vapour described by the ideal gas law.
 *
 * The compressibility factor Z is a single multiplier rather than a full
 * equation of state. For the pressures used in these lessons (a few bar) the
 * ideal gas assumption is within a few percent, and the valve sizing equations
 * only need the upstream density, so a heavier model would add complexity
 * without changing the lesson.
 */
export function createGas({ species, z = 1 }: GasOptions): Fluid {
	const molarMass = MOLAR_MASS[species];

	/**
	 * Standard density at normal conditions, kg/m3. Reported flows for gases are
	 * usually given at normal conditions so they do not depend on the line pressure.
	 */
	const normalDensity = (101325 * molarMass) / (R_UNIVERSAL * 273.15);

	// The specific heat ratio depends on the gas. Values are the standard ones at
	// ambient temperature; a diatomic gas sits near 1.4 and a polyatomic one lower.
	const specificHeatRatio = SPECIFIC_HEAT_RATIOS[species];

	return {
		id: species,
		name: species.charAt(0).toUpperCase() + species.slice(1),
		phase: 'gas',
		molarMassKgPerMol: molarMass,
		specificHeatRatio,
		density(pressureBar: number, temperatureK: number): number {
			const pressurePa = pressureBar * 1e5;
			return pressurePa / (z * (R_UNIVERSAL / molarMass) * temperatureK);
		},
		vaporPressure(): number {
			// A gas above its dew point has no vapour pressure limit relevant to
			// sizing; the ideal gas branch never cavitates.
			return 0;
		},
		criticalPressureBar(): number {
			// Gases use the pressure drop ratio limit xT instead of the liquid
			// critical pressure criterion, so this value is only informational.
			return normalDensity > 0 ? 0 : 0;
		}
	};
}

/**
 * Ratio of specific heats for the available gases, at ambient temperature.
 *
 * These are the values a sizing calculation uses, and they matter twice: once in
 * the compressible flow expansion factor and once in the relief capacity
 * calculation, where the critical pressure ratio depends on this ratio alone.
 */
const SPECIFIC_HEAT_RATIOS: Record<GasSpecies, number> = {
	air: 1.4,
	nitrogen: 1.4,
	oxygen: 1.395,
	methane: 1.31,
	carbonDioxide: 1.289,
	hydrogen: 1.41,
	steam: 1.3
};

/** Catalogue of fluids the lab can simulate. */
export const FLUIDS: readonly Fluid[] = [water, saturatedSteam];

export function findFluid(id: string): Fluid | undefined {
	return FLUIDS.find((fluid) => fluid.id === id);
}
