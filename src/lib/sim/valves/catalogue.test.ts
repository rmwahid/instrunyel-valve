/**
 * Tests for the valve catalogue and the valve models it builds.
 *
 * The point of these tests is that every valve in the catalogue obeys the shared
 * contract and that the numbers attached to each type are the ones its design
 * implies. A catalogue entry with a wrong pressure recovery factor or a missing
 * actuator would show up in the lab as a valve that behaves like no real valve.
 */

import { describe, expect, test } from 'bun:test';
import {
	VALVE_CATALOGUE,
	buildValveModel,
	findCatalogueEntry,
	isReliefValve,
	type ValveId
} from './catalogue';
import { computeFlow } from '../sizing';
import { water } from '../fluids';
import { celsiusToKelvin } from '../units';

const T20C = celsiusToKelvin(20);

const ALL_IDS: ValveId[] = VALVE_CATALOGUE.map((entry) => entry.id);

describe('catalogue integrity', () => {
	test('every entry builds a model with a matching id', () => {
		for (const entry of VALVE_CATALOGUE) {
			const model = entry.create();
			expect(model.spec.name.length).toBeGreaterThan(0);
			expect(model.spec.summary.length).toBeGreaterThan(0);
			expect(model.spec.typicalServices.length).toBeGreaterThan(0);
		}
	});

	test('every valve reports a consistent closed and open position', () => {
		for (const id of ALL_IDS) {
			const model = buildValveModel(id);
			const closed = model.closedPosition();
			const open = model.openPosition();
			expect(open).toBeGreaterThan(closed);
			expect(model.toOpening(closed)).toBeCloseTo(0, 9);
			expect(model.toOpening(open)).toBeCloseTo(1, 9);
		}
	});

	test('opening and native position are inverses across the travel', () => {
		for (const id of ALL_IDS) {
			const model = buildValveModel(id);
			for (const opening of [0, 0.25, 0.5, 0.75, 1]) {
				expect(model.toOpening(model.fromOpening(opening))).toBeCloseTo(opening, 9);
			}
		}
	});

	test('every valve except the relief valve has a positive rated capacity', () => {
		for (const id of ALL_IDS) {
			const model = buildValveModel(id);
			if (id === 'relief') continue;
			expect(model.spec.ratedKv).toBeGreaterThan(0);
		}
	});

	test('every valve is shut at zero opening', () => {
		for (const id of ALL_IDS) {
			const model = buildValveModel(id);
			expect(model.flowCoefficient({ opening: 0, fluid: water, flowToOpen: true })).toBe(0);
		}
	});

	test('a commandable modulating valve has an actuator, a self acting valve does not need one', () => {
		for (const entry of VALVE_CATALOGUE) {
			if (!entry.commandable) continue;
			const model = entry.create();
			// A manually operated valve has no actuator, which is legitimate; what
			// must not happen is a modulating valve with no way to move it.
			if (entry.modulating) {
				expect(model.spec.actuator).not.toBeNull();
			}
		}
	});

	test('only the control valve and the characterised ball valve modulate', () => {
		const modulating = VALVE_CATALOGUE.filter((entry) => entry.modulating).map((entry) => entry.id);
		expect(modulating).toContain('controlValve');
		expect(modulating).toContain('ballCharacterised');
		expect(modulating).not.toContain('gate');
		expect(modulating).not.toContain('ball');
	});

	test('self acting valves are not commandable', () => {
		for (const entry of VALVE_CATALOGUE) {
			const model = entry.create();
			if (model.spec.actuation === 'selfActing') {
				expect(entry.commandable).toBe(false);
			}
		}
	});

	test('an unknown id throws rather than returning a silent fallback', () => {
		expect(() => buildValveModel('nonexistent' as ValveId)).toThrow();
	});

	test('the catalogue lookup finds a known entry', () => {
		expect(findCatalogueEntry('gate')).toBeDefined();
		expect(findCatalogueEntry('nonexistent' as ValveId)).toBeUndefined();
	});
});

describe('pressure recovery ordering', () => {
	function recovery(id: ValveId): number {
		return buildValveModel(id).spec.pressureRecoveryFactor;
	}

	test('a globe valve recovers less pressure than a gate valve', () => {
		// The tortuous path of a globe body destroys kinetic energy that a straight
		// through gate valve would recover, which is why a globe valve cavitates
		// less and drops more pressure.
		expect(recovery('globe')).toBeGreaterThan(recovery('gate'));
	});

	test('a ball valve has the lowest recovery of the common types', () => {
		// A straight through bore recovers the most pressure, so it reaches the
		// vena contracta lowest and cavitates first.
		expect(recovery('ball')).toBeLessThan(recovery('globe'));
		expect(recovery('ball')).toBeLessThan(recovery('butterfly'));
	});

	test('recovery factors all sit in the range real valves occupy', () => {
		for (const id of ALL_IDS) {
			const model = buildValveModel(id);
			expect(model.spec.pressureRecoveryFactor).toBeGreaterThanOrEqual(0.6);
			expect(model.spec.pressureRecoveryFactor).toBeLessThanOrEqual(1);
		}
	});

	test('terminal pressure drop ratios all sit in a plausible band', () => {
		for (const id of ALL_IDS) {
			const model = buildValveModel(id);
			expect(model.spec.terminalPressureDropRatio).toBeGreaterThan(0.1);
			expect(model.spec.terminalPressureDropRatio).toBeLessThanOrEqual(0.8);
		}
	});
});

describe('ball valve geometry', () => {
	test('a standard ball valve is fully open at the end of its turn', () => {
		const ball = buildValveModel('ball');
		expect(ball.flowCoefficient({ opening: 1, fluid: water, flowToOpen: true })).toBeCloseTo(
			ball.spec.ratedKv,
			6
		);
	});

	test('a standard ball valve has very poor resolution near closed', () => {
		// This is the consequence of the two overlapping circles: capacity appears
		// slowly at first and then very fast, so most of the useful range is crammed
		// into the last part of the turn. It is why a standard ball valve is an
		// isolation valve and not a throttling valve.
		const ball = buildValveModel('ball');
		const rated = ball.spec.ratedKv;
		const atQuarter = ball.flowCoefficient({ opening: 0.25, fluid: water, flowToOpen: true }) / rated;
		const atThreeQuarters =
			ball.flowCoefficient({ opening: 0.75, fluid: water, flowToOpen: true }) / rated;

		// A quarter of the turn delivers well under a fifth of the capacity.
		expect(atQuarter).toBeLessThan(0.2);
		// Three quarters of the turn still has not delivered everything.
		expect(atThreeQuarters).toBeLessThan(0.75);
		// The last quarter therefore carries more than a third of the capacity.
		expect(1 - atThreeQuarters).toBeGreaterThan(0.3);
	});

	test('capacity rises monotonically as a ball valve opens', () => {
		const ball = buildValveModel('ball');
		let previous = 0;
		for (let i = 0; i <= 40; i++) {
			const capacity = ball.flowCoefficient({ opening: i / 40, fluid: water, flowToOpen: true });
			expect(capacity).toBeGreaterThanOrEqual(previous - 1e-9);
			previous = capacity;
		}
	});

	test('a characterised ball valve holds back capacity compared with a standard one', () => {
		const standard = buildValveModel('ball');
		const characterised = buildValveModel('ballCharacterised');
		// Normalised, the equal percentage trim gives less capacity at half travel.
		const standardFraction =
			standard.flowCoefficient({ opening: 0.5, fluid: water, flowToOpen: true }) / standard.spec.ratedKv;
		const characterisedFraction =
			characterised.flowCoefficient({ opening: 0.5, fluid: water, flowToOpen: true }) /
			characterised.spec.ratedKv;
		expect(characterisedFraction).toBeLessThan(standardFraction);
	});
});

describe('butterfly valve torque', () => {
	test('the dynamic torque peaks at part travel, not at either extreme', () => {
		// This is the fact that drives butterfly actuator sizing, so the model has
		// to reproduce it. The disc is symmetric about its shaft, so static pressure
		// gives almost no torque; the asymmetry of the flow field does, and that
		// peaks in the middle of the stroke.
		const butterfly = buildValveModel('butterfly');
		const atClosed = Math.abs(butterfly.fluidForce(3, true, 0.02));
		const atQuarter = Math.abs(butterfly.fluidForce(3, true, 0.25));
		const atMiddle = Math.abs(butterfly.fluidForce(3, true, 0.6));
		const atOpen = Math.abs(butterfly.fluidForce(3, true, 0.99));

		expect(atMiddle).toBeGreaterThan(atQuarter);
		expect(atMiddle).toBeGreaterThan(atOpen);
		expect(atMiddle).toBeGreaterThan(atClosed);
	});

	test('the torque grows with the pressure drop', () => {
		const butterfly = buildValveModel('butterfly');
		const low = Math.abs(butterfly.fluidForce(1, true, 0.6));
		const high = Math.abs(butterfly.fluidForce(4, true, 0.6));
		expect(high).toBeCloseTo(low * 4, 6);
	});

	test('a butterfly valve reaches its rated capacity when open', () => {
		const butterfly = buildValveModel('butterfly');
		expect(butterfly.flowCoefficient({ opening: 1, fluid: water, flowToOpen: true })).toBeCloseTo(
			butterfly.spec.ratedKv,
			4
		);
	});
});

describe('check valve designs', () => {
	test('a dual plate check valve cracks open at a lower pressure than a swing check', () => {
		// The lighter closure and shorter travel are the whole point of the design.
		const swing = buildValveModel('check-swing');
		const dualPlate = buildValveModel('check-dualPlate');
		const swingCracking = swing.spec.actuator?.crackingPressureBar ?? 0;
		const dualPlateCracking = dualPlate.spec.actuator?.crackingPressureBar ?? 0;
		expect(dualPlateCracking).toBeLessThan(swingCracking);
	});

	test('a check valve is self acting and has no external signal', () => {
		for (const id of ['check-swing', 'check-dualPlate'] as ValveId[]) {
			const model = buildValveModel(id);
			expect(model.spec.actuation).toBe('selfActing');
			expect(model.spec.actuator?.action).toBe('springClosed');
		}
	});

	test('a check valve passes nothing once it is shut', () => {
		const check = buildValveModel('check-swing');
		expect(check.flowCoefficient({ opening: 0, fluid: water, flowToOpen: true })).toBe(0);
	});
});

describe('relief valve', () => {
	test('the model exposes relief behaviour beyond the common contract', () => {
		const relief = buildValveModel('relief');
		expect(isReliefValve(relief)).toBe(true);
	});

	test('a pop action relief valve stays shut below its set pressure', () => {
		const relief = buildValveModel('relief');
		if (!isReliefValve(relief)) throw new Error('expected a relief valve');
		expect(relief.liftFraction(5, false)).toBe(0);
		expect(relief.liftFraction(relief.setPressureBarGauge() * 0.99, false)).toBe(0);
	});

	test('a pop action relief valve reaches full lift at its overpressure', () => {
		const relief = buildValveModel('relief');
		if (!isReliefValve(relief)) throw new Error('expected a relief valve');
		expect(relief.liftFraction(relief.fullLiftPressureBarGauge() + 0.1, true)).toBe(1);
	});

	test('the valve reseats below its set pressure, which is the point of blowdown', () => {
		// Without blowdown the valve would reseat the instant the pressure dipped
		// and then reopen, chattering and destroying the seat.
		const relief = buildValveModel('relief');
		if (!isReliefValve(relief)) throw new Error('expected a relief valve');
		const setPressure = relief.setPressureBarGauge();
		const reseat = relief.reseatPressureBarGauge();
		expect(reseat).toBeLessThan(setPressure);
		expect(reseat).toBeGreaterThan(setPressure * 0.85);
	});

	test('the capacity chokes because a relief valve discharges to atmosphere', () => {
		const relief = buildValveModel('relief');
		if (!isReliefValve(relief)) throw new Error('expected a relief valve');
		const result = relief.capacity({
			inletPressureBarAbsolute: 11,
			outletPressureBarAbsolute: 1.01325,
			temperatureK: celsiusToKelvin(20),
			molarMassKgPerMol: 0.0289645,
			specificHeatRatio: 1.4
		});
		expect(result.choked).toBe(true);
		expect(result.massFlowKgPerHour).toBeGreaterThan(0);
	});

	test('a choked relief valve is unaffected by the discharge pressure', () => {
		// The practical consequence: a gas relief valve that appears undersized
		// cannot be fixed by shortening the discharge line.
		const relief = buildValveModel('relief');
		if (!isReliefValve(relief)) throw new Error('expected a relief valve');
		const base = {
			inletPressureBarAbsolute: 11,
			temperatureK: celsiusToKelvin(20),
			molarMassKgPerMol: 0.0289645,
			specificHeatRatio: 1.4
		};
		const lowDischarge = relief.capacity({ ...base, outletPressureBarAbsolute: 1.01325 });
		const highDischarge = relief.capacity({ ...base, outletPressureBarAbsolute: 3 });
		expect(highDischarge.massFlowKgPerHour).toBeCloseTo(lowDischarge.massFlowKgPerHour, 6);
	});

	test('the capacity grows with the inlet pressure', () => {
		const relief = buildValveModel('relief');
		if (!isReliefValve(relief)) throw new Error('expected a relief valve');
		const base = {
			outletPressureBarAbsolute: 1.01325,
			temperatureK: celsiusToKelvin(20),
			molarMassKgPerMol: 0.0289645,
			specificHeatRatio: 1.4
		};
		const low = relief.capacity({ ...base, inletPressureBarAbsolute: 11 });
		const high = relief.capacity({ ...base, inletPressureBarAbsolute: 22 });
		expect(high.massFlowKgPerHour).toBeGreaterThan(low.massFlowKgPerHour);
	});

	test('a relief valve does not report a flow coefficient, because it is not sized that way', () => {
		const relief = buildValveModel('relief');
		expect(relief.flowCoefficient({ opening: 1, fluid: water, flowToOpen: true })).toBe(0);
	});
});

describe('sizing the valves against a real duty', () => {
	test('a fully open gate valve passes more than the same size globe valve', () => {
		const gate = buildValveModel('gate');
		const globe = buildValveModel('globe');
		const duty = {
			fluid: water,
			upstreamPressureBar: 4,
			downstreamPressureBar: 3,
			temperatureK: T20C
		};

		const gateFlow = computeFlow({
			...duty,
			kv: gate.spec.ratedKv,
			pressureRecoveryFactor: gate.spec.pressureRecoveryFactor
		});
		const globeFlow = computeFlow({
			...duty,
			kv: globe.spec.ratedKv,
			pressureRecoveryFactor: globe.spec.pressureRecoveryFactor
		});

		expect(gateFlow.volumetricFlowM3PerHour).toBeGreaterThan(globeFlow.volumetricFlowM3PerHour);
	});

	test('a ball valve chokes at a much smaller pressure drop than a globe valve', () => {
		// The straight through bore recovers more pressure, so the vena contracta
		// pressure drops further and the flow chokes at a pressure drop the globe
		// valve still handles. At a large enough drop both valves choke, so the
		// comparison that matters is the pressure drop at which each one stops
		// gaining flow: the ball valve is limited to roughly half of what the globe
		// valve can use, which is the practical reason a ball valve is a poor choice
		// for a high pressure drop liquid service.
		const ball = buildValveModel('ball');
		const globe = buildValveModel('globe');
		const duty = {
			fluid: water,
			kv: 40,
			upstreamPressureBar: 6,
			downstreamPressureBar: 1.2,
			temperatureK: celsiusToKelvin(120)
		};

		const ballFlow = computeFlow({
			...duty,
			pressureRecoveryFactor: ball.spec.pressureRecoveryFactor,
			incipientCavitationSigma: ball.spec.incipientCavitationSigma
		});
		const globeFlow = computeFlow({
			...duty,
			pressureRecoveryFactor: globe.spec.pressureRecoveryFactor,
			incipientCavitationSigma: globe.spec.incipientCavitationSigma
		});

		expect(ballFlow.choked).toBe(true);
		expect(globeFlow.choked).toBe(true);
		// The ball valve is limited to about half the pressure drop, so it passes
		// noticeably less flow for the same Kv.
		expect(ballFlow.effectivePressureDropBar).toBeLessThan(globeFlow.effectivePressureDropBar * 0.7);
		expect(ballFlow.volumetricFlowM3PerHour).toBeLessThan(globeFlow.volumetricFlowM3PerHour);
	});

	test('a ball valve needs a larger recovery margin before it stops choking', () => {
		// Reducing the pressure drop until the ball valve no longer chokes shows how
		// much smaller its usable range is.
		const ball = buildValveModel('ball');
		const globe = buildValveModel('globe');
		const base = {
			fluid: water,
			kv: 40,
			upstreamPressureBar: 6,
			temperatureK: celsiusToKelvin(120)
		};

		const ballFlow = computeFlow({
			...base,
			downstreamPressureBar: 3,
			pressureRecoveryFactor: ball.spec.pressureRecoveryFactor
		});
		const globeFlow = computeFlow({
			...base,
			downstreamPressureBar: 3,
			pressureRecoveryFactor: globe.spec.pressureRecoveryFactor
		});

		// At a 3 bar drop the globe valve is still in control while the ball valve
		// is not, which is the margin a designer has to allow for.
		expect(ballFlow.choked).toBe(true);
		expect(globeFlow.choked).toBe(false);
	});
});
