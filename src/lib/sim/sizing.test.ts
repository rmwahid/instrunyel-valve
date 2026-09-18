/**
 * Tests for the IEC 60534 sizing equations.
 *
 * The anchors in this file are the published values a sizing engineer would
 * check a calculation against, so a regression shows up as a wrong number rather
 * than as a broken test.
 */

import { describe, expect, test } from 'bun:test';
import { computeFlow, computeRequiredKv, roundUpToStandardKv } from './sizing';
import { createGas, saturatedSteam, water } from './fluids';
import { celsiusToKelvin, cvToKv, kvToCv, psiToBar } from './units';

const T20C = celsiusToKelvin(20);

describe('flow coefficient conversion', () => {
	test('Cv to Kv round trips', () => {
		expect(cvToKv(kvToCv(10))).toBeCloseTo(10, 9);
	});

	test('one Kv is 1.156 Cv', () => {
		expect(kvToCv(1)).toBeCloseTo(1.156, 3);
	});

	test('Cv 10 is Kv 8.65, the value used on most US datasheets', () => {
		expect(cvToKv(10)).toBeCloseTo(8.6505, 3);
	});
});

describe('liquid sizing', () => {
	test('Kv definition holds: 1 Kv passes 1 m3/h of water at 1 bar', () => {
		const result = computeFlow({
			fluid: water,
			kv: 1,
			upstreamPressureBar: 2,
			downstreamPressureBar: 1,
			temperatureK: T20C
		});

		// The definition says 1 m3/h, and the calculation reproduces it to within
		// the specific gravity of water at 20 C against the 1000 kg/m3 reference.
		expect(result.volumetricFlowM3PerHour).toBeCloseTo(1, 2);
		expect(result.volumetricFlowM3PerHour).toBeCloseTo(Math.sqrt(1000 / 998.2), 6);

		// The mass flow follows from the same density, so the two are consistent.
		expect(result.massFlowKgPerHour).toBeCloseTo(result.volumetricFlowM3PerHour * 998.2, 6);
	});

	test('the sizing equation matches its own definition of specific gravity', () => {
		// Checking Q = Kv * sqrt(dP / SG) directly, which is the invariant every
		// other liquid result depends on.
		const density = water.density(2, T20C);
		const result = computeFlow({
			fluid: water,
			kv: 7,
			upstreamPressureBar: 2,
			downstreamPressureBar: 1,
			temperatureK: T20C
		});
		const expected = 7 * Math.sqrt(1 / (density / 1000));
		expect(result.volumetricFlowM3PerHour).toBeCloseTo(expected, 9);
	});

	test('flow scales with the square root of pressure drop', () => {
		const low = computeFlow({
			fluid: water,
			kv: 10,
			upstreamPressureBar: 2,
			downstreamPressureBar: 1,
			temperatureK: T20C
		});
		const high = computeFlow({
			fluid: water,
			kv: 10,
			upstreamPressureBar: 5,
			downstreamPressureBar: 1,
			temperatureK: T20C
		});
		// Four times the pressure drop should give twice the flow.
		expect(high.volumetricFlowM3PerHour / low.volumetricFlowM3PerHour).toBeCloseTo(2, 3);
	});

	test('flow scales linearly with the flow coefficient', () => {
		const small = computeFlow({
			fluid: water,
			kv: 10,
			upstreamPressureBar: 3,
			downstreamPressureBar: 2,
			temperatureK: T20C
		});
		const large = computeFlow({
			fluid: water,
			kv: 20,
			upstreamPressureBar: 3,
			downstreamPressureBar: 2,
			temperatureK: T20C
		});
		expect(large.volumetricFlowM3PerHour).toBeCloseTo(small.volumetricFlowM3PerHour * 2, 6);
	});

	test('a shut valve passes nothing', () => {
		const result = computeFlow({
			fluid: water,
			kv: 0,
			upstreamPressureBar: 5,
			downstreamPressureBar: 1,
			temperatureK: T20C
		});
		expect(result.massFlowKgPerHour).toBe(0);
		expect(result.choked).toBe(false);
	});

	test('no pressure drop means no flow even with the valve open', () => {
		const result = computeFlow({
			fluid: water,
			kv: 40,
			upstreamPressureBar: 3,
			downstreamPressureBar: 3,
			temperatureK: T20C
		});
		expect(result.massFlowKgPerHour).toBe(0);
	});

	test('flow chokes when the pressure drop exceeds the recovery limit', () => {
		// A low recovery valve cannot pass more than FL^2 times the upstream
		// pressure minus the vapour pressure term, whatever the downstream does.
		const moderate = computeFlow({
			fluid: water,
			kv: 10,
			upstreamPressureBar: 5,
			downstreamPressureBar: 4,
			temperatureK: T20C,
			pressureRecoveryFactor: 0.9
		});
		const extreme = computeFlow({
			fluid: water,
			kv: 10,
			upstreamPressureBar: 5,
			downstreamPressureBar: 0.5,
			temperatureK: T20C,
			pressureRecoveryFactor: 0.9
		});

		expect(moderate.choked).toBe(false);
		expect(extreme.choked).toBe(true);
		expect(extreme.effectivePressureDropBar).toBeLessThan(extreme.availablePressureDropBar);
		// The choked flow is the ceiling: more downstream pressure drop adds nothing.
		const extremeAtZero = computeFlow({
			fluid: water,
			kv: 10,
			upstreamPressureBar: 5,
			downstreamPressureBar: 0.1,
			temperatureK: T20C,
			pressureRecoveryFactor: 0.9
		});
		expect(extremeAtZero.volumetricFlowM3PerHour).toBeCloseTo(
			extreme.volumetricFlowM3PerHour,
			6
		);
	});

	test('flashing is reported when the outlet is below vapour pressure', () => {
		// Water at 150 C has a vapour pressure near 4.76 bar absolute, so an outlet
		// at 1 bar absolute is far below it and the liquid flashes.
		const result = computeFlow({
			fluid: water,
			kv: 10,
			upstreamPressureBar: 10,
			downstreamPressureBar: 1,
			temperatureK: celsiusToKelvin(150)
		});
		expect(result.cavitation).toBe('flashing');
	});

	test('cold water below its vapour pressure does not flash', () => {
		const result = computeFlow({
			fluid: water,
			kv: 10,
			upstreamPressureBar: 3,
			downstreamPressureBar: 2,
			temperatureK: T20C
		});
		expect(result.cavitation).toBe('none');
	});

	test('the cavitation index follows its definition', () => {
		const result = computeFlow({
			fluid: water,
			kv: 10,
			upstreamPressureBar: 4,
			downstreamPressureBar: 3,
			temperatureK: T20C
		});
		// sigma = (P1 - Pv) / (P1 - P2) = (4 - 0.0234) / 1
		expect(result.sigmaIndex).toBeCloseTo(3.977, 2);
	});
});

describe('gas and steam sizing', () => {
	test('gas flow chokes at the terminal pressure drop ratio', () => {
		const air = createGas({ species: 'air' });
		const partial = computeFlow({
			fluid: air,
			kv: 10,
			upstreamPressureBar: 5,
			downstreamPressureBar: 4,
			temperatureK: celsiusToKelvin(20),
			terminalPressureDropRatio: 0.72
		});
		const choked = computeFlow({
			fluid: air,
			kv: 10,
			upstreamPressureBar: 5,
			downstreamPressureBar: 0.5,
			temperatureK: celsiusToKelvin(20),
			terminalPressureDropRatio: 0.72
		});

		expect(partial.choked).toBe(false);
		expect(choked.choked).toBe(true);
		expect(choked.pressureDropRatio).toBeCloseTo(0.72, 6);
	});

	test('a lower terminal ratio chokes earlier, giving less capacity', () => {
		const air = createGas({ species: 'air' });
		const globe = computeFlow({
			fluid: air,
			kv: 10,
			upstreamPressureBar: 5,
			downstreamPressureBar: 1,
			temperatureK: celsiusToKelvin(20),
			terminalPressureDropRatio: 0.72
		});
		const ball = computeFlow({
			fluid: air,
			kv: 10,
			upstreamPressureBar: 5,
			downstreamPressureBar: 1,
			temperatureK: celsiusToKelvin(20),
			terminalPressureDropRatio: 0.25
		});
		expect(ball.massFlowKgPerHour).toBeLessThan(globe.massFlowKgPerHour);
	});

	test('the expansion factor never falls below two thirds', () => {
		const air = createGas({ species: 'air' });
		const result = computeFlow({
			fluid: air,
			kv: 10,
			upstreamPressureBar: 10,
			downstreamPressureBar: 1,
			temperatureK: celsiusToKelvin(20),
			terminalPressureDropRatio: 0.72
		});
		expect(result.expansionFactor).toBeGreaterThanOrEqual(2 / 3);
		expect(result.expansionFactor).toBeLessThan(1);
	});

	test('steam capacity is lower than air for the same Kv because it is lighter', () => {
		const air = createGas({ species: 'air' });
		const airResult = computeFlow({
			fluid: air,
			kv: 10,
			upstreamPressureBar: 6,
			downstreamPressureBar: 3,
			temperatureK: celsiusToKelvin(25)
		});
		// Saturated steam at 160 C is at 6.18 bar, close to the upstream pressure.
		const steamResult = computeFlow({
			fluid: saturatedSteam,
			kv: 10,
			upstreamPressureBar: 6.5,
			downstreamPressureBar: 3,
			temperatureK: celsiusToKelvin(160)
		});
		// Steam at 160 C is about 3.26 kg/m3 against air at roughly 7 kg/m3, so the
		// mass flow is lower but the volumetric flow is higher.
		expect(steamResult.massFlowKgPerHour).toBeLessThan(airResult.massFlowKgPerHour);
		expect(steamResult.volumetricFlowM3PerHour).toBeGreaterThan(
			airResult.volumetricFlowM3PerHour
		);
	});
});

describe('reverse sizing', () => {
	test('required Kv reproduces the forward flow coefficient', () => {
		const targetFlow = 25; // m3/h
		const density = water.density(4, T20C);
		const massFlowKgPerHour = targetFlow * density;

		const required = computeRequiredKv({
			fluid: water,
			massFlowKgPerHour,
			upstreamPressureBar: 4,
			downstreamPressureBar: 3,
			temperatureK: T20C
		});

		// Feeding that Kv back through the forward equation must give the flow back.
		const forward = computeFlow({
			fluid: water,
			kv: required.requiredKv,
			upstreamPressureBar: 4,
			downstreamPressureBar: 3,
			temperatureK: T20C
		});
		expect(forward.volumetricFlowM3PerHour).toBeCloseTo(targetFlow, 6);
	});

	test('rounding up to the standard series never undersizes', () => {
		expect(roundUpToStandardKv(0.05)).toBe(0.1);
		expect(roundUpToStandardKv(1.0)).toBe(1.0);
		expect(roundUpToStandardKv(1.01)).toBe(1.6);
		expect(roundUpToStandardKv(39)).toBe(40);
		expect(roundUpToStandardKv(41)).toBe(63);
	});

	test('sizing a valve for a pressure drop of one psi reproduces the Cv definition', () => {
		// Cv is defined in US gallons per minute of water at 60 F at 1 psi. This
		// test converts the definition into the project units and checks that the
		// two definitions of the flow coefficient agree, which is the strongest
		// check available on the constant.
		const pressureDropBar = psiToBar(1);
		const gallonsPerMinute = 1;
		const litresPerMinute = gallonsPerMinute * 3.785411784;
		const m3PerHour = (litresPerMinute * 60) / 1000;

		// Water at 60 F is 15.6 C, density 999.0 kg/m3.
		const temperatureK = celsiusToKelvin(15.6);
		const density = water.density(2, temperatureK);

		const result = computeFlow({
			fluid: water,
			kv: cvToKv(1),
			upstreamPressureBar: 2,
			downstreamPressureBar: 2 - pressureDropBar,
			temperatureK
		});

		// The specific gravity correction accounts for the small density
		// difference from the 1000 kg/m3 reference the definition assumes.
		const expected = m3PerHour * Math.sqrt(1000 / density);
		expect(result.volumetricFlowM3PerHour).toBeCloseTo(expected, 4);
	});
});
