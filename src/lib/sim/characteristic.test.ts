/**
 * Tests for the inherent and installed flow characteristics.
 *
 * The installed curve tests are the interesting ones: they check that the
 * relationship between valve authority and the shape of the curve behaves the
 * way a control engineer expects, which is the single most useful thing the lab
 * has to teach.
 */

import { describe, expect, test } from 'bun:test';
import {
	characteristicCurve,
	installedFlow,
	installedGain,
	relativeCapacity,
	systemResistance,
	type HydraulicSystem
} from './characteristic';

describe('inherent characteristic', () => {
	test('every curve is shut at zero travel and at rating at full travel', () => {
		for (const characteristic of [
			'linear',
			'equalPercentage',
			'quickOpening',
			'modifiedParabolic'
		] as const) {
			expect(relativeCapacity(characteristic, 0)).toBeCloseTo(0, 9);
			expect(relativeCapacity(characteristic, 1)).toBeCloseTo(1, 9);
		}
	});

	test('linear capacity equals travel', () => {
		expect(relativeCapacity('linear', 0.5)).toBeCloseTo(0.5, 9);
	});

	test('equal percentage approaches the reciprocal of rangeability just above shutoff', () => {
		// The 1/R value is the smallest controllable capacity. It is the limit the
		// curve approaches, not the value at zero travel, because a seated plug
		// passes nothing.
		expect(relativeCapacity('equalPercentage', 0.001, { rangeability: 50 })).toBeCloseTo(1 / 50, 2);
	});

	test('a seated plug passes nothing whatever the trim', () => {
		for (const characteristic of [
			'linear',
			'equalPercentage',
			'quickOpening',
			'modifiedParabolic'
		] as const) {
			expect(relativeCapacity(characteristic, 0)).toBe(0);
		}
	});

	test('equal percentage multiplies capacity by a constant factor per equal step', () => {
		const first = relativeCapacity('equalPercentage', 0.2) / relativeCapacity('equalPercentage', 0.1);
		const second = relativeCapacity('equalPercentage', 0.6) / relativeCapacity('equalPercentage', 0.5);
		expect(first).toBeCloseTo(second, 9);
	});

	test('a higher rangeability makes the equal percentage curve steeper', () => {
		// At 20 percent travel a wider rangeability valve is further below linear.
		expect(relativeCapacity('equalPercentage', 0.2, { rangeability: 100 })).toBeLessThan(
			relativeCapacity('equalPercentage', 0.2, { rangeability: 30 })
		);
	});

	test('quick opening delivers more than half its capacity in the first quarter of travel', () => {
		expect(relativeCapacity('quickOpening', 0.25)).toBeCloseTo(0.5, 9);
	});

	test('modified parabolic sits between linear and equal percentage', () => {
		const travel = 0.5;
		const parabolic = relativeCapacity('modifiedParabolic', travel);
		expect(parabolic).toBeGreaterThan(relativeCapacity('equalPercentage', travel));
		expect(parabolic).toBeLessThan(relativeCapacity('linear', travel));
	});

	test('travel outside the range clamps', () => {
		expect(relativeCapacity('linear', -1)).toBe(0);
		expect(relativeCapacity('linear', 2)).toBe(1);
	});
});

describe('installed characteristic', () => {
	const authoritySystem: HydraulicSystem = {
		totalPressureDropBar: 4,
		valveAuthority: 0.5,
		ratedKv: 40
	};

	test('no flow through a shut valve leaves the whole drop across it', () => {
		const result = installedFlow(authoritySystem, 0, 'linear');
		expect(result.flowM3PerHour).toBe(0);
		expect(result.valvePressureDropBar).toBeCloseTo(4, 9);
		expect(result.systemPressureDropBar).toBe(0);
	});

	test('opening the valve transfers pressure drop from the valve to the system', () => {
		const closed = installedFlow(authoritySystem, 0, 'linear');
		const open = installedFlow(authoritySystem, 1, 'linear');
		expect(open.valvePressureDropBar).toBeLessThan(closed.valvePressureDropBar);
		expect(open.systemPressureDropBar).toBeGreaterThan(0);
	});

	test('at design flow the split follows the stated valve authority', () => {
		// With authority 0.5 and the valve wide open, the valve keeps half the drop.
		const open = installedFlow(authoritySystem, 1, 'linear');
		expect(open.valvePressureDropBar / 4).toBeCloseTo(0.5, 6);
		expect(open.systemPressureDropBar / 4).toBeCloseTo(0.5, 6);
	});

	test('the total pressure drop is always conserved', () => {
		const point = installedFlow(authoritySystem, 0.6, 'equalPercentage');
		expect(point.valvePressureDropBar + point.systemPressureDropBar).toBeCloseTo(4, 6);
	});

	test('system resistance rises as authority falls', () => {
		const lowAuthority = systemResistance({ ...authoritySystem, valveAuthority: 0.2 });
		const highAuthority = systemResistance({ ...authoritySystem, valveAuthority: 0.8 });
		expect(lowAuthority).toBeGreaterThan(highAuthority);
	});

	test('high authority leaves an equal percentage valve close to its inherent curve', () => {
		// When the valve owns the pressure drop, the installed curve should not
		// stray far from the inherent one.
		const highAuthority: HydraulicSystem = { ...authoritySystem, valveAuthority: 0.95 };
		const curve = characteristicCurve(highAuthority, 'equalPercentage', 21);
		const mid = curve[10];
		expect(mid.installed).toBeCloseTo(mid.inherent, 1);
	});

	test('low authority flattens an equal percentage valve towards linear', () => {
		// This is the reason a plant ends up with a poorly controllable loop: the
		// valve was chosen for its inherent curve, but the installed curve is what
		// the controller sees.
		const lowAuthority: HydraulicSystem = { ...authoritySystem, valveAuthority: 0.05 };
		const curve = characteristicCurve(lowAuthority, 'equalPercentage', 21);
		const mid = curve[10];
		// The installed flow at half travel is far above the inherent capacity,
		// because the pressure drop across the valve has grown as the flow fell.
		expect(mid.installed).toBeGreaterThan(mid.inherent * 1.5);
	});

	test('the installed curve is monotonic for every characteristic', () => {
		for (const characteristic of [
			'linear',
			'equalPercentage',
			'quickOpening',
			'modifiedParabolic'
		] as const) {
			const curve = characteristicCurve(authoritySystem, characteristic, 21);
			for (let i = 1; i < curve.length; i++) {
				expect(curve[i].installed).toBeGreaterThanOrEqual(curve[i - 1].installed);
			}
		}
	});

	test('installed flow at full travel is normalised to one', () => {
		const curve = characteristicCurve(authoritySystem, 'linear', 21);
		expect(curve[curve.length - 1].installed).toBeCloseTo(1, 9);
	});
});

describe('installed gain', () => {
	const system: HydraulicSystem = {
		totalPressureDropBar: 4,
		valveAuthority: 0.5,
		ratedKv: 40
	};

	function gainFlatness(candidate: HydraulicSystem, characteristic: 'linear' | 'equalPercentage'): number {
		// The ratio of the highest installed gain to the lowest, across the usable
		// travel range. A perfectly constant gain would be 1, and a loop with a
		// constant gain is a loop that behaves the same wherever it is sitting.
		const gains = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95].map((opening) =>
			installedGain(candidate, characteristic, opening)
		);
		return Math.max(...gains) / Math.min(...gains);
	}

	test('at low valve authority an equal percentage trim gives the flatter gain', () => {
		// When the valve owns only a small share of the system pressure drop, its
		// own pressure drop collapses as the flow rises, which steepens the curve of
		// a linear trim. The equal percentage trim is shaped to cancel exactly that,
		// which is the reason it is the default choice for a throttling valve.
		const lowAuthority: HydraulicSystem = { ...system, valveAuthority: 0.05 };
		expect(gainFlatness(lowAuthority, 'equalPercentage')).toBeLessThan(
			gainFlatness(lowAuthority, 'linear')
		);
	});

	test('at high valve authority a linear trim gives the flatter gain', () => {
		// When the valve owns most of the pressure drop, the drop across it barely
		// changes with flow, so the installed curve matches the inherent one. A
		// linear trim is then the flat one and an equal percentage trim is steep.
		// This is the other half of the characteristic selection rule, and it is
		// why a valve should not be chosen on its inherent curve alone.
		const highAuthority: HydraulicSystem = { ...system, valveAuthority: 0.9 };
		expect(gainFlatness(highAuthority, 'linear')).toBeLessThan(
			gainFlatness(highAuthority, 'equalPercentage')
		);
	});

	test('gain is positive everywhere, so the valve always responds in the right direction', () => {
		for (const characteristic of [
			'linear',
			'equalPercentage',
			'quickOpening',
			'modifiedParabolic'
		] as const) {
			for (const opening of [0.1, 0.3, 0.5, 0.7, 0.9]) {
				expect(installedGain(system, characteristic, opening)).toBeGreaterThan(0);
			}
		}
	});

	test('a quick opening trim always has a steeper gain variation than a linear one', () => {
		// Quick opening puts most of its capacity in the first part of the travel,
		// so its gain falls away sharply. That is why it is an on-off trim.
		const quickOpeningGains = [0.15, 0.35, 0.55, 0.75, 0.95].map((opening) =>
			installedGain(system, 'quickOpening', opening)
		);
		const linearGains = [0.15, 0.35, 0.55, 0.75, 0.95].map((opening) =>
			installedGain(system, 'linear', opening)
		);
		expect(Math.max(...quickOpeningGains) / Math.min(...quickOpeningGains)).toBeGreaterThan(
			Math.max(...linearGains) / Math.min(...linearGains)
		);
	});
});
