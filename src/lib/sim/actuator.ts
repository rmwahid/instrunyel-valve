/**
 * Pneumatic spring-and-diaphragm actuator mechanics.
 *
 * A control valve actuator is a force balance, not a position servo. Air
 * pressure pushes the diaphragm one way, a spring pushes back, and whatever is
 * left over after friction and fluid reaction forces moves the stem. That is why
 * a valve without a positioner drifts as flow changes, and why the bench set is
 * adjusted on a test stand before the valve is installed.
 *
 * Sign convention used throughout this module: a positive force acts in the
 * direction that opens the valve. The spring of an air-to-open actuator therefore
 * produces a negative force, and the spring of an air-to-close actuator produces
 * a positive one. Keeping one convention lets the engine sum forces without
 * caring which way the actuator was built.
 *
 * Units: area m2, pressure bar, force N, travel m, spring rate N/m.
 */

import { PA_PER_BAR } from './units';

export type ActuatorAction =
	/** Air opens, spring closes. Loses air, the valve fails closed. */
	| 'airToOpen'
	/** Air closes, spring opens. Loses air, the valve fails open. */
	| 'airToClose'
	/**
	 * No actuator at all. A spring holds the closure shut and the process pushes
	 * it open. This is how a check valve and a relief valve are built: they have
	 * no signal, so the spring and the process fluid are the whole force balance.
	 */
	| 'springClosed';

export interface ActuatorSpec {
	/** Effective diaphragm or piston area, m2. A typical diaphragm case is 0.02 to 0.06 m2. */
	effectiveAreaM2: number;
	/** Air pressure at which the stem just leaves its rest position, bar gauge. */
	benchSetLowBar: number;
	/** Air pressure at which the stem reaches the other end of its travel, bar gauge. */
	benchSetHighBar: number;
	/** Total stem travel from closed to wide open, m. */
	strokeM: number;
	/** Mass of the moving parts: stem, plug, diaphragm plate, spring retainer. */
	movingMassKg: number;
	action: ActuatorAction;
	/**
	 * Spring rate in N/m. Normally derived from the bench set, which is how a
	 * real actuator is specified, so overriding it is only useful for
	 * demonstrating a wrong spring.
	 */
	springRateNPerM?: number;
	/** Viscous damping, N per m/s. Represents air and guide friction losses. */
	dampingNPerMetrePerSecond?: number;
	/**
	 * Positioner proportional gain, bar per metre of position error.
	 *
	 * A positioner senses stem position and adjusts air pressure in proportion to
	 * how far the stem is from the commanded position. A typical pneumatic
	 * positioner has a proportional band of a few percent of stroke, which is what
	 * these gains represent: a band of 5 percent over a 0.83 bar bench set span and
	 * a 0.04 m stroke is roughly 400 bar per metre.
	 */
	positionerGainBarPerM?: number;
	/**
	 * Positioner integral rate, bar per metre of position error per second.
	 *
	 * The integral term is what lets the positioner remove the last of the error
	 * and hold the valve shut against a fluid force. Proportional action alone
	 * leaves a standing offset proportional to the unbalance force, and on a valve
	 * with a high pressure drop that offset is enough to stop it seating. Real
	 * positioners, pneumatic and digital alike, have integral action for exactly
	 * this reason.
	 */
	positionerIntegralBarPerMetrePerSecond?: number;
	/**
	 * Band around the commanded position inside which the positioner stops
	 * correcting, in metres.
	 *
	 * A real positioner has a small deadband of its own from the nozzle and
	 * flapper. Modelling it stops the pressure from hunting indefinitely around a
	 * position it can never hit exactly, and it is small enough to be negligible
	 * for the accuracy the lab demonstrates.
	 */
	positionerDeadbandM?: number;
	/** True when the model includes a positioner, for display and lesson text. */
	hasPositioner?: boolean;
	/**
	 * Instrument air supply pressure, bar gauge.
	 *
	 * A positioner can only correct a position error by adding or dumping air, so
	 * its authority is bounded by the supply. Supply pressure is what limits how
	 * stiff a positioner can make an actuator, and it is the reason a valve that
	 * is correctly sized on paper can still fail to stroke fully on site.
	 */
	supplyPressureBar?: number;
	/**
	 * Extra force a spring must apply at the seat, N. Used by self acting valves
	 * where the spring provides the seat tightness that keeps the valve shut.
	 */
	seatForceN?: number;
	/**
	 * Pressure difference at which a self acting valve begins to open, bar.
	 * Only meaningful when the action is springClosed.
	 */
	crackingPressureBar?: number;
	/**
	 * Pressure difference at which a self acting valve reaches full travel, bar.
	 */
	fullTravelPressureBar?: number;
	/**
	 * Dead volume of the diaphragm case when the stem is at the end of its travel
	 * closest to the air connection, m3. A typical diaphragm case is a few litres.
	 */
	caseDeadVolumeM3?: number;
	/**
	 * Conductance of the air path into and out of the diaphragm case, kg/(s Pa).
	 *
	 * This is the property that decides how fast the valve strokes, and it is the
	 * single biggest omission in a simulation that treats an actuator as an
	 * instant position source. The positioner feeds air through a fixed
	 * restriction, so the case pressure cannot follow the command instantly, and
	 * the resulting fill time is what a datasheet quotes as stroke time.
	 */
	airConductanceKgPerSecondPa?: number;
	/** Air temperature in the case, K. Treated as constant, see the note in stepActuatorCase. */
	airTemperatureK?: number;
}

/** Default instrument air supply, the common 20 psi header. */
export const DEFAULT_SUPPLY_PRESSURE_BAR = 1.4;

/**
 * Mechanical damping of the moving parts, N per m/s.
 *
 * Small on purpose. The dominant damping in a pneumatic actuator comes from the
 * air in the case resisting the change in volume, which `stepActuatorCase`
 * models. What is left here is guide and bearing friction, which is a minor
 * effect and would be double counting if it were set large.
 */
export const DEFAULT_DAMPING_N_PER_MPS = 150;

/**
 * Spring rate implied by the bench set.
 *
 * Between the two bench set pressures the spring must absorb the full change in
 * diaphragm force over the stroke, so k = A * (P_high - P_low) / stroke.
 */
export function springRateNPerM(spec: ActuatorSpec): number {
	if (spec.springRateNPerM !== undefined) return spec.springRateNPerM;
	const pressureSpanPa = (spec.benchSetHighBar - spec.benchSetLowBar) * PA_PER_BAR;
	if (spec.strokeM <= 0) return 0;
	return (spec.effectiveAreaM2 * pressureSpanPa) / spec.strokeM;
}

/**
 * Spring preload compression in metres, meaning the compression the spring
 * carries at the rest position of the actuator.
 *
 * For an air-to-open actuator the rest position is closed, and the low bench set
 * pressure balances the preload exactly: A * P_low = k * x0. The same expression
 * applies to an air-to-close actuator, whose rest position is fully open for the
 * opposite reason.
 */
export function springPreloadM(spec: ActuatorSpec): number {
	const k = springRateNPerM(spec);
	if (k <= 0) return 0;
	return (spec.effectiveAreaM2 * spec.benchSetLowBar * PA_PER_BAR) / k;
}

/**
 * Spring force in newtons, signed in the opening direction.
 *
 * For an air-to-open actuator the spring closes, so the force is negative and
 * grows more negative as the valve opens and the spring compresses further. For
 * an air-to-close actuator the spring opens, so the force is positive and falls
 * as the valve opens and the spring relaxes.
 */
export function springForceN(spec: ActuatorSpec, positionM: number): number {
	const k = springRateNPerM(spec);
	const preload = springPreloadM(spec);
	if (k <= 0) return 0;

	// Compression relative to the relaxed spring. An air-to-open spring is
	// compressed further by opening; an air-to-close spring is compressed further
	// by closing, so its travel term runs the other way.
	const compression =
		spec.action === 'airToClose'
			? preload + (spec.strokeM - positionM)
			: preload + positionM;

	const magnitude = k * compression;
	return spec.action === 'airToClose' ? magnitude : -magnitude;
}

/** Diaphragm force in newtons for a gauge air pressure, signed in the opening direction. */
export function airForceN(spec: ActuatorSpec, pressureBar: number): number {
	if (spec.action === 'springClosed') return 0;
	const magnitude = spec.effectiveAreaM2 * Math.max(0, pressureBar) * PA_PER_BAR;
	return spec.action === 'airToOpen' ? magnitude : -magnitude;
}

/**
 * Net force pushing the stem open, excluding friction and fluid reaction.
 * Positive accelerates the stem toward open.
 *
 * A correct bench set makes this zero at both ends of the travel when the air
 * pressure is at the corresponding bench set value, which is exactly what the
 * bench set is for.
 */
export function netSpringAirForceN(
	spec: ActuatorSpec,
	pressureBar: number,
	positionM: number
): number {
	return springForceN(spec, positionM) + airForceN(spec, pressureBar);
}

/**
 * The bench set line: the stem position the spring and air pressure alone would
 * settle at, ignoring friction and fluid forces.
 *
 * For an air-to-open actuator a rising pressure opens the valve. For an
 * air-to-close actuator the same rising pressure closes it, so the travel runs
 * the other way. Both reach the ends of the stroke at the same two pressures,
 * which is what the bench set describes.
 */
export function positionFromPressure(spec: ActuatorSpec, pressureBar: number): number {
	if (spec.action === 'springClosed') return 0;
	const span = spec.benchSetHighBar - spec.benchSetLowBar;
	if (span === 0) return 0;

	const fraction = Math.min(1, Math.max(0, (pressureBar - spec.benchSetLowBar) / span));
	const travel = spec.action === 'airToOpen' ? fraction : 1 - fraction;
	return travel * spec.strokeM;
}

/** Air pressure that holds the stem at the given position, ignoring friction and fluid forces. */
export function pressureFromPosition(spec: ActuatorSpec, positionM: number): number {
	const span = spec.benchSetHighBar - spec.benchSetLowBar;
	const fraction = spec.strokeM > 0 ? Math.min(1, Math.max(0, positionM / spec.strokeM)) : 0;
	const travel = spec.action === 'airToOpen' ? fraction : 1 - fraction;
	return spec.benchSetLowBar + travel * span;
}

/** Travel as a fraction of full stroke, clamped to the mechanical stops. */
export function travelFraction(spec: ActuatorSpec, positionM: number): number {
	if (spec.strokeM <= 0) return 0;
	return Math.min(1, Math.max(0, positionM / spec.strokeM));
}

/**
 * Seat load: the extra force the actuator applies to the plug after the plug has
 * already reached the seat.
 *
 * Seat load is what makes a control valve actually shut off against upstream
 * pressure. It only exists once the plug is seated, and only in the closing
 * direction, so a negative net force at zero travel is what produces it.
 */
export function seatLoadN(spec: ActuatorSpec, pressureBar: number, positionM: number): number {
	if (positionM > 1e-6) return 0;
	const net = netSpringAirForceN(spec, pressureBar, 0);
	// A positive net means the spring and air are still pushing the valve open,
	// which cannot happen once the plug is seated, so there is no seat load.
	return net < 0 ? -net : 0;
}

export interface UnbalanceInput {
	/** Pressure drop across the plug, bar. */
	pressureDropBar: number;
	/** Area of the port the plug closes against, m2. */
	portAreaM2: number;
	/** Area of the balance seal, m2. Zero for an unbalanced plug. */
	balanceSealAreaM2?: number;
	/**
	 * Flow direction. Flow to open enters below the plug and pushes it open;
	 * flow to close enters from above and pushes it shut.
	 */
	flowDirection?: 'flowToOpen' | 'flowToClose';
	/**
	 * Fraction of the theoretical unbalance that actually reaches the stem,
	 * accounting for the jet angle and plug shape. Around 0.5 to 1.0 in practice.
	 */
	forceCoefficient?: number;
}

/**
 * Fluid reaction force on the plug, in newtons, signed in the opening direction.
 *
 * The plug obstructs a jet, so the pressure drop acts on the unbalanced area.
 * Balancing the plug with a seal removes most of that area, which is why large
 * high pressure drop valves use balanced trim and a smaller actuator.
 */
export function unbalanceForceN(input: UnbalanceInput): number {
	const balanceSealAreaM2 = input.balanceSealAreaM2 ?? 0;
	const forceCoefficient = input.forceCoefficient ?? 0.8;
	const flowDirection = input.flowDirection ?? 'flowToOpen';

	const unbalancedAreaM2 = Math.max(0, input.portAreaM2 - balanceSealAreaM2);
	const magnitude =
		Math.abs(input.pressureDropBar) * PA_PER_BAR * unbalancedAreaM2 * forceCoefficient;

	return flowDirection === 'flowToOpen' ? magnitude : -magnitude;
}

/**
 * Actuator sizing helper: the diaphragm area needed to stroke a valve against a
 * given shutoff pressure drop with a stated spring rate.
 *
 * Used by the lessons to show why a high pressure drop service needs a bigger
 * actuator or balanced trim.
 */
export function requiredAreaForShutoffM2(
	shutoffPressureDropBar: number,
	portAreaM2: number,
	springForceAtSeatN: number,
	forceCoefficient = 0.8
): number {
	if (shutoffPressureDropBar <= 0) return 0;
	const fluidForce = shutoffPressureDropBar * PA_PER_BAR * portAreaM2 * forceCoefficient;
	const totalForce = fluidForce + springForceAtSeatN;
	// Assume the available supply pressure is twice the high bench set, a common
	// practical allowance so the actuator is not asked to work at its limit.
	return totalForce / (2 * PA_PER_BAR);
}

/**
 * Positioner defaults, chosen to reproduce a pneumatic positioner with a
 * proportional band of roughly 1 percent of stroke and modest integral action.
 *
 * Typical published positioner accuracy is 0.5 to 1 percent of stroke, so a
 * proportional band of 1 percent is the right order: over a 0.02 m error the
 * proportional term alone saturates the pressure against its supply limit, and
 * the valve then strokes as fast as the air can fill the case.
 *
 * The integral term is what makes the valve accurate rather than merely
 * responsive. It keeps trimming the pressure until the position error is gone,
 * which is what allows the valve to seat against a fluid force. Without it the
 * positioner would leave a standing offset proportional to the pressure drop, and
 * a valve on a high pressure drop service would visibly fail to shut off. Real
 * positioners have integral action for exactly this reason.
 *
 * The integral rate is deliberately slower than the air case fill rate. An
 * integral term faster than the actuator can respond will hunt, which is a real
 * tuning fault on a real positioner and not something to make the default.
 */
export const DEFAULT_POSITIONER_GAIN_BAR_PER_M = 800;
export const DEFAULT_POSITIONER_INTEGRAL_BAR_PER_M_PER_S = 120;
export const DEFAULT_POSITIONER_DEADBAND_M = 5e-6;

export interface PositionerState {
	/** Air pressure the positioner is currently asking for, bar gauge. */
	outputBar: number;
	/**
	 * Accumulated integral contribution to the pressure, bar.
	 *
	 * Held as a separate term rather than folded into `outputBar` so that the
	 * proportional part can be recomputed from the current error each step while
	 * the integral part persists. That separation is what lets the positioner
	 * remove a standing error, which is the whole reason it has integral action.
	 */
	integralBar: number;
}

export function createPositionerState(initialPressureBar = 0): PositionerState {
	return { outputBar: Math.max(0, initialPressureBar), integralBar: 0 };
}

/**
 * Advance the valve positioner by one step.
 *
 * The positioner compares the commanded stem position with the actual stem
 * position and adjusts the air pressure by a proportional plus integral law:
 *
 *     position_command  = command fraction * stroke
 *     error             = position_command - position_actual
 *     p                 = p_IP + Kp e + Ki integral(e dt)
 *
 * The setpoint is the commanded *fraction* of stroke rather than the position the
 * bench set pressure would give. That is how a real positioner is set up: it is
 * calibrated with a cam and zero and span adjustments so that the full input
 * signal range maps onto the full stroke, whatever the actuator's bench set
 * happens to be. Using the bench set pressure as the setpoint instead would make
 * the valve stop short of full travel whenever the I/P span and the bench set
 * span disagree, which is a calibration detail rather than the behaviour worth
 * teaching.
 *
 * The proportional term gives speed: a position error immediately moves the
 * pressure, so the valve strokes as fast as its air supply allows. The integral
 * term gives accuracy: it keeps accumulating until the error is gone, which is
 * what allows the valve to seat against a fluid force and hold position against
 * packing friction. A positioner without integral action leaves a standing offset
 * proportional to the unbalance force, so a valve on a high pressure drop service
 * would visibly fail to shut off. This is why real positioners, pneumatic and
 * digital alike, include it.
 *
 * The pressure is bounded by atmosphere below and the instrument air supply
 * above, because a positioner has no other source of pressure. That upper bound
 * is a genuine cause of a valve failing to reach full travel on site, so it is
 * modelled rather than hidden.
 *
 * Anti-windup matters here for the same reason it does in a process controller:
 * while the pressure is against a limit, accumulating more integral would leave
 * the positioner unable to come back when the error reverses.
 */
export function stepPositioner(
	spec: ActuatorSpec,
	state: PositionerState,
	commandFraction: number,
	ipPressureBar: number,
	positionM: number,
	dtSeconds: number
): PositionerState {
	if (!spec.hasPositioner || !spec.positionerGainBarPerM) {
		return { outputBar: Math.max(0, ipPressureBar), integralBar: 0 };
	}

	const clampedFraction = Math.min(1, Math.max(0, commandFraction));
	const commandPositionM = clampedFraction * spec.strokeM;
	const errorM = commandPositionM - positionM;
	const deadbandM = spec.positionerDeadbandM ?? DEFAULT_POSITIONER_DEADBAND_M;
	const supplyPressureBar = spec.supplyPressureBar ?? DEFAULT_SUPPLY_PRESSURE_BAR;

	// Inside the deadband the positioner stops trimming and holds what it has,
	// which is what a real nozzle and flapper does.
	if (Math.abs(errorM) <= deadbandM) {
		return state;
	}

	const proportionalBar = spec.positionerGainBarPerM * errorM;
	const integralRate = spec.positionerIntegralBarPerMetrePerSecond ?? 0;
	const integralDelta = integralRate * errorM * dtSeconds;

	// The proportional term is measured from the positioner's own I/P output, so a
	// drifting I/P calibration shifts the pressure the positioner works around.
	// The integral term then trims that shift away, which is why fitting a
	// positioner hides an I/P calibration error but cannot hide a wrong bench set.
	const basePressureBar = Math.max(0, ipPressureBar);
	const unclampedBar = basePressureBar + proportionalBar + state.integralBar + integralDelta;

	// Anti-windup: only accumulate while doing so would not push the pressure
	// further into a limit.
	const pushingHigh = unclampedBar > supplyPressureBar && integralDelta > 0;
	const pushingLow = unclampedBar < 0 && integralDelta < 0;
	const integralBar =
		pushingHigh || pushingLow ? state.integralBar : state.integralBar + integralDelta;

	const outputBar = Math.min(
		supplyPressureBar,
		Math.max(0, basePressureBar + proportionalBar + integralBar)
	);

	return { outputBar, integralBar };
}

/** Specific gas constant of air, J/(kg K). */
export const AIR_GAS_CONSTANT = 287;

/**
 * Dead volume of the diaphragm case at its smallest, m3.
 *
 * A 300 cm2 case with roughly 6 cm of internal height holds about 2 litres. The
 * value matters more than it looks: the case volume divided by the conductance
 * sets the fill time constant, and the displacement volume of the stroke is
 * comparable to it, which is what makes the actuator pneumatically self damping.
 */
export const DEFAULT_CASE_DEAD_VOLUME_M3 = 0.002;

export const DEFAULT_AIR_TEMPERATURE_K = 293.15;

/**
 * Conductance of the air path into the diaphragm case, kg/(s Pa).
 *
 * With the default 2 litre case this gives a fill time constant near 0.3 s, which
 * is the order of magnitude of a real spring diaphragm actuator. A positioner
 * restricts the flow deliberately, because a case that filled instantly would let
 * the stem slam into its seat.
 */
export const DEFAULT_AIR_CONDUCTANCE_KG_PER_S_PA = 8e-8;

export interface ActuatorCaseState {
	/**
	 * Absolute pressure in the diaphragm case, bar.
	 *
	 * This is a state rather than an algebraic function of the command because the
	 * case has to be filled and emptied through a restriction, and because the stem
	 * changes the volume as it moves.
	 */
	pressureBar: number;
}

/**
 * Cavity height of the diaphragm case for a given stem position, m.
 *
 * Air pushes the diaphragm toward the spring side, so the cavity the air occupies
 * grows as an air-to-open valve opens and shrinks as an air-to-close valve closes.
 * This is why the two actions fill at different rates.
 */
export function caseCavityHeightM(spec: ActuatorSpec, positionM: number): number {
	const clamped = Math.min(spec.strokeM, Math.max(0, positionM));
	return spec.action === 'airToClose' ? spec.strokeM - clamped : clamped;
}

/** Volume of air in the diaphragm case at a given stem position, m3. */
export function caseVolumeM3(spec: ActuatorSpec, positionM: number): number {
	const deadVolumeM3 = spec.caseDeadVolumeM3 ?? DEFAULT_CASE_DEAD_VOLUME_M3;
	return Math.max(1e-6, deadVolumeM3 + spec.effectiveAreaM2 * caseCavityHeightM(spec, positionM));
}

export function createActuatorCaseState(
	spec: ActuatorSpec,
	commandPressureBar: number
): ActuatorCaseState {
	const atmosphericBar = 1.01325;
	void spec;
	return { pressureBar: Math.max(0, commandPressureBar) + atmosphericBar };
}

/**
 * Advance the air in the diaphragm case through the supply restriction by one
 * step, holding the stem still.
 *
 * The exact first order discretisation is used so a coarse time step cannot make
 * the pressure overshoot its target. Called on its own by the mechanism
 * integrator, which holds the stem fixed within each mechanical sub step.
 */
export function fillActuatorCase(
	spec: ActuatorSpec,
	state: ActuatorCaseState,
	commandPressureBar: number,
	positionM: number,
	dtSeconds: number
): ActuatorCaseState {
	if (dtSeconds <= 0) return state;

	const conductance = spec.airConductanceKgPerSecondPa ?? DEFAULT_AIR_CONDUCTANCE_KG_PER_S_PA;
	const temperatureK = spec.airTemperatureK ?? DEFAULT_AIR_TEMPERATURE_K;
	const volumeM3 = caseVolumeM3(spec, positionM);

	const fillTimeConstant = volumeM3 / (conductance * AIR_GAS_CONSTANT * temperatureK);
	const fillAlpha = 1 - Math.exp(-dtSeconds / Math.max(1e-9, fillTimeConstant));
	const targetPressureBar = Math.max(0, commandPressureBar) + 1.01325;

	return {
		pressureBar: state.pressureBar + (targetPressureBar - state.pressureBar) * fillAlpha
	};
}

/**
 * Apply the pressure change caused by the diaphragm moving.
 *
 * Air is treated as isothermal, so pressure times volume is conserved while the
 * stem moves: a stem that opens an air-to-open valve expands the case and the
 * pressure falls.
 *
 * This term is what makes a pneumatic actuator behave the way it does, and it is
 * worth being explicit about why. Its derivative with respect to position is a
 * negative stiffness of magnitude p A^2 / V. For a 300 cm2 actuator with a 2 litre
 * case at 2 bar absolute that is roughly 60000 N/m, which is the same order as the
 * mechanical spring. The two therefore very nearly cancel, and the actuator is far
 * softer than the spring alone would suggest. That softness is also the damping:
 * a stem that tries to move quickly has to move air that is arriving through a
 * restriction, so the pressure sags and the driving force falls with it.
 *
 * Getting this term wrong is not a small error. Without it the actuator is a stiff
 * spring mass system that slams from seat to full travel in a single step, which
 * is not how any real control valve behaves.
 */
export function applyCaseVolumeChange(
	spec: ActuatorSpec,
	state: ActuatorCaseState,
	previousPositionM: number,
	positionM: number
): ActuatorCaseState {
	const volumeBeforeM3 = caseVolumeM3(spec, previousPositionM);
	const volumeAfterM3 = caseVolumeM3(spec, positionM);
	if (volumeBeforeM3 === volumeAfterM3) return state;

	const supplyPressureBar = spec.supplyPressureBar ?? DEFAULT_SUPPLY_PRESSURE_BAR;
	const upperBoundBar = supplyPressureBar + 1.01325;

	return {
		pressureBar: Math.min(
			upperBoundBar,
			// The case cannot be pumped below vacuum by its own expansion.
			Math.max(0.01, state.pressureBar * (volumeBeforeM3 / volumeAfterM3))
		)
	};
}

/**
 * Advance the case by one step with the stem held at a fixed position.
 *
 * A convenience composition of the two effects for callers that do not integrate
 * the stem themselves. The engine uses the two halves separately because it
 * sub steps the mechanism.
 */
export function stepActuatorCase(
	spec: ActuatorSpec,
	state: ActuatorCaseState,
	commandPressureBar: number,
	positionM: number,
	dtSeconds: number
): ActuatorCaseState {
	return fillActuatorCase(spec, state, commandPressureBar, positionM, dtSeconds);
}

/** Gauge pressure in the diaphragm case, bar. */
export function caseGaugePressureBar(state: ActuatorCaseState): number {
	return state.pressureBar - 1.01325;
}

/** Describe an actuator the way a datasheet would. */
export function describeActuator(spec: ActuatorSpec): string {
	const size = Math.round(spec.effectiveAreaM2 * 1e4);
	const stroke = Math.round(spec.strokeM * 1000);

	switch (spec.action) {
		case 'airToOpen':
			return `${size} cm2 air to open, fail closed, ${stroke} mm stroke, bench set ${spec.benchSetLowBar.toFixed(2)} to ${spec.benchSetHighBar.toFixed(2)} bar${spec.hasPositioner ? ', with positioner' : ', without positioner'}`;
		case 'airToClose':
			return `${size} cm2 air to close, fail open, ${stroke} mm stroke, bench set ${spec.benchSetLowBar.toFixed(2)} to ${spec.benchSetHighBar.toFixed(2)} bar${spec.hasPositioner ? ', with positioner' : ', without positioner'}`;
		case 'springClosed':
			return `${size} cm2 self acting, spring closed, ${stroke} mm stroke`;
	}
}

/**
 * Build a self acting actuator for a check valve or relief valve.
 *
 * There is no air signal, so the bench set is meaningless. What matters is the
 * pressure difference that cracks the valve open and the one that reaches full
 * travel, plus the force the spring keeps on the seat to seal it.
 */
export function selfActingActuator(options: {
	effectiveAreaM2: number;
	strokeM: number;
	movingMassKg: number;
	crackingPressureBar: number;
	fullTravelPressureBar: number;
	seatForceN?: number;
	springRateNPerM?: number;
}): ActuatorSpec {
	return {
		effectiveAreaM2: options.effectiveAreaM2,
		benchSetLowBar: 0,
		benchSetHighBar: 0,
		strokeM: options.strokeM,
		movingMassKg: options.movingMassKg,
		action: 'springClosed',
		springRateNPerM: options.springRateNPerM,
		seatForceN: options.seatForceN ?? 0,
		crackingPressureBar: options.crackingPressureBar,
		fullTravelPressureBar: options.fullTravelPressureBar
	};
}

/**
 * Opening fraction of a self acting valve for a given pressure difference.
 *
 * The closure is held shut by the spring and pushed open by the process. Once
 * the pressure difference passes the cracking value the spring starts to yield,
 * and by the full travel value it has yielded completely. The linear ramp between
 * the two is the spring characteristic, which is exactly what it is.
 *
 * A reversed pressure difference always drives the valve shut, because the
 * process force has changed sign and the spring is now being helped.
 */
export function selfActingOpening(
	spec: ActuatorSpec,
	pressureDifferenceBar: number
): number {
	const cracking = spec.crackingPressureBar ?? 0;
	const fullTravel = spec.fullTravelPressureBar ?? cracking;
	if (pressureDifferenceBar <= cracking) return 0;
	if (fullTravel <= cracking) return 1;
	return Math.min(1, Math.max(0, (pressureDifferenceBar - cracking) / (fullTravel - cracking)));
}
