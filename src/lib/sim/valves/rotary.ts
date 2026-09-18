/**
 * Quarter turn valves: ball, butterfly and plug.
 *
 * These share a rotating closure and, more importantly, a shared set of
 * consequences. The actuator applies a torque rather than a force. The flow path
 * is short and straight, so pressure recovery is high and cavitation is a real
 * risk. And the torque needed to move the closure changes with position in a way
 * that a sliding stem valve never experiences.
 *
 * Rotary positions are stored in radians in `positionNative`. Torque is converted
 * to an equivalent tangential force at a reference radius so that the actuator
 * and friction integrator, which work in newtons and metres, need no special
 * case for rotary valves.
 */

import {
	DEFAULT_POSITIONER_GAIN_BAR_PER_M,
	DEFAULT_POSITIONER_INTEGRAL_BAR_PER_M_PER_S,
	type ActuatorSpec
} from '../actuator';
import { relativeCapacity, type InherentCharacteristic } from '../characteristic';
import { FRICTION_PRESETS, type FrictionSpec } from '../friction';
import { diameterMmToAreaM2, inchToMm, psiToBar } from '../units';
import type { ValveModel, ValveSpec } from './types';

export const QUARTER_TURN_RADIANS = Math.PI / 2;

/**
 * The reference radius at which torque is converted to an equivalent stem force.
 *
 * Using the port radius keeps the numbers comparable with a sliding stem valve:
 * a 2 inch butterfly needs roughly the same actuator force to produce a given
 * torque as a 2 inch globe valve, which is the comparison the lessons draw.
 */
function referenceRadiusM(nominalSizeInch: number): number {
	return inchToMm(nominalSizeInch) / 2000;
}

/**
 * Overlap area of two equal circles whose centres are a distance `offset` apart,
 * as a fraction of one circle.
 *
 * This is the lens, or vesica, area. It is the correct geometric description of a
 * ball valve because the bore opening on the ball surface is a circle, and the
 * seat is a circle of the same size; rotating the ball slides one circle past the
 * other. The result is why a ball valve opens quickly at first: two overlapping
 * circles lose area slowly at first and then very fast.
 */
export function circleOverlapFraction(offset: number, radius: number): number {
	if (radius <= 0) return 0;
	const distance = Math.abs(offset);
	if (distance >= 2 * radius) return 0;
	if (distance <= 0) return 1;

	// lens area = 2 r^2 acos(d / 2r) - (d / 2) sqrt(4 r^2 - d^2)
	const lensArea =
		2 * radius ** 2 * Math.acos(distance / (2 * radius)) -
		(distance / 2) * Math.sqrt(4 * radius ** 2 - distance ** 2);

	return Math.max(0, Math.min(1, lensArea / (Math.PI * radius ** 2)));
}

export interface RotaryValveOptions {
	nominalSizeInch: number;
	ratedKv: number;
	characteristic: InherentCharacteristic;
	rangeability: number;
	actuator: ActuatorSpec | null;
	pressureRecoveryFactor: number;
	terminalPressureDropRatio: number;
	incipientCavitationSigma: number;
	friction: FrictionSpec;
	balanceFraction?: number;
	forceCoefficient?: number;
	/** Shape factor for the ball: how far the seat centre sits from the bore centre, in bore radii. */
	ballOffsetFactor?: number;
	/**
	 * Relative capacity as a function of the 0..1 opening.
	 * Defaults to the inherent characteristic.
	 */
	capacity?: (opening: number) => number;
	/** Torque coefficient for a butterfly disc, as a function of opening. Zero otherwise. */
	torqueCoefficient?: (opening: number) => number;
	/** Disc or port diameter used for the torque calculation, m. */
	closureDiameterM?: number;
}

/**
 * Build a rotary valve from a closure description.
 *
 * The actuator for a rotary valve is a piston or a rack and pinion rather than a
 * diaphragm, but the force balance is the same, so the existing actuator model
 * applies with the stroke expressed as an arc length at the reference radius.
 */
function createRotaryValve(options: RotaryValveOptions): ValveModel {
	const {
		nominalSizeInch,
		ratedKv,
		characteristic,
		rangeability,
		actuator,
		pressureRecoveryFactor,
		terminalPressureDropRatio,
		incipientCavitationSigma,
		friction,
		balanceFraction = 0,
		forceCoefficient = 0.8,
		ballOffsetFactor = 1.2,
		capacity,
		torqueCoefficient,
		closureDiameterM
	} = options;

	const radiusM = referenceRadiusM(nominalSizeInch);
	const arcLengthM = radiusM * QUARTER_TURN_RADIANS;
	const capacityOf = capacity ?? ((opening: number) => relativeCapacity(characteristic, opening, { rangeability }));

	return {
		spec: {
			id: 'rotary',
			name: 'Rotary valve',
			family: 'rotary',
			actuation: actuator ? 'pneumaticPiston' : 'manual',
			ratedKv,
			characteristic,
			rangeability,
			ports: {
				nominalSizeInch,
				portAreaM2: diameterMmToAreaM2(inchToMm(nominalSizeInch)),
				balanceSealAreaM2: diameterMmToAreaM2(inchToMm(nominalSizeInch)) * balanceFraction
			},
			pressureRecoveryFactor,
			terminalPressureDropRatio,
			incipientCavitationSigma,
			friction,
			actuator,
			suitablePhases: ['liquid', 'gas', 'steam'],
			typicalServices: [],
			summary: ''
		},
		flowCoefficient({ opening }): number {
			if (opening <= 0) return 0;
			return ratedKv * capacityOf(opening);
		},
		fluidForce(pressureDropBar, _flowToOpen, opening): number {
			// Rotary closures are geometrically symmetric about the shaft, so the
			// static pressure force produces almost no net torque. What does
			// produce torque is the asymmetry of the flow field, which is why the
			// torque is described by an empirical coefficient rather than by a
			// projected area.
			if (!torqueCoefficient || !closureDiameterM) {
				const unbalancedArea = diameterMmToAreaM2(inchToMm(nominalSizeInch)) * (1 - balanceFraction);
				return Math.abs(pressureDropBar) * 1e5 * unbalancedArea * forceCoefficient * 0.3;
			}
			const torqueNm =
				torqueCoefficient(opening) * Math.abs(pressureDropBar) * 1e5 * closureDiameterM ** 3;
			// Torque divided by the reference radius gives the tangential force the
			// actuator has to produce, in the same units as a sliding stem valve.
			return torqueNm / Math.max(radiusM, 1e-9);
		},
		closedPosition(): number {
			return 0;
		},
		openPosition(): number {
			return arcLengthM;
		},
		toOpening(positionNative: number): number {
			return Math.min(1, Math.max(0, positionNative / arcLengthM));
		},
		fromOpening(opening: number): number {
			return Math.min(1, Math.max(0, opening)) * arcLengthM;
		},
		isOnOff(): boolean {
			return false;
		}
	};
}

// ---------------------------------------------------------------------------
// Ball valve
// ---------------------------------------------------------------------------

export interface BallValveOptions {
	nominalSizeInch?: number;
	ratedKv?: number;
	/**
	 * True for a characterised ball with a V notch or a segmented ball, which is a
	 * genuine throttling trim. False for a standard full bore ball, which is an
	 * on-off valve that happens to be able to sit at part travel.
	 */
	characterised?: boolean;
	actuator?: ActuatorSpec | null;
	/**
	 * Ball radius divided by bore radius.
	 *
	 * This ratio is what decides whether a quarter turn can close the valve at all,
	 * and the geometry gives a hard lower bound. The bore opening sits at a
	 * distance sqrt(R^2 - r^2) from the ball centre, so rotating the ball by 90
	 * degrees swings that opening sideways by 2 sqrt(R^2 - r^2) at most. For the
	 * opening to clear the seat completely that swing has to reach 2r, which needs
	 * R/r to be at least sqrt(3), about 1.73.
	 *
	 * Real full bore ball valves satisfy this, which is why the ball is noticeably
	 * larger than the bore it carries. The default of 1.8 leaves a small margin so
	 * the valve is fully shut a few degrees before the end of the turn, exactly as
	 * a real ball valve seats against its stop.
	 */
	ballToBoreRatio?: number;
}

/**
 * Chord displacement of a point at radius `pivotRadius` from a rotation axis,
 * after turning through `angle`.
 *
 * This is the chord length of the arc the point travels, 2 rho sin(theta / 2).
 * Using the chord rather than the arc length is what makes the geometry correct:
 * the bore opening is a point on the ball surface, and it moves along a straight
 * chord as the ball turns, not along the arc.
 */
export function chordDisplacement(pivotRadius: number, angle: number): number {
	return 2 * pivotRadius * Math.sin(angle / 2);
}

/**
 * Ball valve: a bored sphere rotates in the seat.
 *
 * A standard ball valve is often described as having a linear characteristic,
 * but the geometry says otherwise and the geometry is easy to see. The bore
 * opening on the ball surface is a circle, the seat is a circle of about the same
 * size, and turning the ball slides one past the other. The overlap of two such
 * circles starts falling slowly and then falls very fast, so most of the capacity
 * appears in the last part of the turn and there is very little resolution near
 * closed. The practical consequence is that a standard ball valve should not be
 * used to throttle.
 *
 * A characterised ball with a V notch or a segmented ball does throttle, because
 * the notch keeps a small well defined opening as it closes. That version is
 * modelled with an equal percentage characteristic, which is what its trim
 * produces.
 *
 * Ball valves have the highest pressure recovery of the common types, which is
 * why they cavitate so readily and why they are a poor choice for a liquid
 * service with a large pressure drop.
 */
export function createBallValve(options: BallValveOptions = {}): ValveModel {
	const nominalSizeInch = options.nominalSizeInch ?? 2;
	const characterised = options.characterised ?? false;
	const ballToBoreRatio = options.ballToBoreRatio ?? 1.8;

	const boreRadiusM = inchToMm(nominalSizeInch) / 2000;

	/**
	 * Distance from the rotation axis to the bore opening, in bore radii.
	 *
	 * The bore is a chord of the ball, so its opening sits at sqrt(R^2 - r^2) from
	 * the centre, and that is the radius on which it travels as the ball turns.
	 */
	const pivotRadiusInBoreRadii = Math.sqrt(Math.max(0, ballToBoreRatio ** 2 - 1));

	const model = createRotaryValve({
		nominalSizeInch,
		ratedKv: options.ratedKv ?? 130,
		characteristic: characterised ? 'equalPercentage' : 'linear',
		rangeability: characterised ? 50 : 15,
		actuator: options.actuator ?? null,
		// Straight through bore: the highest recovery of any common valve.
		pressureRecoveryFactor: 0.65,
		terminalPressureDropRatio: 0.25,
		incipientCavitationSigma: 1.2,
		friction: FRICTION_PRESETS.ptfeLow,
		capacity: characterised
			? undefined
			: (opening: number) => {
					// A quarter turn from closed to open, so the turn angle is the
					// complement of the opening and a fully open valve has no offset
					// between the bore and the seat.
					const turnAngle = (1 - Math.min(1, Math.max(0, opening))) * QUARTER_TURN_RADIANS;
					const offsetInBoreRadii = chordDisplacement(pivotRadiusInBoreRadii, turnAngle);
					return circleOverlapFraction(offsetInBoreRadii, 1);
				}
	});

	return {
		...model,
		spec: {
			...model.spec,
			id: characterised ? 'ballCharacterised' : 'ball',
			name: characterised ? 'Characterised ball valve' : 'Ball valve',
			typicalServices: characterised
				? ['Throttling', 'Pulp and paper stock', 'Slurry', 'Viscous service']
				: ['Isolation', 'On-off', 'Quick shutoff', 'Low pressure drop'],
			summary: characterised
				? 'A ball valve with a V notch or segmented ball that keeps a defined opening as it closes, so it can be used to throttle.'
				: 'A quarter turn isolation valve. The highest pressure recovery of the common types, so it cavitates easily, and very poor resolution near closed.'
		}
	};
}

// ---------------------------------------------------------------------------
// Butterfly valve
// ---------------------------------------------------------------------------

export interface ButterflyValveOptions {
	nominalSizeInch?: number;
	ratedKv?: number;
	actuator?: ActuatorSpec | null;
	/** Disc thickness as a fraction of the bore diameter. Sets how much of the bore the disc blocks. */
	discThicknessRatio?: number;
}

/**
 * Butterfly valve: a disc rotates on a shaft that crosses the pipe.
 *
 * The butterfly is the valve where the difference between flow characteristic
 * and torque characteristic becomes impossible to ignore.
 *
 * The flow characteristic, with a standard disc, is close to equal percentage,
 * which is why a butterfly is a respectable throttling valve on large lines.
 *
 * The torque tells a different story. Because the disc is symmetrical about its
 * shaft, the static pressure force on it produces almost no net torque. What does
 * produce torque is the asymmetry of the flowing stream, and that peaks at part
 * travel, not at either extreme. The peak sits around 60 to 75 degrees open, and
 * it can be several times the torque needed to hold the valve wide open. That is
 * why a butterfly valve needs an actuator sized on its dynamic torque rather than
 * on its pressure drop, and why a butterfly that strokes fine on a bench can fail
 * to move once there is flow through it.
 */
export function createButterflyValve(options: ButterflyValveOptions = {}): ValveModel {
	const nominalSizeInch = options.nominalSizeInch ?? 6;
	const boreMm = inchToMm(nominalSizeInch);
	const discDiameterM = boreMm / 1000;

	/**
	 * Dynamic torque coefficient of a standard disc, peaking at part travel.
	 *
	 * The shape is the one used for published butterfly torque data: zero with no
	 * flow and at both extremes, peaking around 55 to 65 degrees open. The peak
	 * value of 0.07 is representative of a standard disc in a concentric valve.
	 * Treating it as empirical is the honest choice: the torque comes out of the
	 * asymmetry of the flow field, which is why manufacturers measure it rather
	 * than calculate it.
	 */
	const PEAK_TORQUE_COEFFICIENT = 0.07;
	const torqueShape = (opening: number) => {
		const angle = Math.min(1, Math.max(0, opening)) * QUARTER_TURN_RADIANS;
		const sin = Math.sin(angle);
		const cos = Math.cos(angle);
		// sin^2 cos peaks where tan^2 = 2, about 54.7 degrees, and is normalised so
		// the peak value is 1.
		const normalisation = 0.3849;
		return (sin * sin * cos) / normalisation;
	};

	const model = createRotaryValve({
		nominalSizeInch,
		ratedKv: options.ratedKv ?? 1150,
		characteristic: 'equalPercentage',
		rangeability: 40,
		actuator: options.actuator ?? null,
		// The disc sits right in the stream and the body is short, so recovery is
		// high but not as high as a ball valve.
		pressureRecoveryFactor: 0.7,
		terminalPressureDropRatio: 0.35,
		incipientCavitationSigma: 1.4,
		friction: FRICTION_PRESETS.ptfeLow,
		torqueCoefficient: (opening: number) => PEAK_TORQUE_COEFFICIENT * torqueShape(opening),
		closureDiameterM: discDiameterM
	});

	return {
		...model,
		spec: {
			...model.spec,
			id: 'butterfly',
			name: 'Butterfly valve',
			typicalServices: ['Large line isolation', 'Throttling on large lines', 'Water', 'Air and flue gas'],
			summary:
				'A disc rotating in the pipe. Compact, cheap and usable for throttling on large lines, but its dynamic torque peaks at part travel and drives the actuator size.'
		}
	};
}

// ---------------------------------------------------------------------------
// Plug valve
// ---------------------------------------------------------------------------

export interface PlugValveOptions {
	nominalSizeInch?: number;
	ratedKv?: number;
	actuator?: ActuatorSpec | null;
}

/**
 * Plug valve: a tapered or cylindrical plug with a rectangular port rotates in a
 * matching seat.
 *
 * The port is a rectangle, and it sweeps past a circular bore. The uncovered area
 * grows quickly once the corner of the port crosses the bore, so the capacity
 * curve is steeper at the start than a ball valve's. Plug valves are therefore
 * quick opening in character: usable for on-off and for coarse throttling, but
 * with poor resolution.
 *
 * Their real advantage is the seat. The plug is held against the seat by the
 * process pressure itself and the sealing surfaces wipe each other clean on every
 * stroke, so a plug valve handles slurry, fibre and dirty service that would
 * destroy a ball valve seat. That is why the lab keeps this valve in the
 * catalogue despite its poor characteristic.
 */
export function createPlugValve(options: PlugValveOptions = {}): ValveModel {
	const model = createRotaryValve({
		nominalSizeInch: options.nominalSizeInch ?? 2,
		ratedKv: options.ratedKv ?? 45,
		characteristic: 'quickOpening',
		rangeability: 10,
		actuator: options.actuator ?? null,
		pressureRecoveryFactor: 0.75,
		terminalPressureDropRatio: 0.4,
		incipientCavitationSigma: 1.6,
		friction: FRICTION_PRESETS.ptfeLow
	});

	return {
		...model,
		spec: {
			...model.spec,
			id: 'plug',
			name: 'Plug valve',
			typicalServices: ['Slurry', 'Dirty service', 'Fibrous stock', 'On-off with frequent operation'],
			summary:
				'A rotating plug with a rectangular port. Quick opening, so it throttles poorly, but the wiping seat survives dirty and fibrous service that ruins other valves.'
		}
	};
}

/** Nominal sizes the catalogue offers for the rotary valve family. */
export const ROTARY_VALVE_SIZES_INCH: readonly number[] = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12];

/**
 * Build a pneumatic piston actuator for a quarter turn valve.
 *
 * A rotary valve actuator is a piston or a rack and pinion rather than a
 * diaphragm, but the force balance is the same, so the shared actuator model
 * applies with two adjustments.
 *
 * The actuator force is expressed at the reference radius, so the stroke in the
 * shared model is the arc length the reference point travels over a quarter turn.
 * That keeps a rotary valve directly comparable with a sliding stem valve of the
 * same size, which is the comparison the lessons draw.
 *
 * A rotary actuator is also usually stiffer than a diaphragm actuator of the same
 * force, because the rack and pinion drives the shaft directly, so the bench set
 * span is wider.
 */
export function createRotaryActuator(options: {
	nominalSizeInch: number;
	/** Effective piston area, m2. */
	effectiveAreaM2?: number;
	strokeM: number;
	withPositioner?: boolean;
	failAction?: 'failClosed' | 'failOpen';
	supplyPressureBar?: number;
}): ActuatorSpec {
	const withPositioner = options.withPositioner ?? true;
	const failAction = options.failAction ?? 'failClosed';

	return {
		effectiveAreaM2: options.effectiveAreaM2 ?? 0.02,
		benchSetLowBar: psiToBar(3),
		benchSetHighBar: psiToBar(15),
		strokeM: options.strokeM,
		movingMassKg: 3,
		action: failAction === 'failClosed' ? 'airToOpen' : 'airToClose',
		hasPositioner: withPositioner,
		positionerGainBarPerM: withPositioner ? DEFAULT_POSITIONER_GAIN_BAR_PER_M : undefined,
		positionerIntegralBarPerMetrePerSecond: withPositioner
			? DEFAULT_POSITIONER_INTEGRAL_BAR_PER_M_PER_S
			: undefined,
		supplyPressureBar: options.supplyPressureBar ?? 1.4
	};
}

/** Reference radius and arc length for a quarter turn valve of a given size. */
export function quarterTurnStrokeM(nominalSizeInch: number): number {
	return referenceRadiusM(nominalSizeInch) * QUARTER_TURN_RADIANS;
}
