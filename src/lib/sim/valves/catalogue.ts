/**
 * The valve catalogue.
 *
 * Adding a valve to the lab means adding one entry here. The engine, the 3D
 * scene and the lesson UI all read from this list, so nothing else has to change
 * when a new type is added. That is the whole reason the catalogue exists as a
 * separate module rather than being scattered through the UI.
 */

import { createGateValve, createGlobeValve, createControlValve } from './linear';
import {
	createBallValve,
	createButterflyValve,
	createPlugValve,
	createRotaryActuator,
	quarterTurnStrokeM
} from './rotary';
import { createCheckValve, createReliefValve, type ReliefValveModel } from './selfActing';
import type { ValveModel } from './types';

export type ValveId =
	| 'gate'
	| 'globe'
	| 'controlValve'
	| 'ball'
	| 'ballCharacterised'
	| 'butterfly'
	| 'plug'
	| 'check-swing'
	| 'check-dualPlate'
	| 'relief';

export interface CatalogueEntry {
	id: ValveId;
	/** Build a fresh model. Models are cheap and hold no state, so a factory avoids shared mutable specs. */
	create(): ValveModel;
	/** Whether the valve responds to a control signal, which decides whether the lab shows a controller. */
	modulating: boolean;
	/** Whether the lab can command the valve at all, as opposed to it being purely self acting. */
	commandable: boolean;
}

export const VALVE_CATALOGUE: readonly CatalogueEntry[] = [
	{
		id: 'gate',
		create: () => createGateValve({ nominalSizeInch: 2, ratedKv: 130 }),
		modulating: false,
		commandable: true
	},
	{
		id: 'globe',
		create: () => createGlobeValve({ nominalSizeInch: 2, ratedKv: 40 }),
		modulating: false,
		commandable: true
	},
	{
		id: 'controlValve',
		create: () =>
			createControlValve({
				nominalSizeInch: 2,
				// Sized so the valve is about 78 percent open at the design flow of
				// the flow loop, which is how a control valve should be selected: a
				// valve that runs wide open has no room left for an increase in demand.
				ratedKv: 63,
				characteristic: 'equalPercentage',
				withPositioner: true,
				failAction: 'failClosed'
			}),
		modulating: true,
		commandable: true
	},
	{
		id: 'ball',
		create: () => createBallValve({ nominalSizeInch: 2, ratedKv: 130, characterised: false }),
		modulating: false,
		commandable: true
	},
	{
		id: 'ballCharacterised',
		create: () =>
			createBallValve({
				nominalSizeInch: 2,
				ratedKv: 90,
				characterised: true,
				actuator: createRotaryActuator({
					nominalSizeInch: 2,
					strokeM: quarterTurnStrokeM(2),
					withPositioner: true,
					failAction: 'failClosed'
				})
			}),
		modulating: true,
		commandable: true
	},
	{
		id: 'butterfly',
		create: () =>
			createButterflyValve({
				nominalSizeInch: 6,
				ratedKv: 1150,
				actuator: createRotaryActuator({
					nominalSizeInch: 6,
					// A butterfly needs a larger actuator than its size suggests,
					// because its dynamic torque peaks at part travel and can be several
					// times the torque needed to hold it wide open.
					effectiveAreaM2: 0.04,
					strokeM: quarterTurnStrokeM(6),
					withPositioner: true,
					failAction: 'failClosed'
				})
			}),
		modulating: true,
		commandable: true
	},
	{
		id: 'plug',
		create: () => createPlugValve({ nominalSizeInch: 2, ratedKv: 45 }),
		modulating: false,
		commandable: true
	},
	{
		id: 'check-swing',
		create: () => createCheckValve({ nominalSizeInch: 2, ratedKv: 130, design: 'swing' }),
		modulating: false,
		commandable: false
	},
	{
		id: 'check-dualPlate',
		create: () => createCheckValve({ nominalSizeInch: 2, ratedKv: 115, design: 'dualPlate' }),
		modulating: false,
		commandable: false
	},
	{
		id: 'relief',
		create: () =>
			createReliefValve({
				setPressureBarGauge: 10,
				blowdownFraction: 0.07,
				popAction: true
			}),
		modulating: false,
		commandable: false
	}
];

export function buildValveModel(id: ValveId): ValveModel {
	const entry = VALVE_CATALOGUE.find((candidate) => candidate.id === id);
	if (!entry) throw new Error(`Unknown valve id: ${id}`);
	return entry.create();
}

export function findCatalogueEntry(id: ValveId): CatalogueEntry | undefined {
	return VALVE_CATALOGUE.find((entry) => entry.id === id);
}

/** True when the model carries relief valve behaviour beyond the common contract. */
export function isReliefValve(model: ValveModel): model is ReliefValveModel {
	return 'liftFraction' in model && typeof (model as ReliefValveModel).liftFraction === 'function';
}

export { createGateValve, createGlobeValve, createControlValve };
export { createBallValve, createButterflyValve, createPlugValve };
export { createCheckValve, createReliefValve };
export type { ValveModel };
