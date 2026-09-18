/**
 * Unit conversions and physical constants for the simulation core.
 *
 * The core deliberately works in one fixed set of units instead of pure SI:
 *
 *   pressure      bar (absolute unless a name says otherwise)
 *   temperature   K
 *   liquid flow   m3/h
 *   mass flow     kg/h
 *   length        m
 *   area          m2
 *   force         N
 *   density       kg/m3
 *
 * This is the unit set in which the IEC 60534 flow coefficient and the valve
 * sizing equations are defined: Kv is literally "the water flow in m3/h at 15 C
 * through a wide open valve at 1 bar pressure drop". Keeping the core in those
 * units means the sizing math reads the same as the standard, and the UI layer
 * converts to whatever the user prefers for display.
 */

// ---------------------------------------------------------------------------
// Pressure
// ---------------------------------------------------------------------------

export const PA_PER_BAR = 1e5;
export const BAR_PER_PSI = 0.0689475729;
export const PSI_PER_BAR = 1 / BAR_PER_PSI;
export const KPA_PER_BAR = 100;

export function psiToBar(psi: number): number {
	return psi * BAR_PER_PSI;
}

export function barToPsi(bar: number): number {
	return bar * PSI_PER_BAR;
}

/** Convert a gauge pressure to absolute, given the local barometric pressure. */
export function gaugeToAbsolute(gaugeBar: number, atmosphericBar = 1.01325): number {
	return gaugeBar + atmosphericBar;
}

export function absoluteToGauge(absoluteBar: number, atmosphericBar = 1.01325): number {
	return absoluteBar - atmosphericBar;
}

// ---------------------------------------------------------------------------
// Signal chain: pneumatic and electrical transmission
// ---------------------------------------------------------------------------

/**
 * The two pneumatic signal standards. Both are live-zero ranges: a non-zero
 * minimum keeps the loop above the "no signal" condition so a broken line is
 * distinguishable from a legitimate 0 percent output.
 */
export const PNEUMATIC_3_15_PSI = { minBar: psiToBar(3), maxBar: psiToBar(15) } as const;
export const PNEUMATIC_0_2_1_0_BAR = { minBar: 0.2, maxBar: 1.0 } as const;

/** The 4-20 mA current loop standard. */
export const CURRENT_4_20_MA = { minMa: 4, maxMa: 20 } as const;

/**
 * NAMUR NE43 limits. A current outside the valid process range signals a fault,
 * which lets the control system distinguish "valve commanded to 0 percent" from
 * "transmitter or wiring has failed".
 */
export const NAMUR_NE43 = {
	/** Below this the signal is a downscale fault (open loop / dead transmitter). */
	downscaleFaultMa: 3.6,
	/** Above this the signal is an upscale fault (short circuit / overrange). */
	upscaleFaultMa: 21.0,
	/** Range over which a transmitter is allowed to saturate while still valid. */
	lowerSaturationMa: 3.8,
	upperSaturationMa: 20.5
} as const;

/** Convert a 0..1 process value to a 4-20 mA current. */
export function fractionToCurrentMa(fraction: number, minMa = 4, maxMa = 20): number {
	return minMa + fraction * (maxMa - minMa);
}

/** Convert a 4-20 mA current back to a 0..1 process value, unclamped. */
export function currentMaToFraction(mA: number, minMa = 4, maxMa = 20): number {
	return (mA - minMa) / (maxMa - minMa);
}

/** Convert a 0..1 process value to a pneumatic signal in bar. */
export function fractionToPneumaticBar(
	fraction: number,
	range: { minBar: number; maxBar: number } = PNEUMATIC_0_2_1_0_BAR
): number {
	return range.minBar + fraction * (range.maxBar - range.minBar);
}

/** Convert a pneumatic signal in bar back to a 0..1 process value. */
export function pneumaticBarToFraction(
	bar: number,
	range: { minBar: number; maxBar: number } = PNEUMATIC_0_2_1_0_BAR
): number {
	return (bar - range.minBar) / (range.maxBar - range.minBar);
}

// ---------------------------------------------------------------------------
// Temperature
// ---------------------------------------------------------------------------

export const CELSIUS_OFFSET = 273.15;

export function celsiusToKelvin(celsius: number): number {
	return celsius + CELSIUS_OFFSET;
}

export function kelvinToCelsius(kelvin: number): number {
	return kelvin - CELSIUS_OFFSET;
}

export function celsiusToFahrenheit(celsius: number): number {
	return celsius * 1.8 + 32;
}

export function fahrenheitToCelsius(fahrenheit: number): number {
	return (fahrenheit - 32) / 1.8;
}

// ---------------------------------------------------------------------------
// Flow and geometry
// ---------------------------------------------------------------------------

export const LITERS_PER_M3 = 1000;
export const SECONDS_PER_HOUR = 3600;

/** Convert a volumetric liquid flow in m3/h to a mass flow in kg/h. */
export function volumeFlowToMassFlow(m3PerHour: number, densityKgPerM3: number): number {
	return m3PerHour * densityKgPerM3;
}

/** Convert a mass flow in kg/h to a volumetric flow in m3/h. */
export function massFlowToVolumeFlow(kgPerHour: number, densityKgPerM3: number): number {
	return kgPerHour / densityKgPerM3;
}

/** Convert kg/h to kg/s, the unit used inside the integrator. */
export function kgPerHourToKgPerSecond(kgPerHour: number): number {
	return kgPerHour / SECONDS_PER_HOUR;
}

export function kgPerSecondToKgPerHour(kgPerSecond: number): number {
	return kgPerSecond * SECONDS_PER_HOUR;
}

/** Circular area in m2 from a diameter in millimetres. */
export function diameterMmToAreaM2(diameterMm: number): number {
	const radiusM = diameterMm / 2000;
	return Math.PI * radiusM * radiusM;
}

export const MM_PER_INCH = 25.4;

export function inchToMm(inch: number): number {
	return inch * MM_PER_INCH;
}

export function mmToInch(mm: number): number {
	return mm / MM_PER_INCH;
}

/**
 * Convert a nominal pipe size in inches to its metric designation, the way a
 * piping drawing would label it (for example 2 inch -> DN50).
 */
export function inchToDn(inch: number): number {
	return Math.round(inch * 25);
}

// ---------------------------------------------------------------------------
// Flow coefficients
// ---------------------------------------------------------------------------

/**
 * The ratio between the American and European flow coefficients.
 *
 * Cv is defined as "US gallons of water per minute at 60 F through a wide open
 * valve at 1 psi pressure drop", Kv as "cubic metres of water per hour at 15 C
 * at 1 bar". Converting the definitions against each other gives 1.156.
 */
export const CV_PER_KV = 1.156;

export function kvToCv(kv: number): number {
	return kv * CV_PER_KV;
}

export function cvToKv(cv: number): number {
	return cv / CV_PER_KV;
}

/** Convert a Kv in m3/h to the metric resistance coefficient used in sizing. */
export function kvToFlowResistance(kv: number): number {
	return kv;
}

/**
 * Universal gas constant, J/(mol K). Used for ideal gas density.
 */
export const R_UNIVERSAL = 8.314462618;

/** Normal (standard) conditions used for gas flow reporting in this project. */
export const NORMAL_CONDITIONS = {
	temperatureK: 273.15,
	pressureBar: 1.01325
} as const;

/** Molar masses in kg/mol for the gases available in the lab. */
export const MOLAR_MASS = {
	air: 0.0289645,
	nitrogen: 0.0280134,
	oxygen: 0.0319988,
	methane: 0.0160425,
	carbonDioxide: 0.0440095,
	hydrogen: 0.0020159,
	steam: 0.0180153
} as const;

export type GasSpecies = keyof typeof MOLAR_MASS;
