/**
 * Lesson content for each valve in the catalogue.
 *
 * The lessons are data rather than markup so the same content can be rendered in
 * the side panel, searched, or exported without touching a component. Each valve
 * carries the same shape: what it is, how it works, what its numbers mean, and
 * what it is actually used for.
 *
 * The writing aims at the level of a first instrumentation course, and every
 * claim here is one the simulation actually reproduces, so a student can check
 * the statement against the model.
 */

import type { ValveId } from '$lib/sim/valves/catalogue';

export interface LessonSection {
	heading: string;
	body: string;
}

export interface Lesson {
	id: ValveId;
	/** One line that captures the valve in a sentence. */
	tagline: string;
	sections: LessonSection[];
	/** Ideas worth remembering, shown as a short list. */
	keyPoints: string[];
	/** Where this valve is the right choice. */
	applications: string[];
	/** Where it is the wrong choice, and why. */
	limitations: string[];
}

export const LESSONS: Record<ValveId, Lesson> = {
	gate: {
		id: 'gate',
		tagline: 'A sliding disc that isolates a line with almost no pressure drop.',
		sections: [
			{
				heading: 'How it works',
				body: 'A flat disc slides across the flow path on a stem. When it is fully raised the disc sits clear of the bore and the flow path is straight through, so a gate valve wide open drops very little pressure: often less than a tenth of what a globe valve of the same size would drop. That is the gate valve at its best.'
			},
			{
				heading: 'Why it must not throttle',
				body: 'The disc is only supported where the stem meets it, and it hangs in the flow like a flag. At part travel the flowing liquid sets it vibrating against the seat, and the vibration erodes both the disc and the seat faces. The damage is not gradual and invisible: a throttled gate valve can be destroyed in a matter of weeks. This is why the linear capacity curve the model shows is a statement about geometry and not a recommendation.'
			},
			{
				heading: 'What the numbers say',
				body: 'The disc carries the full bore area and nothing balances it, so a gate valve has the largest stem unbalance of the common types. A 50 mm gate valve holding back 10 bar pushes roughly 2000 N onto its stem. At that load a handwheel becomes impractical and the valve needs a gearbox, a motor, or a bypass line to equalise the pressure before it is opened.'
			}
		],
		keyPoints: [
			'Straight through flow path, so almost no pressure drop when wide open.',
			'The disc is unsupported at part travel and vibrates, so throttling destroys it.',
			'Largest stem unbalance of the common valve types.',
			'Not suitable for throttling, no matter how useful its capacity curve looks.'
		],
		applications: [
			'Isolation on water, steam and gas lines',
			'Block valve either side of a control valve',
			'Tank outlet where a bubble tight seal is not required',
			'Bypass around equipment that must be taken out of service'
		],
		limitations: [
			'Throttling service: the disc vibrates and erodes the seat',
			'Frequent operation: the long stem travel is slow to operate',
			'Slurry and fibrous service: solids collect in the seat pocket',
			'Where a bubble tight shutoff is required, since metal seats leak slightly'
		]
	},

	globe: {
		id: 'globe',
		tagline: 'A tortuous path that trades pressure drop for controllability.',
		sections: [
			{
				heading: 'How it works',
				body: 'The fluid enters below the plug, turns through an S shaped passage, passes the seat and turns again to leave. Those two turns do real work: they destroy kinetic energy that a straight through valve would have recovered. Energy destroyed is pressure lost, and that is the point. A throttling valve needs pressure drop to work against, so a valve that wastes pressure drop is a valve that can control flow.'
			},
			{
				heading: 'Pressure recovery and cavitation',
				body: 'As liquid squeezes past the seat it accelerates and its pressure falls. The lowest pressure is not at the seat but just downstream, at the vena contracta, where the jet is narrowest. How far the pressure falls depends on how much of the kinetic energy the body recovers as the jet expands again. A globe body recovers little, so the vena contracta pressure stays high and cavitation is unlikely. A straight through valve recovers a lot, so its vena contracta pressure drops much further and it cavitates at a pressure drop the globe valve handles comfortably.'
			},
			{
				heading: 'Maintenance',
				body: 'The seat and plug are reached by lifting the bonnet, without removing the body from the line. On a plant where valves are maintained in place rather than in a workshop, that alone decides the choice for a throttling duty.'
			}
		],
		keyPoints: [
			'Low pressure recovery means it resists cavitation.',
			'The price is a pressure drop several times that of a gate valve when wide open.',
			'The seat and plug can be serviced without cutting the body out of the line.',
			'The standard throttling valve on small lines and high pressure drop service.'
		],
		applications: [
			'Throttling and flow regulation',
			'Steam service, where the pressure drop is high and cavitation is a risk',
			'Small line sizes where a control valve is not justified',
			'Manual bypass regulation around a control valve'
		],
		limitations: [
			'High pressure drop makes it a poor isolation valve on an energy conscious plant',
			'Slurry service, where the S passage blocks',
			'Where a full bore is needed for pigging or cleaning'
		]
	},

	controlValve: {
		id: 'controlValve',
		tagline: 'The modulating valve at the centre of a control loop.',
		sections: [
			{
				heading: 'What makes it different',
				body: 'A control valve is a globe valve with three additions: a plug shaped to give a chosen characteristic, a spring and diaphragm actuator sized to move it against the process, and usually a positioner. The first two make it possible to hold the valve at an arbitrary position. The third is what makes it actually stay there.'
			},
			{
				heading: 'The force balance',
				body: 'The actuator is not a position servo, it is a force balance. Air pressure pushes the diaphragm one way, a spring pushes back, and the stem goes wherever the leftover force takes it. Three things disturb that balance: the pressure drop across the plug, which changes as the flow changes; the packing friction, which holds the stem until enough force builds up to break it away; and the spring itself, whose force varies with position by design. The controller asks for a position through a 4-20 mA signal. The actuator delivers a force. Those two are not the same thing, and everything a control valve engineer worries about lives in the gap.'
			},
			{
				heading: 'What the positioner adds',
				body: 'A positioner measures the actual stem position and trims the air pressure until it matches the command. That closes the loop on the valve itself, before the process loop even sees it. The effects are large: a positioned valve follows its command to a fraction of a percent, holds position against packing friction, and seats against the fluid force when it is told to close. Without a positioner the same valve sits wherever the force balance leaves it, which on a high pressure drop service can be several percent away from the command, and it will not shut off completely.'
			},
			{
				heading: 'Choosing the characteristic',
				body: 'The installed characteristic is what the loop sees, and the valve authority decides how far it departs from the inherent curve. If the valve owns most of the pressure drop, the drop across it barely changes with flow and the installed curve matches the inherent one, so a linear trim gives a constant loop gain. If the valve owns only a small share, its pressure drop collapses as the flow rises, which steepens a linear trim badly; an equal percentage trim is shaped to cancel exactly that. This is why equal percentage is the usual choice and linear is the specialist choice, and not the other way round.'
			}
		],
		keyPoints: [
			'The actuator is a force balance, not a position servo.',
			'Fluid force on the plug changes with pressure drop, so position depends on the process.',
			'Packing friction causes deadband: the valve sticks, then jumps.',
			'A positioner is what makes the valve accurate, and what allows it to shut off completely.',
			'Characteristic and valve authority together decide the loop gain.'
		],
		applications: [
			'Flow, pressure, level and temperature control loops',
			'Any duty where the valve must sit at a commanded position',
			'Steam and high pressure drop service, with the right trim',
			'Loops where turndown matters, using an equal percentage trim'
		],
		limitations: [
			'Needs instrument air, so a plant without an air system cannot use one',
			'Loses its position on air failure, so the fail direction has to be chosen deliberately',
			'Costs more than a manual valve and needs routine calibration',
			'A positioner can hide an I/P calibration fault, which delays finding it'
		]
	},

	ball: {
		id: 'ball',
		tagline: 'A bored sphere that isolates a line with a quarter turn.',
		sections: [
			{
				heading: 'How it works',
				body: 'A sphere with a bore through it sits between two seat rings. Turn the ball a quarter turn and the bore swings from aligned with the pipe to across it. The motion is quick, the seal is positive, and the flow path when open is a straight bore, so the pressure drop is the lowest of any common valve.'
			},
			{
				heading: 'Why the capacity curve is not linear',
				body: 'The bore opening on the ball surface is a circle, and it slides past a seat that is also a circle. The area through which fluid can pass is the overlap of the two, which falls slowly at first and then very fast. At a quarter of the turn there is only a sliver open and the valve passes a few percent of its capacity. By three quarters of the turn most of the capacity is there. The practical consequence is that a standard ball valve has almost no resolution where a control loop would need it: below half travel the flow barely changes, above it the flow changes far too much.'
			},
			{
				heading: 'Cavitation',
				body: 'The straight bore recovers most of the kinetic energy of the jet, so the pressure at the vena contracta drops further than in any other common valve. That means a ball valve cavitates at a smaller pressure drop than a globe or gate valve of the same size, and it is a poor choice for a liquid service with a large pressure drop. On a gas service the same recovery makes it choke earlier too, so its capacity is lower than its bore suggests.'
			}
		],
		keyPoints: [
			'Quarter turn operation, which makes it fast and easy to automate.',
			'Lowest pressure drop of the common types when wide open.',
			'Highest pressure recovery, so it cavitates easily.',
			'Capacity curve gives almost no resolution below half travel.',
			'A standard ball valve is an isolation valve, not a throttling valve.'
		],
		applications: [
			'On-off isolation on clean liquid and gas service',
			'Quick shutoff where a quarter turn is an advantage',
			'Emergency isolation, since it can be automated cheaply',
			'Lines where pressure drop must be kept to a minimum'
		],
		limitations: [
			'Throttling: the capacity curve is unusable for control',
			'Cavitating liquid service with a high pressure drop',
			'Slurry and fibrous service, where solids score the seats',
			'High temperature service, since soft seats have a temperature limit'
		]
	},

	ballCharacterised: {
		id: 'ballCharacterised',
		tagline: 'A ball valve with a V notch that can actually throttle.',
		sections: [
			{
				heading: 'The change that makes it work',
				body: 'Replace the round bore with a V shaped notch and the geometry changes completely. As the ball turns, the notch presents a small, well defined triangular opening that grows steadily rather than a sliver of a circle that grows explosively. The result is a capacity curve close to equal percentage, which is the shape a throttling valve wants.'
			},
			{
				heading: 'Why it is used',
				body: 'A characterised ball valve combines the quarter turn actuator, the straight through low pressure drop and the wiping seat of a ball valve with a usable control characteristic. On large lines, where a globe control valve would be heavy and expensive, and on fibrous or viscous service, where a globe valve would block, that combination is often the only one that works.'
			},
			{
				heading: 'The trade',
				body: 'It still has the high pressure recovery of a ball valve, so cavitation remains a consideration on liquid service with a large pressure drop. The notch also has to be matched to the duty: a V notch trim sized on a clean liquid will not pass the same flow on a high consistency stock, because the fibres behave differently from the water the sizing was done for.'
			}
		],
		keyPoints: [
			'The V notch turns an unusable capacity curve into an equal percentage one.',
			'Combines quarter turn actuation with a usable control characteristic.',
			'Still has high pressure recovery, so cavitation must be checked.',
			'The usual choice for throttling slurry, stock and viscous service.'
		],
		applications: [
			'Throttling on large lines where a globe valve would be too heavy',
			'Pulp and paper stock, where a globe valve would block',
			'Slurry and viscous service',
			'Retrofit of an existing ball valve installation that needs to control flow'
		],
		limitations: [
			'Cavitation on high pressure drop liquid service',
			'Cost compared with a standard ball valve',
			'The notch is sensitive to the fluid, so sizing must account for the actual medium'
		]
	},

	butterfly: {
		id: 'butterfly',
		tagline: 'A disc in the pipe: compact, cheap, and usable for throttling.',
		sections: [
			{
				heading: 'How it works',
				body: 'A disc mounted on a shaft rotates across the pipe bore. The body is short enough to fit between two flanges, which makes a butterfly valve light, cheap and easy to install compared with a gate or globe valve of the same line size. That compactness is why it dominates large line sizes.'
			},
			{
				heading: 'The flow characteristic is better than expected',
				body: 'Because the disc sweeps through the bore, the open area changes in a way that gives a capacity curve close to equal percentage. A butterfly valve is therefore a respectable throttling valve on large lines, which is not obvious from looking at it and is worth knowing.'
			},
			{
				heading: 'The torque characteristic is the real subject',
				body: 'The disc is symmetric about its shaft, so the static pressure acting on it produces almost no net torque. If static pressure were the whole story, a butterfly valve would need almost no actuator. What does produce torque is the asymmetry of the flowing stream: the fluid accelerates around one side of the disc more than the other, and that imbalance produces a dynamic torque that peaks at part travel, usually between 60 and 75 degrees open. That peak can be several times the torque needed to hold the valve wide open, and it is what the actuator must be sized on. A butterfly valve that strokes easily on a bench can fail to move once there is flow through it, and the designer who sized the actuator on the pressure drop rather than on the dynamic torque is the one who finds out.'
			}
		],
		keyPoints: [
			'Compact and cheap, which is why it dominates large line sizes.',
			'The disc gives a capacity curve close to equal percentage.',
			'Static pressure produces almost no torque because the disc is symmetric.',
			'Dynamic torque peaks at part travel, at several times the wide open value.',
			'The actuator must be sized on dynamic torque, not on pressure drop.'
		],
		applications: [
			'Isolation on large water, air and flue gas lines',
			'Throttling on large lines where a globe valve is impractical',
			'Cooling water and circulating water control',
			'Where space and weight matter, such as on a header or a ship'
		],
		limitations: [
			'High pressure drop liquid service, where the high recovery promotes cavitation',
			'The disc sits in the flow even when open, so it always drops some pressure',
			'Accurate control at low flow, since the disc is very sensitive near closed',
			'High torque demand at part travel, which drives actuator size and cost'
		]
	},

	plug: {
		id: 'plug',
		tagline: 'A rotating plug with a wiping seat for the dirtiest service.',
		sections: [
			{
				heading: 'How it works',
				body: 'A tapered or cylindrical plug with a rectangular port rotates in a matching seat. The port sweeps past the bore, opening a passage that grows quickly at first: the corner of the port crosses the bore early, so the capacity curve is steeper than a ball valve and closer to quick opening.'
			},
			{
				heading: 'The seat is the reason to choose it',
				body: 'The plug is held against its seat by the process pressure itself, and the two sealing surfaces wipe each other clean on every stroke. That wiping action is what lets a plug valve survive slurry, fibre and crystallising service that would destroy a ball valve seat in a matter of weeks. Where a ball valve would score and leak, a plug valve keeps sealing.'
			},
			{
				heading: 'The cost of the design',
				body: 'A plug valve has high friction by design, because the plug is pressed into its seat, so it needs more torque to operate than a ball valve. Its capacity curve is quick opening, so it throttles poorly: usable for coarse regulation, not for a control loop. Its port is also smaller than the bore, so it drops more pressure than a ball valve when open.'
			}
		],
		keyPoints: [
			'The wiping seat survives dirty and fibrous service that ruins other valves.',
			'Sealing is provided by the process pressure pushing the plug into its seat.',
			'Quick opening characteristic, so it throttles poorly.',
			'Higher operating torque and higher pressure drop than a ball valve.'
		],
		applications: [
			'Slurry and tailings lines',
			'Pulp and paper stock at high consistency',
			'Service where solids crystallise or settle out',
			'On-off duty with frequent operation on dirty fluid'
		],
		limitations: [
			'Throttling and control, because of the quick opening characteristic',
			'Clean service, where a ball valve does the same job with less torque',
			'Very high pressure drop liquid service combined with throttling'
		]
	},

	'check-swing': {
		id: 'check-swing',
		tagline: 'A hinged disc that stops reverse flow and slams when it does.',
		sections: [
			{
				heading: 'How it works',
				body: 'A disc on a hinge swings out of the flow when fluid moves forward and swings back onto its seat when the flow reverses. There is no signal and no external power: the process provides the opening force and a spring or the disc weight provides the closing force. That independence is the whole point of a check valve, and it is why protection against reverse flow never depends on a control system.'
			},
			{
				heading: 'The two pressures that describe it',
				body: 'A check valve is described by the pressure difference that cracks it open and the difference at which the disc reaches full lift. A swing check needs very little to crack, which is why it drops so little pressure when open. Between the two pressures the disc sits partly open and chatters against its seat, which is where the wear happens. A valve that spends its life in that band, because it is undersized or because the flow is marginal, will wear out early.'
			},
			{
				heading: 'Water hammer',
				body: 'Reverse flow does not stop the instant the flow reverses. The disc has to travel back to its seat, and while it travels there is a path open for flow. A swing check has a heavy disc on a long hinge, so it takes time to close and a measurable slug of liquid gets through. When that slug is finally stopped, its momentum has to go somewhere, and it goes into the piping as a pressure surge. The damage ranges from noise to a cracked pipe. This is why a heavy check valve on a high energy service is a design fault, and why faster closing designs exist.'
			}
		],
		keyPoints: [
			'Self acting: no signal, no external power, no control system in the loop.',
			'Opens on forward flow and closes on reverse flow.',
			'Chatters and wears when it sits between cracking and full lift.',
			'A slow closing design passes a slug of reverse flow, which produces water hammer.',
			'Protection against reverse flow must not depend on a control loop.'
		],
		applications: [
			'Pump discharge, to stop backflow when a pump stops',
			'Preventing reverse flow between two parallel pumps or headers',
			'Bypass and makeup lines',
			'Anywhere reverse flow would damage equipment or contaminate a stream'
		],
		limitations: [
			'High energy service with a swing check, because of the closing surge',
			'Pulsating flow, where the disc chatters continuously',
			'Very low flow, where the disc sits partly open and wears'
		]
	},

	'check-dualPlate': {
		id: 'check-dualPlate',
		tagline: 'Two light half discs that close before reverse flow builds up.',
		sections: [
			{
				heading: 'How it works',
				body: 'Two spring loaded half discs fold into the flow when fluid moves forward and snap shut when it reverses. The closure is light and its travel is short, so it closes far faster than a swing check. That single difference changes what the valve is good for.'
			},
			{
				heading: 'Why closing speed matters',
				body: 'The damage a check valve does to its pipe depends on how much reverse flow it lets through before it seals. That amount is roughly the closing time multiplied by the reverse flow rate. A dual plate closes in a fraction of the time a swing check takes, so the reverse slug is a fraction of the size and the pressure surge is a fraction of the strength. On a compressor discharge or a high head pump line, that difference is the difference between a quiet stop and a broken pipe.'
			},
			{
				heading: 'The trade',
				body: 'The springs that make it close fast add a small pressure drop and need a slightly higher pressure to crack the valve open, and the two half discs with their springs are more to go wrong than one hinge. The design is also less tolerant of fouling, because the springs and the hinge pins collect deposits. On clean, high energy service those costs are worth paying; on a dirty line a swing check is the more robust choice.'
			}
		],
		keyPoints: [
			'Light closure with short travel, so it closes very quickly.',
			'Less reverse flow gets through, so the water hammer is much weaker.',
			'Slightly higher cracking pressure and a small pressure drop.',
			'Less tolerant of fouling than a swing check.',
			'The right choice where a closing surge would be destructive.'
		],
		applications: [
			'Compressor discharge',
			'High head pump discharge',
			'Any high energy line where a swing check would slam',
			'Where a short installation length is needed'
		],
		limitations: [
			'Dirty and fibrous service, where the springs foul',
			'Very low pressure drop requirements, because of the spring load',
			'Lines where the flow is marginal and the discs would chatter'
		]
	},

	relief: {
		id: 'relief',
		tagline: 'The last line of defence against overpressure.',
		sections: [
			{
				heading: 'A protection device, not a control device',
				body: 'A relief valve is not a control valve and must never be treated as one. It exists to work when everything else has failed, which is why it is self acting, why its set pressure is sealed, and why it is sized on a credible worst case scenario rather than on a normal operating condition. A control loop cannot protect a vessel, because a loop needs a measurement, a controller and a final element, and any of the three can fail. Protection has to be independent of all of them.'
			},
			{
				heading: 'Three pressures, and the gaps between them',
				body: 'Set pressure is where the valve begins to open. Overpressure is where it reaches full lift: ASME allows 10 percent above set pressure for a standard valve, and the valve is sized so that 10 percent is enough to pass the required relief flow. Blowdown is the pressure below set where the valve reseats, typically 7 to 10 percent lower. The blowdown is not an imperfection, it is the feature that makes the valve work: without it the valve would reseat the instant the pressure dipped and reopen immediately, chattering against its seat until both the seat and the pipe failed.'
			},
			{
				heading: 'Why the capacity is a mass balance, not a setting',
				body: 'Whether a relief valve protects a vessel depends on one comparison: is its relieving capacity greater than the flow that is pressurising the vessel? If it is, the pressure rises to the relief point and stops. If it is not, the pressure keeps rising whatever the set pressure is, and the vessel fails. The set pressure decides when the valve opens and the capacity decides whether opening helps. Confusing the two is the classic error, and it is why relief valves are sized on a scenario rather than selected from a catalogue.'
			},
			{
				heading: 'Gas relief is almost always choked',
				body: 'A gas relief valve discharges to atmosphere, so the pressure ratio across its orifice is far above the critical value and the flow is choked. The practical consequence is that the discharge pressure does not affect the capacity at all: a gas relief valve that appears undersized cannot be fixed by shortening or widening the discharge line, because the flow was already limited at the orifice. Only a larger orifice helps.'
			}
		],
		keyPoints: [
			'Self acting and independent of every control system on the plant.',
			'Set pressure decides when it opens, capacity decides whether that helps.',
			'Blowdown keeps it from chattering, and it is deliberate.',
			'Gas relief is almost always choked, so discharge pressure does not affect capacity.',
			'Sized on a credible worst case scenario, never on normal operation.'
		],
		applications: [
			'Vessel and piping overpressure protection',
			'Thermal relief on a blocked in liquid filled line',
			'Pump discharge and compressor interstage protection',
			'Steam drum and boiler protection'
		],
		limitations: [
			'Never a substitute for a control loop or for correct design',
			'Requires periodic testing and recalibration, and the set pressure must stay sealed',
			'A relief valve that has lifted on a dirty service may not reseat properly',
			'Noise and discharge handling need their own design work'
		]
	}
};

export function getLesson(id: ValveId): Lesson {
	return LESSONS[id];
}

/** Lessons in the order the catalogue presents them. */
export const LESSON_ORDER: readonly ValveId[] = [
	'gate',
	'globe',
	'controlValve',
	'ball',
	'ballCharacterised',
	'butterfly',
	'plug',
	'check-swing',
	'check-dualPlate',
	'relief'
];

export interface ConceptEntry {
	id: string;
	title: string;
	summary: string;
	body: string;
	/** Which valves the concept is best demonstrated on. */
	demonstratedBy: readonly ValveId[];
}

/**
 * The cross cutting concepts of instrumentation, each one tied to the valves
 * where the simulator shows it most clearly.
 */
export const CONCEPTS: readonly ConceptEntry[] = [
	{
		id: 'flowCoefficient',
		title: 'Flow coefficient Kv and Cv',
		summary:
			'One number that describes how much a valve passes for a given pressure drop, so valves of different designs can be compared.',
		body: 'Kv is the volume of water in cubic metres per hour that passes through a wide open valve at a pressure drop of one bar. Cv is the same idea in US customary units: gallons per minute at one psi, and one Kv equals 1.156 Cv. Because both are defined on water at a stated temperature, using them for another liquid means correcting for density, and using them for a gas or steam means applying the compressible flow equations instead. A valve datasheet always quotes the coefficient at full travel; what the valve does at part travel is described by its characteristic.',
		demonstratedBy: ['controlValve', 'globe', 'ball']
	},
	{
		id: 'chokedFlow',
		title: 'Choked flow',
		summary:
			'Past a certain pressure drop a valve stops passing more flow, however much lower the downstream pressure goes.',
		body: 'Liquid and gas choke for different reasons. A liquid chokes when the pressure at the vena contracta falls to its vapour pressure, so bubbles form and the flow stops increasing; the pressure drop that does this depends on how much of the jet kinetic energy the body recovers, which is why a globe valve can use far more pressure drop than a ball valve. A gas chokes when it reaches sonic velocity at the throat, at a pressure ratio set by the valve geometry. Either way, the consequence is the same and worth remembering: beyond the choke point, lowering the downstream pressure adds no flow, so a valve that appears undersized may simply be choked.',
		demonstratedBy: ['globe', 'ball', 'butterfly']
	},
	{
		id: 'cavitation',
		title: 'Cavitation and flashing',
		summary:
			'Bubbles that collapse and erode the valve, or that never collapse and flood the outlet.',
		body: 'As liquid accelerates past the seat its pressure falls. If it drops below the vapour pressure, bubbles form. If the pressure recovers downstream, those bubbles collapse violently against the metal, and the repeated implosions erode the trim: this is cavitation, and it sounds like gravel in the pipe. If the downstream pressure stays below the vapour pressure the bubbles never collapse and the liquid continues as a mixture of liquid and vapour: this is flashing, which does not erode the valve but produces a much larger volume that the downstream pipe has to handle. The two have different fixes. Cavitation is often cured by a valve with lower pressure recovery or by a hardened trim; flashing can only be lived with, by making the downstream pipe and valve large enough.',
		demonstratedBy: ['globe', 'ball', 'controlValve']
	},
	{
		id: 'characteristic',
		title: 'Inherent and installed characteristic',
		summary:
			'The shape built into the trim, and the different shape the loop actually sees.',
		body: 'The inherent characteristic describes capacity against travel at a constant pressure drop. The installed characteristic describes it in a real system, where the pressure drop across the valve changes as the flow changes. The gap between them is set by the valve authority, the share of the total system pressure drop the valve takes when it is wide open. With high authority the two curves agree and a linear trim gives a constant loop gain. With low authority the valve loses pressure drop exactly as it opens, which steepens a linear trim and makes the loop behave differently at different flows; an equal percentage trim is shaped to cancel that and hold the gain constant. This is the reason to check the authority before choosing a characteristic.',
		demonstratedBy: ['controlValve', 'globe', 'gate']
	},
	{
		id: 'forceBalance',
		title: 'Actuator force balance and bench set',
		summary:
			'The actuator delivers a force, not a position, and the bench set decides how that force maps onto travel.',
		body: 'Air pressure acting on the diaphragm pushes one way, a spring pushes back, and the stem goes wherever the leftover force takes it. The bench set is the pair of air pressures at which the stem just leaves its seat and just reaches full travel, and setting it correctly is what makes the actuator use its full stroke. Fluid force on the plug and packing friction both disturb the balance, so the position a valve reaches depends on the process it is working against. This is why a valve without a positioner drifts as conditions change, and why the bench set is adjusted on a test stand before the valve is installed.',
		demonstratedBy: ['controlValve', 'globe']
	},
	{
		id: 'stiction',
		title: 'Stiction, deadband and hysteresis',
		summary:
			'Packing holds the stem until enough force builds up, so the valve sticks and then jumps.',
		body: 'Packing grips the stem. Below a breakaway force the stem does not move at all, and once it moves the resisting force drops, so the stem jumps forward and sticks again. The result appears in a trend as a staircase and in a loop as a limit cycle that no amount of tuning will remove, because the cause is mechanical and not in the controller. Hysteresis is not a separate defect: it falls out of the same physics, since reversing direction requires overcoming friction from the other side. A positioner helps a great deal, because it keeps increasing the pressure until the stem breaks away, which is why a positioned valve appears far more accurate than the same valve without one.',
		demonstratedBy: ['controlValve', 'globe']
	},
	{
		id: 'signalChain',
		title: 'The 4-20 mA loop and NAMUR NE43',
		summary:
			'A live zero lets the control system tell a genuine low reading apart from a failed transmitter.',
		body: 'Almost every process signal travels as a current between 4 and 20 mA, where 4 mA is the bottom of the range and 20 mA the top. The reason the bottom is not zero is that a broken wire also produces zero current, and a system that reads zero cannot tell the two apart. With a live zero, a current below about 3.6 mA means a fault, and NAMUR NE43 sets the limits: below 3.6 mA is a downscale fault, above 21.0 mA is an upscale fault, and the bands just inside those are saturation, where the reading is still valid but outside the usable range. A control system takes a loop out of automatic when it sees a fault rather than acting on a measurement it cannot trust.',
		demonstratedBy: ['controlValve']
	},
	{
		id: 'pidLoop',
		title: 'PID control and loop tuning',
		summary:
			'Proportional for speed, integral for accuracy, derivative for the processes that need it, and limits to keep all three honest.',
		body: 'Proportional action responds to the current error, and alone it always leaves a standing offset. Integral action removes that offset by accumulating the error over time, at the cost of making the loop slower and less stable. Derivative action responds to how fast the measurement is moving, which helps on a slow process and turns noise into valve movement on a fast one, so it acts on the measurement rather than the error and is filtered. A real controller also clamps its integral while the output is saturated, because a valve that has been held wide open would otherwise stay there for a long time after the error reverses. Tuning is a search for the point where the loop is fast enough without oscillating, and the process dead time is what limits how fast that can be.',
		demonstratedBy: ['controlValve']
	}
];
