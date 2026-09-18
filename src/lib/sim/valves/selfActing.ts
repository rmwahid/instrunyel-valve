/**
 * Self acting valves: the check valve and the relief valve.
 *
 * These two valves have no external signal. The process itself provides the
 * force that opens them, and a spring provides the force that closes them. That
 * makes them the cleanest illustration of a force balance anywhere in the
 * catalogue, because there is nothing else in the loop.
 *
 * They also mark the boundary of what a control system can do. A control loop
 * cannot protect a vessel from overpressure, because a loop needs a measurement,
 * a controller and a final element, and all three can fail. Protection has to be
 * self acting and fail safe, and these are the two valves that do it.
 */

import { selfActingActuator, type ActuatorSpec } from '../actuator';
import { FRICTION_PRESETS } from '../friction';
import { diameterMmToAreaM2, inchToMm } from '../units';
import type { ValveModel, ValveSpec } from './types';

// ---------------------------------------------------------------------------
// Check valve
// ---------------------------------------------------------------------------

export interface CheckValveOptions {
	nominalSizeInch?: number;
	ratedKv?: number;
	/** Type of closure, which sets how fast it reacts and how much it slams. */
	design?: 'swing' | 'lift' | 'dualPlate' | 'axial';
}

interface CheckDesign {
	/** Pressure difference at which the valve just begins to open, bar. */
	crackingPressureBar: number;
	/** Pressure difference at which the valve reaches full lift, bar. */
	fullLiftPressureBar: number;
	/** Closing time constant, seconds. A swing check is slow and slams, a dual plate is fast. */
	closingTimeConstantSeconds: number;
	/** Description shown in the lesson. */
	description: string;
	/** Recommended service. */
	service: string;
}

/**
 * The four common check valve designs, and what actually separates them.
 *
 * A check valve's behaviour is dominated by how far its closure has to travel
 * and how heavy it is. A swing check has a large heavy disc on a long hinge, so
 * it needs a large reverse flow to close and it slams when it does. A dual plate
 * has two light spring loaded half discs with a short travel, so it closes
 * quickly and quietly. The difference is not cosmetic: a slamming check valve
 * destroys itself and the piping, which is why the wrong choice is a common and
 * expensive mistake.
 */
export const CHECK_DESIGNS: Record<NonNullable<CheckValveOptions['design']>, CheckDesign> = {
	swing: {
		crackingPressureBar: 0.035,
		fullLiftPressureBar: 0.2,
		closingTimeConstantSeconds: 1.2,
		description:
			'A disc on a hinge swings out of the flow. Very low pressure drop when open, but the disc has a long way to travel and it slams on reverse flow.',
		service: 'Large lines, low pressure drop, service where water hammer is not a concern'
	},
	lift: {
		crackingPressureBar: 0.07,
		fullLiftPressureBar: 0.35,
		closingTimeConstantSeconds: 0.7,
		description:
			'A disc lifts vertically in a guide. Compact and cheap, but the guide can foul in dirty service.',
		service: 'Small lines, clean service, vertical installation'
	},
	dualPlate: {
		crackingPressureBar: 0.02,
		fullLiftPressureBar: 0.1,
		closingTimeConstantSeconds: 0.15,
		description:
			'Two light half discs on springs fold into the flow. Short travel and a light closure, so it closes before reverse flow can build up.',
		service: 'Where water hammer must be avoided, compressor discharge, quick closing duty'
	},
	axial: {
		crackingPressureBar: 0.015,
		fullLiftPressureBar: 0.08,
		closingTimeConstantSeconds: 0.08,
		description:
			'A single coaxial disc on a spring, guided by the body. The fastest and quietest design, at the highest cost.',
		service: 'High energy duty, compressor discharge, anywhere a slam would be destructive'
	}
};

/**
 * Check valve: a self acting non-return valve.
 *
 * The model produces position from the pressure difference across it, using the
 * two pressure points that define the design: the cracking pressure where the
 * disc lifts off its seat, and the pressure where it reaches full lift. Between
 * them the disc is only partly open, which is the region where a check valve
 * chatters and wears out.
 *
 * Reverse flow does not simply stop. The disc has to travel back to its seat,
 * and while it travels there is a path open for the reverse flow. A slow closing
 * design therefore passes a measurable slug of reverse flow before it seals, and
 * that slug is what produces water hammer in the piping behind it.
 */
export function createCheckValve(options: CheckValveOptions = {}): ValveModel {
	const nominalSizeInch = options.nominalSizeInch ?? 2;
	const designType = options.design ?? 'swing';
	const design = CHECK_DESIGNS[designType];
	const boreMm = inchToMm(nominalSizeInch);
	const strokeM = 0.02;

	const spec: ValveSpec = {
		id: `check-${designType}`,
		name: `Check valve (${designType})`,
		family: 'selfActing',
		actuation: 'selfActing',
		// A check valve is full bore when open, so its capacity is that of the pipe.
		ratedKv: options.ratedKv ?? 130,
		characteristic: 'quickOpening',
		rangeability: 10,
		ports: {
			nominalSizeInch,
			portAreaM2: diameterMmToAreaM2(boreMm),
			balanceSealAreaM2: 0
		},
		pressureRecoveryFactor: 0.7,
		terminalPressureDropRatio: 0.35,
		incipientCavitationSigma: 1.5,
		friction: FRICTION_PRESETS.ptfeLow,
		actuator: selfActingActuator({
			effectiveAreaM2: diameterMmToAreaM2(boreMm * 0.9),
			strokeM,
			movingMassKg: designType === 'swing' ? 2.2 : 0.4,
			crackingPressureBar: design.crackingPressureBar,
			fullTravelPressureBar: design.fullLiftPressureBar,
			// The spring keeps a small force on the seat so the disc seals at low
			// reverse pressure. Without it the valve would leak until the pressure
			// difference reversed.
			seatForceN: designType === 'swing' ? 40 : 15
		}),
		suitablePhases: ['liquid', 'gas', 'steam'],
		typicalServices: [design.service, 'Pump discharge', 'Preventing reverse flow', 'Bypass lines'],
		summary: `${design.description} It opens on forward flow and closes on reverse flow, with no signal and no external power.`
	};

	return {
		spec,
		/**
		 * A check valve has no positioner and no command. Its opening is whatever
		 * the pressure difference produces, which is why this method computes a
		 * position rather than a coefficient.
		 */
		flowCoefficient({ opening }): number {
			if (opening <= 0) return 0;
			// A quick opening trim reaches most of its capacity in the first part of
			// the lift, matching a disc that comes off its seat.
			return spec.ratedKv * Math.sqrt(Math.min(1, Math.max(0, opening)));
		},
		fluidForce(pressureDropBar, flowToOpen): number {
			// The disc is the closure and the pressure difference acts on it. In a
			// check valve the flow direction is not a design choice: forward flow
			// always pushes the disc off its seat.
			const areaM2 = diameterMmToAreaM2(boreMm * 0.9);
			const magnitude = Math.abs(pressureDropBar) * 1e5 * areaM2 * 0.9;
			return flowToOpen ? magnitude : -magnitude;
		},
		closedPosition(): number {
			return 0;
		},
		openPosition(): number {
			return strokeM;
		},
		toOpening(positionNative: number): number {
			return Math.min(1, Math.max(0, positionNative / strokeM));
		},
		fromOpening(opening: number): number {
			return Math.min(1, Math.max(0, opening)) * strokeM;
		},
		isOnOff(): boolean {
			return false;
		}
	};
}

/**
 * Cracking pressure of a check valve design, bar.
 *
 * The value the engine needs to decide whether a check valve is open, exposed so
 * a caller does not have to build a model just to read the design table.
 */
export function checkValveCrackingPressureBar(
	design: NonNullable<CheckValveOptions['design']>
): number {
	return CHECK_DESIGNS[design].crackingPressureBar;
}

export function checkValveFullLiftPressureBar(
	design: NonNullable<CheckValveOptions['design']>
): number {
	return CHECK_DESIGNS[design].fullLiftPressureBar;
}

// ---------------------------------------------------------------------------
// Relief valve
// ---------------------------------------------------------------------------

export interface ReliefValveOptions {
	/** Orifice area, m2. Standard API letters map to fixed areas. */
	orificeAreaM2?: number;
	/** Set pressure, bar gauge. The pressure at which the valve starts to lift. */
	setPressureBarGauge?: number;
	/** Blowdown as a fraction of set pressure. Typically 7 to 10 percent. */
	blowdownFraction?: number;
	/**
	 * Overpressure as a fraction of set pressure at which the valve reaches full
	 * lift, following the ASME requirement of 10 percent for a standard valve.
	 */
	overpressureFraction?: number;
	/** True for a pop action valve, false for a proportional (safety relief) valve. */
	popAction?: boolean;
	/**
	 * Superimposed back pressure as a fraction of set pressure. High back pressure
	 * lifts the valve early, which is why a bellows is fitted on such services.
	 */
	backPressureFraction?: number;
}

/**
 * Standard API 526 effective orifice areas in square millimetres.
 *
 * The letter designations are worth knowing because a relief valve is specified
 * by letter rather than by area. The area does not include the discharge
 * coefficient, which is applied separately and is around 0.975 for a certified
 * valve.
 */
export const API_ORIFICE_AREAS_MM2 = {
	D: 71,
	E: 126,
	F: 198,
	G: 325,
	H: 506,
	J: 830,
	K: 1186,
	L: 1841,
	M: 2323,
	N: 2800,
	P: 4116,
	Q: 7129,
	R: 10323,
	T: 16774
} as const;

export type ApiOrificeLetter = keyof typeof API_ORIFICE_AREAS_MM2;

/** Certified discharge coefficient for a standard API relief valve. */
export const RELIEF_DISCHARGE_COEFFICIENT = 0.975;

/**
 * A relief valve, with the extra methods the engine needs to drive it.
 *
 * A relief valve is not driven by a signal, so it does not fit the flow
 * coefficient contract in quite the same way as a control valve. It is sized on
 * orifice area and relief capacity, and its position comes from its own force
 * balance against inlet pressure.
 */
export interface ReliefValveModel extends ValveModel {
	/** Lift fraction 0..1 for a given inlet gauge pressure, with reseat hysteresis. */
	liftFraction(inletPressureBarGauge: number, wasOpen: boolean): number;
	/** Set pressure in bar gauge. */
	setPressureBarGauge(): number;
	/** Pressure at which the valve reseats, bar gauge. */
	reseatPressureBarGauge(): number;
	/** Pressure at which the valve reaches full lift, bar gauge. */
	fullLiftPressureBarGauge(): number;
	/** Effective orifice area, m2. */
	orificeAreaM2(): number;
	/** Relieving capacity at the given conditions, following API 520. */
	capacity(input: {
		inletPressureBarAbsolute: number;
		outletPressureBarAbsolute: number;
		temperatureK: number;
		molarMassKgPerMol: number;
		specificHeatRatio: number;
		z?: number;
	}): { massFlowKgPerHour: number; choked: boolean };
}

/**
 * Relief valve: the last line of defence against overpressure.
 *
 * A relief valve is not a control valve and must never be treated as one. Its
 * whole purpose is to work when everything else has failed, which is why it is
 * self acting, why its set pressure is sealed, and why it is sized on a scenario
 * rather than on a normal operating condition.
 *
 * Three pressures define its behaviour, and the gaps between them are what makes
 * the valve work:
 *
 *  - Set pressure: where the valve begins to open. Below it, the spring holds the
 *    disc shut with a force margin called the seat tightness.
 *  - Overpressure: where it reaches full lift. ASME allows 10 percent above set
 *    pressure for a standard valve, and the valve is sized so this is enough to
 *    pass the required relieving capacity.
 *  - Blowdown: the pressure below set where it reseats, typically 7 to 10 percent
 *    lower. Without blowdown the valve would reseat the instant the pressure
 *    dipped and then reopen, chattering and destroying both the seat and the
 *    piping.
 *
 * A pop action valve opens quickly and is used on gas and steam. A proportional
 * valve opens gradually and is used on liquid, where a sudden full lift would
 * cause a pressure surge in the discharge line.
 */
export function createReliefValve(options: ReliefValveOptions = {}): ReliefValveModel {
	const orificeAreaM2 =
		options.orificeAreaM2 ?? API_ORIFICE_AREAS_MM2.J / 1e6;
	const setPressureBarGauge = options.setPressureBarGauge ?? 10;
	const blowdownFraction = options.blowdownFraction ?? 0.07;
	const overpressureFraction = options.overpressureFraction ?? 0.1;
	const popAction = options.popAction ?? true;
	const backPressureFraction = options.backPressureFraction ?? 0;

	const reseatPressureBarGauge = setPressureBarGauge * (1 - blowdownFraction);
	const fullLiftPressureBarGauge = setPressureBarGauge * (1 + overpressureFraction);

	// The flow area grows quickly on a pop action valve and gradually on a
	// proportional one. Shape factor raised to a power: a high power approaches a
	// step without introducing a discontinuity that would upset the integrator.
	const openingShapeBase = popAction ? 6 : 1.5;

	const spec: ValveSpec = {
		id: 'relief',
		name: popAction ? 'Relief valve (pop action)' : 'Safety relief valve (proportional)',
		family: 'selfActing',
		actuation: 'selfActing',
		// A relief valve's capacity is set by its orifice, not by a Kv. The
		// equivalent Kv reported here is for the sizing display only; the relief
		// calculation itself uses the orifice area and the discharge coefficient.
		ratedKv: 0,
		characteristic: 'quickOpening',
		rangeability: 1,
		ports: {
			// A nominal size is not meaningful for an orifice limited device.
			nominalSizeInch: 2,
			portAreaM2: orificeAreaM2,
			balanceSealAreaM2: 0
		},
		pressureRecoveryFactor: 1,
		terminalPressureDropRatio: 0.5,
		incipientCavitationSigma: 1.5,
		friction: { staticFrictionN: 0, kineticFrictionN: 0 },
		actuator: selfActingActuator({
			effectiveAreaM2: orificeAreaM2,
			strokeM: 0.012,
			movingMassKg: 0.6,
			crackingPressureBar: setPressureBarGauge * (1 - backPressureFraction),
			fullTravelPressureBar: fullLiftPressureBarGauge,
			// The spring force on the seat is what makes the valve tight below set
			// pressure, and it is the reason a relief valve cannot be set by hand
			// while the vessel is pressurised.
			seatForceN: 900
		}),
		suitablePhases: ['liquid', 'gas', 'steam'],
		typicalServices: ['Vessel overpressure protection', 'Thermal relief', 'Pump discharge', 'Steam drum'],
		summary: `${popAction ? 'Pop action' : 'Proportional'} overpressure protection set at ${setPressureBarGauge} bar gauge, with ${(blowdownFraction * 100).toFixed(0)} percent blowdown. Self acting and independent of any control system.`
	};

	/**
	 * Lift fraction of the relief valve as a function of the inlet pressure.
	 *
	 * The hysteresis between opening and reseating is explicit here because it is
	 * a designed feature rather than an imperfection: the valve reseats at a
	 * pressure below its set pressure on purpose.
	 */
	function liftFraction(inletPressureBarGauge: number, wasOpen: boolean): number {
		const effectiveSetPressure = setPressureBarGauge * (1 - backPressureFraction);

		if (inletPressureBarGauge < reseatPressureBarGauge) return 0;

		if (inletPressureBarGauge <= effectiveSetPressure) {
			// Between reseat and set pressure the valve is either shut or closing.
			if (wasOpen) {
				const closingFraction =
					(inletPressureBarGauge - reseatPressureBarGauge) /
					Math.max(1e-9, effectiveSetPressure - reseatPressureBarGauge);
				return Math.max(0, Math.min(1, closingFraction));
			}
			return 0;
		}

		const overpressure = (inletPressureBarGauge - effectiveSetPressure) / effectiveSetPressure;
		const shape = Math.min(1, overpressure / Math.max(1e-9, overpressureFraction));
		return Math.min(1, Math.max(0, shape ** openingShapeBase));
	}

	function capacity(input: {
		inletPressureBarAbsolute: number;
		outletPressureBarAbsolute: number;
		temperatureK: number;
		molarMassKgPerMol: number;
		specificHeatRatio: number;
		z?: number;
	}): { massFlowKgPerHour: number; choked: boolean } {
		return reliefCapacityKgPerHour({ ...input, orificeAreaM2 });
	}

	return {
		spec,
		flowCoefficient(): number {
			// A relief valve is not described by a flow coefficient. The zero is
			// returned so a caller that reaches for one gets an obviously wrong number
			// rather than a plausible one; the actual capacity comes from
			// `computeFlow`, which applies the orifice equation.
			return 0;
		},
		fluidForce(): number {
			// The disc force balance is what determines lift, and the lift curve is
			// described directly by the set pressure, overpressure and blowdown.
			return 0;
		},
		/**
		 * Relieving capacity, by the equation that matches the fluid.
		 *
		 * A relief valve on gas is sized with the API 520 orifice equation, which has
		 * a critical flow branch because the discharge to atmosphere always chokes
		 * it. A relief valve on liquid is sized with the incompressible orifice
		 * equation instead, and the distinction is not cosmetic: the gas equation
		 * derives its own density from the ideal gas law, so using it on water would
		 * treat the liquid as a vapour of air's molar mass and overstate the capacity
		 * by two orders of magnitude.
		 *
		 * The valve does not need the temperature for the liquid branch and does not
		 * need the molar mass, which is why the two branches are written separately
		 * rather than behind a shared formula.
		 */
		computeFlow(input) {
			const pressureDropBar = Math.max(0, input.pressureDropBar);
			if (input.opening <= 0 || pressureDropBar <= 0) {
				return {
					massFlowKgPerHour: 0,
					volumetricFlowM3PerHour: 0,
					effectivePressureDropBar: pressureDropBar,
					choked: false
				};
			}

			// The orifice the flow passes through is the full orifice area scaled by
			// how far the disc has lifted, which is what makes the lift curve the
			// capacity curve.
			const openAreaM2 = orificeAreaM2 * Math.min(1, Math.max(0, input.opening));
			const density = input.densityKgPerM3 > 0 ? input.densityKgPerM3 : 1;

			if (input.fluid.phase === 'liquid') {
				const capacity = liquidReliefCapacityKgPerHour({
					orificeAreaM2: openAreaM2,
					pressureDropBar,
					densityKgPerM3: density
				});

				return {
					massFlowKgPerHour: capacity.massFlowKgPerHour,
					volumetricFlowM3PerHour: capacity.massFlowKgPerHour / density,
					effectivePressureDropBar: pressureDropBar,
					choked: false,
					notes: ['Incompressible orifice equation for liquid relief.']
				};
			}

			const capacity = reliefCapacityKgPerHour({
				orificeAreaM2: openAreaM2,
				inletPressureBarAbsolute: input.upstreamPressureBar,
				outletPressureBarAbsolute: input.downstreamPressureBar,
				temperatureK: input.temperatureK,
				molarMassKgPerMol: input.molarMassKgPerMol ?? 0.0289645,
				specificHeatRatio: input.specificHeatRatio ?? 1.4
			});

			return {
				massFlowKgPerHour: capacity.massFlowKgPerHour,
				volumetricFlowM3PerHour: capacity.massFlowKgPerHour / density,
				effectivePressureDropBar: pressureDropBar,
				choked: capacity.choked,
				notes: [
					`API 520 orifice equation, ${capacity.choked ? 'critical flow' : 'subcritical flow'}.`
				]
			};
		},
		/**
		 * Lift, from the relief valve's own pressure law.
		 *
		 * This is why a relief valve states its own opening law rather than using the
		 * generic spring ramp. The blowdown is deliberate hysteresis: once the valve
		 * has lifted it stays open until the pressure falls to the reseat value, which
		 * is lower than the set pressure. Without it the valve would reseat the
		 * instant the pressure dipped and reopen immediately, chattering against its
		 * seat until both the seat and the piping failed.
		 */
		computeOpening(input) {
			return liftFraction(input.pressureDifferenceBar, input.wasOpen);
		},
		closedPosition(): number {
			return 0;
		},
		openPosition(): number {
			return 1;
		},
		toOpening(positionNative: number): number {
			return Math.min(1, Math.max(0, positionNative));
		},
		fromOpening(opening: number): number {
			return Math.min(1, Math.max(0, opening));
		},
		isOnOff(): boolean {
			// A pop action relief valve is effectively on-off, which is the whole
			// point of the pop action design.
			return popAction;
		},
		liftFraction,
		setPressureBarGauge: () => setPressureBarGauge,
		reseatPressureBarGauge: () => reseatPressureBarGauge,
		fullLiftPressureBarGauge: () => fullLiftPressureBarGauge,
		orificeAreaM2: () => orificeAreaM2,
		capacity
	};
}

/**
 * Relieving mass flow through a relief valve on gas or vapour service, kg/h.
 *
 * This follows the API 520 orifice equation rearranged into the project's units,
 * including the compressible critical flow branch. A relief valve on gas almost
 * always runs choked, because the discharge is to atmosphere and the pressure
 * ratio across it is far above critical. That is a fact worth teaching on its
 * own: the discharge pressure of a gas relief valve does not affect its
 * capacity, so a valve that appears undersized cannot be fixed by a shorter
 * discharge pipe.
 */
export function reliefCapacityKgPerHour(input: {
	orificeAreaM2: number;
	/** Inlet absolute pressure at the relieving condition, bar. */
	inletPressureBarAbsolute: number;
	/** Absolute pressure in the discharge line, bar. */
	outletPressureBarAbsolute: number;
	temperatureK: number;
	/** Molar mass, kg/mol. */
	molarMassKgPerMol: number;
	specificHeatRatio: number;
	/** Compressibility factor. */
	z?: number;
}): { massFlowKgPerHour: number; choked: boolean } {
	const {
		orificeAreaM2,
		inletPressureBarAbsolute,
		outletPressureBarAbsolute,
		temperatureK,
		molarMassKgPerMol,
		specificHeatRatio
	} = input;
	const z = input.z ?? 1;

	if (orificeAreaM2 <= 0 || inletPressureBarAbsolute <= 0 || temperatureK <= 0) {
		return { massFlowKgPerHour: 0, choked: false };
	}

	const pressureRatio = outletPressureBarAbsolute / inletPressureBarAbsolute;

	// Critical pressure ratio for the isentropic flow of an ideal gas. Below it
	// the flow is choked and velocity at the throat is sonic, so the downstream
	// pressure stops mattering.
	const criticalPressureRatio = (2 / (specificHeatRatio + 1)) ** (specificHeatRatio / (specificHeatRatio - 1));
	const choked = pressureRatio <= criticalPressureRatio;

	// Upstream density from the ideal gas law in the units the orifice equation wants.
	const densityKgPerM3 = (inletPressureBarAbsolute * 1e5 * molarMassKgPerMol) / (z * 8.314462618 * temperatureK);

	let massFluxKgPerM2PerSecond: number;

	if (choked) {
		// Critical mass flux: the maximum a convergent nozzle can pass.
		const criticalFactor =
			Math.sqrt(specificHeatRatio) *
			(2 / (specificHeatRatio + 1)) ** ((specificHeatRatio + 1) / (2 * (specificHeatRatio - 1)));
		massFluxKgPerM2PerSecond =
			criticalFactor * Math.sqrt(inletPressureBarAbsolute * 1e5 * densityKgPerM3);
	} else {
		const expansion = (specificHeatRatio / (specificHeatRatio - 1)) *
			(1 - pressureRatio ** ((specificHeatRatio - 1) / specificHeatRatio));
		massFluxKgPerM2PerSecond = Math.sqrt(
			Math.max(0, 2 * inletPressureBarAbsolute * 1e5 * densityKgPerM3 * expansion)
		);
	}

	const massFlowKgPerSecond =
		RELIEF_DISCHARGE_COEFFICIENT * orificeAreaM2 * massFluxKgPerM2PerSecond;

	return { massFlowKgPerHour: massFlowKgPerSecond * 3600, choked };
}

/**
 * Relieving mass flow through a relief valve on liquid service, kg/h.
 *
 * A liquid is incompressible for this purpose, so the capacity follows the simple
 * orifice equation Q = Cd A sqrt(2 dP / rho) and the flow keeps rising with the
 * square root of the pressure difference. There is no choked branch and no
 * critical pressure ratio: the flow is limited by the pressure the vessel can
 * generate, not by the speed of sound.
 *
 * Using the gas equation here would be badly wrong rather than merely imprecise.
 * The gas equation computes its own density from the ideal gas law, so applying it
 * to water would treat the liquid as a vapour of air's molar mass and overstate
 * the capacity by two orders of magnitude.
 */
export function liquidReliefCapacityKgPerHour(input: {
	orificeAreaM2: number;
	/** Pressure difference across the orifice, bar. */
	pressureDropBar: number;
	/** Liquid density at the relieving condition, kg/m3. */
	densityKgPerM3: number;
	/** Discharge coefficient. 0.65 is typical for a liquid relief valve. */
	dischargeCoefficient?: number;
}): { massFlowKgPerHour: number; choked: boolean } {
	const { orificeAreaM2, pressureDropBar, densityKgPerM3 } = input;
	const dischargeCoefficient = input.dischargeCoefficient ?? 0.65;

	if (orificeAreaM2 <= 0 || pressureDropBar <= 0 || densityKgPerM3 <= 0) {
		return { massFlowKgPerHour: 0, choked: false };
	}

	const velocityMPerSecond = Math.sqrt((2 * pressureDropBar * 1e5) / densityKgPerM3);
	const volumetricFlowM3PerSecond = dischargeCoefficient * orificeAreaM2 * velocityMPerSecond;

	// A liquid relief valve never chokes: the flow is set by the pressure
	// difference the vessel can sustain, and a vessel that cannot sustain it fails
	// rather than reaching a flow limit.
	return { massFlowKgPerHour: volumetricFlowM3PerSecond * densityKgPerM3 * 3600, choked: false };
}

/** Required orifice area for a given relieving mass flow, m2. */
export function requiredReliefOrificeM2(input: {
	massFlowKgPerHour: number;
	inletPressureBarAbsolute: number;
	outletPressureBarAbsolute: number;
	temperatureK: number;
	molarMassKgPerMol: number;
	specificHeatRatio: number;
	z?: number;
}): number {
	// Evaluate the capacity of a unit area orifice, then scale.
	const unit = reliefCapacityKgPerHour({ ...input, orificeAreaM2: 1 });
	if (unit.massFlowKgPerHour <= 0) return 0;
	return input.massFlowKgPerHour / unit.massFlowKgPerHour;
}

/** Smallest standard API orifice letter that meets a required area. */
export function selectApiOrifice(requiredAreaM2: number): ApiOrificeLetter {
	const requiredMm2 = requiredAreaM2 * 1e6;
	const letters = Object.keys(API_ORIFICE_AREAS_MM2) as ApiOrificeLetter[];
	for (const letter of letters) {
		if (API_ORIFICE_AREAS_MM2[letter] >= requiredMm2) return letter;
	}
	return letters[letters.length - 1];
}

/**
 * Actuator stub for valves that have none.
 *
 * The engine reads `spec.actuator` to decide whether to run a pneumatic signal
 * chain, so a self acting valve reports null and the engine skips that stage.
 */
export const NO_ACTUATOR: ActuatorSpec | null = null;
