/**
 * Procedural geometry for every valve in the catalogue.
 *
 * Each valve is assembled from the parts library in `parts.ts`, which carries the
 * published proportions. What this file decides is the arrangement: which parts a
 * given valve has, where they sit, and which of them move.
 *
 * Everything is built from primitives rather than loaded from a model file. A
 * parametric valve can be rebuilt for a different nominal size or sliced open for a
 * section view without a second asset, and the proportions that matter for the lesson
 * stay tied to the numbers the simulation uses.
 *
 * Each builder returns the same shape: a group holding the assembly, references to
 * the parts that move, and the axis and travel a driver needs to animate them. The
 * animation layer never has to know which valve it is looking at.
 */

import {
	BoxGeometry,
	BufferGeometry,
	CylinderGeometry,
	ExtrudeGeometry,
	Group,
	LatheGeometry,
	Matrix4,
	Mesh,
	Object3D,
	Shape,
	ShapeGeometry,
	SphereGeometry,
	TorusGeometry,
	Vector2,
	Vector3
} from 'three';
import {
	bodyWallM,
	buildAnnulus,
	buildBackseatRing,
	buildBoltedJoint,
	buildBonnet,
	buildCage,
	buildCapScrews,
	buildCover,
	buildDiaphragmActuator,
	buildFlange,
	buildHandwheel,
	buildHelicalSpring,
	buildHexHead,
	buildPackingStack,
	buildPipeStub,
	buildPortNeck,
	buildPortWindow,
	buildSeatRing,
	buildSoftSeat,
	buildVNotch,
	cyl,
	faceToFaceRatio,
	flangeThicknessRatio,
	GeometryRegistry,
	handwheelRatio,
	heightRatio,
	referenceBoreM,
	slab,
	sphere,
	torus,
	travelRatio
} from './parts';
import {
	bonnetStudCount,
	bonnetStudRadiusM,
	buildBoltedBonnetJoint,
	buildCastHandwheel,
	buildNameplate,
	buildOpenYoke,
	buildStemNut,
	stemNutWheelSeatM,
	buildStemThread,
	buildStuffingBox,
	packingWidthM,
	stemDiameterM
} from './osy';
import {
	ALUMINIUM,
	BRASS,
	CAST_IRON,
	GASKET,
	GHOST,
	PAINTED_STEEL,
	PIPE,
	PTFE,
	SPRING_STEEL,
	STAINLESS,
	STEEL_BOLT,
	TRIM
} from './materials';
import type { ValveId } from '$lib/sim/valves/catalogue';

/** How a moving part is driven. */
export type MotionKind =
	/** Slides along an axis by a distance in metres. */
	| 'linear'
	/** Rotates about an axis by an angle in radians. */
	| 'rotary';

export interface MovingPart {
	object: Object3D;
	kind: MotionKind;
	/** Axis of motion, normalised. */
	axis: Vector3;
	/** Distance in metres for a linear part, or radians for a rotary part. */
	travel: number;
	/** Where the part sits at zero opening. */
	restPosition: Vector3;
	/** Human readable name, shown when the part is inspected. */
	label: string;
}

export interface ValveAssembly {
	root: Group;
	/** Parts that move with the valve. */
	moving: MovingPart[];
	/** Distance from the flow axis to the top of the actuator, for camera framing. */
	heightM: number;
	/** Length along the flow axis, for camera framing. */
	lengthM: number;
	/**
	 * Parts that stand between the camera and the internals.
	 *
	 * Hiding these is the quick "take the casting off" view. It is not the same as the
	 * section view, which cuts everything at once; both are offered because they answer
	 * different questions.
	 */
	cuttables: Object3D[];
	/**
	 * The full stroke, in metres.
	 *
	 * Reported so the caller can pass the real travel of this valve to the simulation
	 * rather than applying one number to every type. A gate travels about one bore and
	 * a globe about a quarter of that, and the difference is why one needs fifteen
	 * turns of a handwheel and the other four.
	 */
	strokeM: number;
	dispose(): void;
}

export interface ValveBuildOptions {
	nominalSizeInch: number;
	/** Overrides the travel derived from the valve pattern. */
	strokeM?: number;
	withPositioner: boolean;
	withHandwheel: boolean;
	balanced: boolean;
	setPressureBarGauge?: number;
}

// ---------------------------------------------------------------------------
// Sliding stem valves
// ---------------------------------------------------------------------------

interface LinearOptions {
	nominalSizeInch: number;
	strokeM: number;
	character: 'gate' | 'globe' | 'control';
	balanced: boolean;
	withPositioner: boolean;
	withHandwheel: boolean;
}

/**
 * A sliding stem valve: gate, globe or control valve.
 *
 * The three share a body, a bonnet, a packing box and a stem. What differs is the trim
 * inside and what sits on top.
 *
 * The vertical layout follows the proportions measured off manufacturer drawings. For a
 * gate valve the body is 39 percent of the open height, the bonnet and stuffing box 20
 * percent, the yoke 22 percent and the stem nut and handwheel assembly 18 percent. That
 * distribution is why a real gate valve reads as an open frame with a body at the
 * bottom rather than as a pipe fitting with a knob on top, and it is the single largest
 * difference between this model and a datasheet.
 */
function buildLinearValve(registry: GeometryRegistry, options: LinearOptions): ValveAssembly {
	const root = new Group();
	const moving: MovingPart[] = [];
	const cuttables: Object3D[] = [];

	const d = referenceBoreM(options.nominalSizeInch);
	const wall = bodyWallM(options.nominalSizeInch);
	const isGate = options.character === 'gate';
	// A control valve is dimensioned to ISA-75.08.01 rather than to B16.10, and its body is
	// a longer casting than a general purpose globe valve of the same size.
	const pattern = options.character === 'control' ? 'controlValve' : isGate ? 'gate' : 'globe';
	const faceToFace = d * faceToFaceRatio(options.nominalSizeInch, pattern);
	const halfLength = faceToFace / 2;

	// --- Vertical layout, in bore units -------------------------------------
	//
	// The gate body carries the cavity the wedge retracts into, so it is tall; the globe
	// body is a bulb with the seat in the middle, so it is short and the bonnet above it
	// is correspondingly taller.
	const bodyTop = isGate ? 1.7 * d : 1.0 * d;
	const stuffingBoxTop = isGate ? 3.2 * d : 3.25 * d;
	const yokeTop = isGate ? 4.8 * d : 5.25 * d;

	const bonnetHeight = stuffingBoxTop - bodyTop;
	const yokeHeight = yokeTop - stuffingBoxTop;

	// Turns of the handwheel from shut to wide open. A gate travels about one bore and
	// takes a dozen turns; a globe travels a quarter as far and so turns a quarter as
	// often. This number is also the stem thread's lead, because the thread has to be cut
	// to the same rate the nut is animated at.
	const turnsToFullTravel = isGate ? 12 : 4;
	const stemLeadM = options.strokeM / turnsToFullTravel;

	// --- Body and its port necks --------------------------------------------
	const cavityRadius = d * 0.62 + wall;
	const flangeThickness = d * flangeThicknessRatio(options.nominalSizeInch);
	const flangeCentre = halfLength - flangeThickness / 2;
	const flangeInnerFace = halfLength - flangeThickness;
	const bodyHalfWidth = isGate ? cavityRadius * 0.92 : cavityRadius * 1.05;

	if (isGate) {
		const barrel = new Mesh(cyl(registry, cavityRadius * 0.9, bodyHalfWidth * 2, 40, true), CAST_IRON);
		barrel.name = 'Body barrel';
		barrel.rotation.z = Math.PI / 2;
		root.add(barrel);
		cuttables.push(barrel);

		// The cavity the wedge retracts into. It rises from the barrel to the bonnet
		// joint, which is why a gate body is taller in the middle than a straight pipe.
		const cavity = new Mesh(
			cyl(registry, cavityRadius * 0.86, bodyTop + cavityRadius * 0.9, 36, true),
			CAST_IRON
		);
		cavity.position.y = (bodyTop + cavityRadius * 0.9) / 2 - cavityRadius * 0.35;
		root.add(cavity);
		cuttables.push(cavity);

		const dome = new Mesh(sphere(registry, cavityRadius * 0.9, 32, 22), CAST_IRON);
		dome.scale.set(1, 1.1, 1);
		dome.position.y = -cavityRadius * 0.3;
		root.add(dome);
		cuttables.push(dome);
	} else {
		const bulb = new Mesh(sphere(registry, cavityRadius, 40, 28), CAST_IRON);
		bulb.name = 'Body bulb';
		bulb.scale.set(1.05, 1, 1);
		root.add(bulb);
		cuttables.push(bulb);

		// The neck rising from the bulb to the bonnet joint.
		const neck = new Mesh(cyl(registry, cavityRadius * 0.62, bodyTop, 32, true), CAST_IRON);
		neck.position.y = bodyTop / 2;
		root.add(neck);
		cuttables.push(neck);
	}

	// The necks running from the casting out to the flange inner faces.
	const neckLength = flangeInnerFace - bodyHalfWidth * 0.72;
	if (neckLength > 0) {
		for (const side of [-1, 1]) {
			const neck = buildPortNeck(registry, {
				innerRadiusM: d * 0.56 + wall * 0.7,
				outerRadiusM: d * 0.58,
				lengthM: neckLength,
				boreRadiusM: d * 0.46
			});
			neck.position.x = side * (bodyHalfWidth * 0.72 + neckLength / 2);
			root.add(neck);
			cuttables.push(neck);
		}
	}

	for (const side of [-1, 1]) {
		// One flange per end, centred so its outer face lands on faceToFace / 2, which is
		// the dimension ASME B16.10 specifies and the one the catalogue quotes.
		const flange = buildFlange(registry, {
			boreM: d,
			nominalSizeInch: options.nominalSizeInch,
			raisedFace: true
		});
		flange.position.x = side * flangeCentre;
		root.add(flange);
	}

	// The nameplate on the side of the body, which every valve carries.
	const plate = buildNameplate(registry, { widthM: d * 0.5, heightM: d * 0.26 });
	plate.position.set(0, -cavityRadius * 0.55, cavityRadius * 0.98);
	root.add(plate);

	// --- Seats --------------------------------------------------------------
	//
	// The plug's rest height is derived from the seat, so the seat has to say where its
	// sealing surface is. For a gate the wedge slides between two flat seats and the plug
	// relationship does not apply; for a globe or a control valve the plug lands on the
	// inner edge of a conical seat, and that plane is what the plug is placed against.
	const seatHeight = d * 0.16;
	const seatPortRadius = d * 0.42;
	let seatSealingPlaneM = 0;
	if (isGate) {
		// Two seats facing each other, with the wedge sliding between them.
		for (const side of [-1, 1]) {
			const seat = buildSeatRing(registry, {
				portRadiusM: d * 0.44,
				outerRadiusM: d * 0.56,
				heightM: seatHeight,
				face: 'flat'
			});
			seat.rotation.z = Math.PI / 2;
			seat.position.set(side * d * 0.2, 0, 0);
			root.add(seat);
		}
	} else {
		const seatBodyHeight = seatHeight * 1.2;
		const seatCentreY = -d * 0.1;
		const seat = buildSeatRing(registry, {
			portRadiusM: seatPortRadius,
			outerRadiusM: d * 0.62,
			heightM: seatBodyHeight,
			face: 'conical'
		});
		seat.position.y = seatCentreY;
		root.add(seat);

		// The cone sits on top of the ring and its inner edge is the sealing line, so the
		// plane the plug lands on is the bottom of the cone, not the top of the ring.
		seatSealingPlaneM = seatCentreY + seatBodyHeight / 2 - seatBodyHeight * 0.16;
	}

	if (options.character === 'control' && options.balanced) {
		const cage = buildCage(registry, {
			innerRadiusM: d * 0.36,
			wallM: d * 0.06,
			heightM: d * 0.72,
			windows: 6,
			windowHeightRatio: 0.55,
			innerWallM: d * 0.04
		});
		cage.position.y = d * 0.22;
		root.add(cage);
	}

	// --- Stem and trim ------------------------------------------------------
	const stemRadius = options.character === 'control' ? d * 0.08 : stemDiameterM(options.nominalSizeInch) / 2;
	const stemGroup = new Group();
	stemGroup.name = isGate ? 'Stem and wedge' : 'Stem, disc and disc nut';

	// The stem runs from the plug up through the backseat, the packing box and the yoke
	// to the stem nut, so its length follows from the layout rather than being chosen.
	const stemTop = yokeTop + d * 0.5;
	const stemBottom = isGate ? d * 0.06 : d * 0.02;
	const stemLength = stemTop - stemBottom;
	const stem = new Mesh(cyl(registry, stemRadius, stemLength), STAINLESS);
	stem.name = 'Stem';
	stem.position.y = stemBottom + stemLength / 2;
	stemGroup.add(stem);

	// The exposed thread between the stuffing box and the stem nut. Drawing it is what
	// tells a viewer this is an outside screw valve: the thread is visible and rises
	// through the nut as the valve opens.
	//
	// The helix runs upward from the group origin, so the origin goes at the bottom of
	// the threaded length, just above the stuffing box.
	const threadLength = yokeTop - stuffingBoxTop - d * 0.2;
	if (threadLength > 0) {
		const thread = buildStemThread(registry, {
			stemRadiusM: stemRadius,
			lengthM: threadLength,
			pitchM: stemLeadM
		});
		thread.position.y = stuffingBoxTop + d * 0.1;
		stemGroup.add(thread);
	}

	if (isGate) {
		// A solid wedge: a tapered disc that fits between the two seats. The taper is what
		// lets it wedge into the seats and seal, and what lets it release when the stem
		// lifts.
		const wedgeHeight = d * 1.15;
		const wedgeGeometry = registry.track(
			new CylinderGeometry(d * 0.44, d * 0.4, wedgeHeight, 4)
		);
		wedgeGeometry.rotateY(Math.PI / 4);
		const wedge = new Mesh(wedgeGeometry, TRIM);
		wedge.name = 'Wedge';
		wedge.rotation.z = Math.PI / 2;
		wedge.position.y = d * 0.06 + wedgeHeight * 0.1;
		stemGroup.add(wedge);

		// The T-head where the stem meets the wedge. A real gate is connected this way
		// rather than bolted, so the wedge can align itself with the seats as it closes.
		const tHeadGeometry = registry.track(
			new CylinderGeometry(stemRadius * 1.6, stemRadius * 1.6, d * 0.14, 12)
		);
		tHeadGeometry.rotateZ(Math.PI / 2);
		const tHead = new Mesh(tHeadGeometry, STAINLESS);
		tHead.position.y = d * 0.06 + wedgeHeight * 0.86;
		stemGroup.add(tHead);
	} else {
		// A ball disc on a swivel: the disc nut lets the disc align itself on the seat
		// independently of the stem, which is why a globe disc is not rigidly fixed.
		const plugRadius = d * 0.44;
		const plugStretch = 1.4;
		const discGeometry = registry.track(
			new SphereGeometry(plugRadius, 28, 18, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58)
		);
		discGeometry.scale(1, plugStretch, 1);
		const disc = new Mesh(discGeometry, TRIM);
		disc.name = 'Disc';
		// The plug is a stretched bowl. Its surface reaches the seat's sealing radius at
		// this depth below its own origin, so sitting it on the sealing plane is what puts
		// it in contact with the seat. Chosen by eye instead, it sank through the cone.
		disc.position.y =
			seatSealingPlaneM +
			plugStretch * Math.sqrt(plugRadius * plugRadius - seatPortRadius * seatPortRadius);
		stemGroup.add(disc);

		const discWasher = new Mesh(cyl(registry, d * 0.16, d * 0.04, 20), STAINLESS);
		discWasher.position.y = -d * 0.16;
		stemGroup.add(discWasher);

		const discNut = new Mesh(
			registry.track(new CylinderGeometry(d * 0.14, d * 0.14, d * 0.1, 6)),
			STAINLESS
		);
		discNut.position.y = -d * 0.24;
		stemGroup.add(discNut);

		if (options.balanced) {
			const seal = new Mesh(torus(registry, d * 0.34, d * 0.035), PTFE);
			seal.rotation.x = Math.PI / 2;
			seal.position.y = d * 0.4;
			stemGroup.add(seal);
		}
	}

	root.add(stemGroup);
	moving.push({
		object: stemGroup,
		kind: 'linear',
		axis: new Vector3(0, 1, 0),
		travel: options.strokeM,
		restPosition: stemGroup.position.clone(),
		label: isGate ? 'Stem and wedge' : 'Stem, disc and disc nut'
	});

	// --- The bolted bonnet joint -------------------------------------------
	//
	// The joint shape is a specification, not a style: API 600 5.5.6 permits a
	// non-circular joint only for Class 150 valves and for sizes up to NPS 2 1/2, so a
	// Class 150 gate valve has an oval joint and a globe valve of the same size has a
	// circular one.
	const joint = buildBoltedBonnetJoint(registry, {
		meanRadiusM: cavityRadius * 0.72,
		studRadiusM: bonnetStudRadiusM(options.nominalSizeInch),
		studCount: bonnetStudCount(options.nominalSizeInch),
		thicknessM: d * 0.13,
		oval: isGate && options.nominalSizeInch <= 6
	});
	joint.position.y = bodyTop - d * 0.06;
	root.add(joint);

	// --- Bonnet ------------------------------------------------------------
	const bonnetBaseRadius = cavityRadius * 0.72;
	const bonnetNeckRadius = stemRadius * 3.1;

	// A bonnet is a casting that narrows from the joint to the stuffing box, so it is
	// built as a lathe rather than as a cone: the profile is what reads as a casting.
	const profile: Vector2[] = [
		new Vector2(bonnetNeckRadius * 0.62, 0),
		new Vector2(bonnetBaseRadius * 0.95, 0),
		new Vector2(bonnetBaseRadius * 0.95, bonnetHeight * 0.12),
		new Vector2(bonnetBaseRadius * 0.8, bonnetHeight * 0.3),
		new Vector2(bonnetNeckRadius * 1.3, bonnetHeight * 0.6),
		new Vector2(bonnetNeckRadius * 1.25, bonnetHeight * 0.92),
		new Vector2(bonnetNeckRadius * 1.45, bonnetHeight),
		new Vector2(bonnetNeckRadius * 0.7, bonnetHeight)
	];
	const bonnetMesh = new Mesh(registry.track(new LatheGeometry(profile, 40)), CAST_IRON);
	bonnetMesh.position.y = bodyTop;
	root.add(bonnetMesh);
	cuttables.push(bonnetMesh);

	// --- Stuffing box -------------------------------------------------------
	const packingWidth = packingWidthM(stemRadius * 2);
	const boxRadius = stemRadius + packingWidth;
	// The gland flange is the widest part of the stuffing box, so the yoke has to be
	// wider still, otherwise the gland and its eyebolts end up outside the frame
	// instead of nested between the legs where a fitter can reach them.
	const glandHalfWidth = boxRadius * 1.85;
	const boxDepth = bonnetHeight * 0.55;
	const stuffingBox = buildStuffingBox(registry, {
		stemRadiusM: stemRadius,
		depthM: boxDepth,
		boxRadiusM: boxRadius,
		// Five rings is the API 600 minimum and the number a manufacturer section shows.
		ringCount: 5
	});
	stuffingBox.position.y = stuffingBoxTop - boxDepth / 2 - d * 0.05;
	root.add(stuffingBox);
	cuttables.push(stuffingBox);

	const bonnetTop = stuffingBoxTop;

	// --- The drive on top ---------------------------------------------------
	let topY = bonnetTop;

	if (options.character === 'control') {
		topY = buildControlValveDrive(registry, {
			root,
			moving,
			cuttables,
			bonnetTop,
			d,
			strokeM: options.strokeM,
			withPositioner: options.withPositioner
		});
	} else {
		// --- The open yoke ---------------------------------------------------
		//
		// Two legs with daylight between them. The openness is the point: a yoke exists
		// so the rising stem and its thread can be watched while the valve operates,
		// which is what "outside screw and yoke" means.
		const yoke = buildOpenYoke(registry, {
			heightM: yokeHeight,
			// Clear of the gland at the base, splaying out to carry the handwheel thrust
			// at the top, which is the shape the castings have.
			baseHalfWidthM: glandHalfWidth * 1.22,
			topHalfWidthM: glandHalfWidth * 1.55,
			legWidthM: stemRadius * 1.5,
			legDepthM: stemRadius * 1.0,
			capRadiusM: glandHalfWidth * 1.6,
			capThicknessM: d * 0.09
		});
		yoke.position.y = bonnetTop;
		root.add(yoke);
		cuttables.push(yoke);

		const capRadius = glandHalfWidth * 1.6;
		const capThickness = d * 0.09;

		// The stem nut, which is the part that actually turns. It is placed on the cap's
		// top face, because that face is its thrust face, and its sleeve hangs down
		// through the bore below.
		const stemNutOptions = {
			stemRadiusM: stemRadius,
			capRadiusM: capRadius,
			capThicknessM: capThickness,
			// API 600 requires an engagement of at least 1.5 stem diameters.
			engagementM: stemRadius * 3
		};
		const stemNut = buildStemNut(registry, stemNutOptions);
		stemNut.position.y = bonnetTop + yokeHeight + capThickness;
		root.add(stemNut);
		moving.push({
			object: stemNut,
			kind: 'rotary',
			axis: new Vector3(0, 1, 0),
			// The nut turns with the handwheel, so it makes the same number of
			// revolutions across the stroke.
			travel: Math.PI * 2 * turnsToFullTravel,
			restPosition: stemNut.position.clone(),
			label: 'Stem nut'
		});

		// --- The handwheel ---------------------------------------------------
		const wheelRadius = (d * handwheelRatio(options.nominalSizeInch)) / 2;
		const wheel = buildCastHandwheel(registry, {
			radiusM: wheelRadius,
			// API 600 limits the wheel to six spokes and the manufacturer exploded views
			// show five.
			spokes: 5,
			hubHeightM: stemRadius * 2.6
		});
		// The wheel sits on the nut's hex drive, so it is placed from the same offsets
		// rather than from an expression of its own.
		const wheelY =
			bonnetTop + yokeHeight + capThickness + stemNutWheelSeatM(stemNutOptions);
		wheel.position.y = wheelY;
		root.add(wheel);
		moving.push({
			object: wheel,
			kind: 'rotary',
			axis: new Vector3(0, 1, 0),
			// The wheel turns with the nut it is mounted on, so it makes the same
			// revolutions across the stroke.
			travel: Math.PI * 2 * turnsToFullTravel,
			restPosition: wheel.position.clone(),
			label: 'Handwheel'
		});

		// The handwheel nut and its lock washer, which hold the wheel on the stem nut.
		const wheelNut = new Mesh(
			registry.track(new CylinderGeometry(stemRadius * 1.5, stemRadius * 1.5, stemRadius * 1.4, 6)),
			STAINLESS
		);
		wheelNut.position.y = wheelY + stemRadius * 1.9;
		root.add(wheelNut);

		const lockWasher = new Mesh(
			cyl(registry, stemRadius * 1.9, stemRadius * 0.3, 20),
			STAINLESS
		);
		lockWasher.position.y = wheelY + stemRadius * 1.1;
		root.add(lockWasher);

		topY = wheelY + stemRadius * 2.6;
	}

	root.updateMatrixWorld(true);

	return {
		root,
		moving,
		heightM: topY,
		lengthM: faceToFace,
		cuttables,
		strokeM: options.strokeM,
		dispose: () => registry.dispose()
	};
}

/**
 * The drive on a control valve: a spring and diaphragm actuator on a yoke.
 *
 * Kept separate from the handwheel branch above because a control valve has no
 * handwheel, no open yoke and no stem nut. What it has instead is a closed frame
 * carrying an actuator whose case is 6.6 times the bore, which is the largest single
 * proportion on any valve in the catalogue.
 *
 * Returns the height of the top of the assembly.
 */
function buildControlValveDrive(
	registry: GeometryRegistry,
	context: {
		root: Group;
		moving: MovingPart[];
		cuttables: Object3D[];
		bonnetTop: number;
		d: number;
		strokeM: number;
		withPositioner: boolean;
	}
): number {
	const { root, moving, cuttables, bonnetTop, d, strokeM, withPositioner } = context;

	// A Fisher 657/667 size 40 is the standard actuator for a DN50 valve: 333 mm across the
	// case, 164 mm from face to face of the case, 29 mm of travel, and 445 cm2 of effective
	// diaphragm area. Both figures used here are published, so they are used directly rather
	// than derived from whatever spring the case happens to contain.
	//
	// Sources: Fisher 657/667 bulletin 61.1:657 for the case diameter, case height, effective
	// area and travel; Fisher Control Valve Handbook 6th edition Table 5.10.1 for the DN50
	// trim and its rated travel.
	// The case grows with the thrust the valve needs, which follows the port. A DN50 and
	// anything smaller takes the size 40 case; the next size up takes the 406 mm case.
	const caseDiameter = d <= 0.06 ? 0.333 : 0.406;
	const caseHeight = d <= 0.06 ? 0.164 : 0.19;
	const caseRadius = caseDiameter / 2;

	// The yoke carries the actuator and has to give the positioner somewhere to hang.
	// Sized from the stroke alone it was 152 mm tall, which is less than the positioner is
	// tall, so the positioner had nowhere to go and ended up cut through the case above it.
	// Its height is therefore a constraint: the positioner's height, plus the travel the
	// stem needs below it, plus clearance.
	const positionerHeight = 0.191;
	const yokeHeight = Math.max(strokeM * 4, positionerHeight + strokeM + d * 0.8);

	// A yoke that carries a diaphragm case splays out to almost the case diameter, which is
	// what makes the actuator look supported rather than balanced on a stick. Across its top
	// is a plate, and on that plate the raised boss the actuator bolts to. The boss diameter
	// is published, 71 mm on a valve with a 12.7 mm stem, from the Fisher ED yoke-boss table,
	// which is the same table the 657/667 actuator sizes against.
	const yokeBossRadius = 0.0355;
	const yoke = buildOpenYoke(registry, {
		heightM: yokeHeight,
		baseHalfWidthM: d * 0.78,
		topHalfWidthM: caseRadius * 0.5,
		legWidthM: d * 0.3,
		legDepthM: d * 0.24,
		capRadiusM: caseRadius * 0.5,
		capThicknessM: d * 0.12
	});
	yoke.position.y = bonnetTop;
	root.add(yoke);
	cuttables.push(yoke);

	// The raised boss in the middle of the yoke plate, which is the machined face the
	// actuator bolts down onto.
	const yokeBoss = new Mesh(cyl(registry, yokeBossRadius, d * 0.08, 28), CAST_IRON);
	yokeBoss.name = 'Yoke boss';
	yokeBoss.position.y = yokeHeight + d * 0.12 + d * 0.04;
	root.add(yokeBoss);

	// The travel indicator: a disc on the stem connector, visible through the open yoke.
	// That visibility is the whole reason the yoke is an open frame.
	const indicator = new Mesh(cyl(registry, d * 0.13, d * 0.02), BRASS);
	indicator.position.y = bonnetTop + yokeHeight * 0.4;
	root.add(indicator);

	const actuator = buildDiaphragmActuator(registry, {
		caseRadiusM: caseRadius,
		caseHeightM: caseHeight,
		travelM: strokeM
	});
	// On the boss, which sits above the yoke plate and is what the actuator bolts to.
	actuator.group.position.y = bonnetTop + yokeHeight + d * 0.2;
	root.add(actuator.group);
	cuttables.push(actuator.group);

	// The diaphragm plate and the spring move with the stem, because the plate is bolted
	// to the actuator stem and compresses the spring as the valve strokes.
	moving.push({
		object: actuator.diaphragmPlate,
		kind: 'linear',
		axis: new Vector3(0, 1, 0),
		travel: strokeM,
		restPosition: actuator.diaphragmPlate.position.clone(),
		label: 'Diaphragm plate'
	});
	moving.push({
		object: actuator.spring,
		kind: 'linear',
		axis: new Vector3(0, 1, 0),
		travel: strokeM * 0.4,
		restPosition: actuator.spring.position.clone(),
		label: 'Actuator spring'
	});

	if (withPositioner) {
		// A Fisher 3660 is 191 mm by 142 mm by 122 mm and stands 105 mm off the actuator
		// centreline. A positioner is not a small accessory: for many valves it is the
		// largest single item after the actuator, and drawing it as a matchbox leaves the
		// assembly looking unfinished.
		//
		// Source: Fisher 3660/3661 positioner bulletin 62.1:3660, Figure 3 envelope and
		// Table 4 materials, with the standoff from the 657/667 dimension table.
		const positioner = new Group();
		positioner.name = 'Positioner';

		const yokeMidHalfWidth = (d * 0.78 + caseRadius * 0.5) / 2;
		// The 104.9 mm in the 657/667 table is the distance from the actuator centreline to
		// the positioner's mounting face, so the case starts there and reaches outboard.
		const standoffM = 0.105;
		const bracketLength = standoffM - yokeMidHalfWidth;

		// 191.2 mm tall by 142.2 mm wide by 122.3 mm deep, from the bulletin envelope. The
		// tallest dimension is vertical because the case is mounted on its side.
		const caseHeight = 0.191;
		const caseWidth = 0.142;
		const caseDepth = 0.122;

		// The case, with the cover standing slightly proud of it, which is the joint a
		// technician opens to reach the zero and span adjustments. The case is taller than
		// it is wide, because it is mounted on its side against the yoke.
		const housing = new Mesh(
			slab(registry, caseDepth, caseHeight, caseWidth),
			ALUMINIUM
		);
		housing.position.x = caseDepth * 0.5;
		positioner.add(housing);

		const cover = new Mesh(
			slab(registry, caseDepth * 0.18, caseHeight * 1.02, caseWidth * 1.02),
			ALUMINIUM
		);
		cover.position.x = caseDepth * 1.07;
		positioner.add(cover);

		// The two gauges an instrument technician reads: supply on the left, output to the
		// actuator on the right. Facing the same way as the cover, because they are read
		// from in front.
		for (const side of [-1, 1]) {
			const gauge = new Mesh(cyl(registry, 0.026, 0.022, 24), BRASS);
			gauge.rotation.z = Math.PI / 2;
			gauge.position.set(caseDepth * 1.2, caseHeight * 0.22, side * caseWidth * 0.28);
			positioner.add(gauge);
		}

		// The supply and output tubing running back to the actuator case. Drawn as two runs,
		// because the positioner sits between them: air in from the supply, air out to the
		// diaphragm.
		for (const side of [-1, 1]) {
			const tube = new Mesh(cyl(registry, 0.006, bracketLength, 8), BRASS);
			tube.rotation.x = Math.PI / 2;
			tube.position.set(0, caseHeight * 0.3 * side, caseWidth * 0.5 + bracketLength * 0.5);
			positioner.add(tube);
		}

		// The feedback lever: the positioner has to know where the stem is, so a lever rides
		// on the stem connector and turns the flapper inside. Drawing it explains what the
		// linkage on a real valve is for.
		const lever = new Mesh(slab(registry, 0.09, 0.012, 0.03), STAINLESS);
		lever.rotation.z = Math.PI * 0.16;
		lever.position.set(-0.02, -caseHeight * 0.55, 0);
		positioner.add(lever);

		// Centred on the yoke, because the yoke is sized to contain it: above this line the
		// case starts, below it the bonnet. The bracket reaches from the leg out to the case,
		// so the connection is visible rather than implied, and the instrument no longer
		// hangs in the air beside a frame it has nothing to do with.
		// A plate reaching from the yoke leg out to the case: long along the reach, about
		// the height of the case, and thin, because that is what a bracket is.
		const bracket = new Mesh(
			slab(registry, 0.014, caseHeight * 0.42, bracketLength),
			PAINTED_STEEL
		);
		// On the yoke side of the case, which is the positive local direction now that the
		// group sits on the far side of the valve.
		bracket.position.z = caseWidth * 0.5 + bracketLength * 0.5;
		positioner.add(bracket);

		// On the far side of the yoke from the default camera. Which side a positioner is
		// mounted on is arbitrary on a real valve, and from the near side it covered the
		// yoke and the bonnet entirely, which is the one thing a mounted instrument must
		// not do. Orbiting shows it fully; the valve stays readable from the front.
		positioner.position.set(0, bonnetTop + yokeHeight * 0.5, -(standoffM + caseWidth * 0.5));
		root.add(positioner);
		cuttables.push(positioner);
	}

	return bonnetTop + yokeHeight + d * 0.2 + caseHeight;
}

// ---------------------------------------------------------------------------
// Quarter turn valves
// ---------------------------------------------------------------------------

/**
 * A tapered plug valve: a conical plug turning a quarter turn in a conical body bore.
 *
 * The proportions are the published ones, not guesses. The taper is 1 in 6 on the
 * diameter, which is the taper the catalogues specify and the reason the valve can be
 * re-seated by pressing the plug deeper as it wears. The port is a rectangle, its height
 * the bore of the pipe, sized so that it stays inside the tapered plug: a plug valve is
 * a reduced port, and this one is 79 percent of the pipe area, in the band the
 * catalogues describe. The body is one piece with a bolted top cover, because the cover
 * carries the gland, the packing and the quarter turn stop, and none of those can exist
 * on a body that has no cover.
 *
 * Sources: Xomox Tufline Fig 067 dimension table (face to face, cover height, stem
 * square, lever, Cv), Christensen Type 9 (the 1 in 6 taper, the trapezoidal port, the
 * bottom adjuster), Nordstrom and Walworth cutaways (the gland, the stop, the stem
 * proportions), and ASME B16.10 for the face to face. Saved under
 * reference/valve-research/plug-valve/.
 */
function buildPlugValve(registry: GeometryRegistry, options: RotaryOptions): ValveAssembly {
	const root = new Group();
	const moving: MovingPart[] = [];
	const cuttables: Object3D[] = [];

	const d = referenceBoreM(options.nominalSizeInch);
	const wall = bodyWallM(options.nominalSizeInch);
	const faceToFace = d * faceToFaceRatio(options.nominalSizeInch, 'gate');
	const halfLength = faceToFace / 2;
	const flangeThickness = d * flangeThicknessRatio(options.nominalSizeInch);
	const flangeCentre = halfLength - flangeThickness / 2;
	const flangeInnerFace = halfLength - flangeThickness;

	// --- The proportions the research fixes --------------------------------
	//
	// Full bore of the port is the bore of the pipe, and the port is square: a 40 mm
	// square in a 50 mm valve, which is 79 percent of the pipe area and stays inside the
	// tapered plug at every corner.
	const portSide = d * 0.79;

	// The taper is 1 in 6 on the diameter: a plug this long shrinks a fifth of its length
	// in diameter from bottom to top. Wider at the top, because the plug is pressed down
	// into its seat to re-seat it as it wears.
	const plugLength = d * 2.3;
	const taperShrink = plugLength / 6;
	const plugLargeEndRadius = (d + taperShrink) / 2;
	const plugSmallEndRadius = plugLargeEndRadius - taperShrink / 2;

	// The body bore is the cone the plug lands in, a sleeve thickness larger so the PTFE
	// sleeve sits between the two tapers.
	const sleeveThickness = d * 0.06;
	const seatLargeRadius = plugLargeEndRadius + sleeveThickness;
	const seatSmallRadius = plugSmallEndRadius + sleeveThickness;
	const bodyRadius = seatLargeRadius + wall;

	// --- The body ----------------------------------------------------------
	// The casting around the seat, drawn open ended so a section view shows the cone the
	// plug turns in.
	const bodyLength = plugLength + d * 0.35;
	const body = new Mesh(cyl(registry, bodyRadius, bodyLength, 40, true), CAST_IRON);
	body.name = 'Body';
	body.rotation.z = Math.PI / 2;
	root.add(body);
	cuttables.push(body);

	// The conical seat, which the plug is adjusted into from below. It is the surface the
	// whole plug bears on, interrupted only by the port.
	const seat = new Mesh(
		registry.track(
			new CylinderGeometry(seatLargeRadius, seatSmallRadius, bodyLength, 40, 1, true)
		),
		CAST_IRON
	);
	seat.name = 'Body seat';
	seat.rotation.z = Math.PI / 2;
	root.add(seat);
	cuttables.push(seat);

	// The plug adjuster at the bottom of the body: the screw and press ring that set how
	// deep the plug sits, which is how a worn taper is brought back into contact.
	const adjusterBoss = new Mesh(
		cyl(registry, bodyRadius * 0.34, d * 0.14, 24),
		CAST_IRON
	);
	adjusterBoss.name = 'Plug adjuster boss';
	adjusterBoss.position.y = -bodyLength / 2 - d * 0.07;
	root.add(adjusterBoss);

	const adjusterScrew = buildHexHead(registry, { acrossFlatsM: d * 0.22, heightM: d * 0.1 });
	adjusterScrew.name = 'Plug adjuster screw';
	adjusterScrew.position.y = -bodyLength / 2 - d * 0.16;
	root.add(adjusterScrew);

	// --- The port necks and the flanges ------------------------------------
	const neckLength = flangeInnerFace - bodyRadius;
	if (neckLength > 0) {
		for (const side of [-1, 1]) {
			const neck = buildPortNeck(registry, {
				innerRadiusM: portSide * 0.62,
				outerRadiusM: portSide * 0.7,
				lengthM: neckLength,
				boreRadiusM: portSide * 0.55
			});
			neck.position.x = side * (bodyRadius + neckLength / 2);
			root.add(neck);
			cuttables.push(neck);
		}
	}

	for (const side of [-1, 1]) {
		const flange = buildFlange(registry, {
			boreM: d,
			nominalSizeInch: options.nominalSizeInch,
			raisedFace: true
		});
		flange.position.x = side * flangeCentre;
		root.add(flange);
	}

	// The nameplate on the side of the body, which every valve carries.
	const plate = buildNameplate(registry, { widthM: d * 0.55, heightM: d * 0.28 });
	plate.position.set(0, -bodyRadius * 0.5, bodyRadius * 0.99);
	root.add(plate);

	// --- The closure -------------------------------------------------------
	const closureGroup = new Group();
	closureGroup.name = 'Plug and stem';

	// The tapered plug, wider at the top, which is the taper that names the valve.
	const plug = new Mesh(
		registry.track(
			new CylinderGeometry(plugLargeEndRadius, plugSmallEndRadius, plugLength, 40)
		),
		STAINLESS
	);
	plug.name = 'Plug';
	closureGroup.add(plug);

	// The port, across the pipe at rest because rest is the shut position. A quarter turn
	// lines it up with the flow.
	const port = buildPortWindow(registry, {
		widthM: portSide,
		heightM: portSide,
		depthM: portSide
	});
	port.name = 'Port';
	closureGroup.add(port);

	// The stem is integral with the plug: it is the plug\x27s own top, extended through the
	// cover to the square the lever drives.
	const stemTop = bodyLength / 2 + d * 0.45;
	const stem = new Mesh(cyl(registry, d * 0.145, stemTop - plugLargeEndRadius * 0.4, 24), STAINLESS);
	stem.name = 'Stem';
	stem.position.y = (stemTop + plugLargeEndRadius * 0.4) / 2;
	closureGroup.add(stem);

	root.add(closureGroup);
	moving.push({
		object: closureGroup,
		kind: 'rotary',
		axis: new Vector3(0, 1, 0),
		travel: Math.PI / 2,
		restPosition: closureGroup.position.clone(),
		label: 'Plug and stem'
	});

	// --- The cover, and everything mounted on it ---------------------------
	const coverBase = bodyLength / 2;
	const coverHeight = d * 0.28;

	// The spiral wound gasket between the body and the cover.
	const gasket = buildAnnulus(registry, {
		innerRadiusM: plugLargeEndRadius * 1.1,
		outerRadiusM: bodyRadius * 0.96,
		heightM: d * 0.03,
		material: GASKET,
		name: 'Body cover gasket'
	});
	gasket.position.y = coverBase + d * 0.015;
	root.add(gasket);

	const cover = buildCover(registry, {
		radiusM: bodyRadius * 1.04,
		heightM: coverHeight,
		boltCount: 4,
		boltCircleM: bodyRadius * 1.5,
		boltRadiusM: d * 0.045
	});
	cover.name = 'Cover';
	cover.position.y = coverBase + d * 0.03 + coverHeight / 2;
	root.add(cover);
	cuttables.push(cover);

	const coverTop = coverBase + d * 0.03 + coverHeight;

	// The packing and its gland, in the cover\x27s bore around the stem. A quarter turn
	// stem turns in place, so two rings are enough.
	const packing = buildPackingStack(registry, {
		stemRadiusM: d * 0.145,
		boxRadiusM: bodyRadius * 0.42,
		ringCount: 2,
		heightM: d * 0.22
	});
	packing.name = 'Packing';
	packing.position.y = coverTop - d * 0.16;
	root.add(packing);

	const gland = new Mesh(
		cyl(registry, bodyRadius * 0.5, d * 0.12, 28),
		STEEL_BOLT
	);
	gland.name = 'Gland';
	gland.position.y = coverTop + d * 0.06;
	root.add(gland);

	// The stop plate, which limits the lever to its quarter turn, and the collar on the
	// stem that runs against it.
	const stopPlate = new Mesh(slab(registry, d * 0.8, d * 0.05, d * 0.5), STAINLESS);
	stopPlate.name = 'Stop plate';
	stopPlate.position.y = coverTop + d * 0.16;
	root.add(stopPlate);

	const stopCollar = new Mesh(
		cyl(registry, d * 0.2, d * 0.06, 24),
		STEEL_BOLT
	);
	stopCollar.name = 'Stop collar';
	stopCollar.position.y = coverTop + d * 0.2;
	root.add(stopCollar);

	let topY = coverTop + d * 0.24;

	if (options.withHandle) {
		// The lever, 232 mm on a DN50 valve, on a hub washer under its retaining nut.
		const lever = new Group();
		lever.name = 'Lever handle';

		const armLength = d * 4.57;
		const hub = new Mesh(slab(registry, d * 0.55, d * 0.12, d * 0.45), CAST_IRON);
		lever.add(hub);

		const arm = new Mesh(slab(registry, armLength, d * 0.1, d * 0.17), CAST_IRON);
		arm.position.x = armLength / 2 - d * 0.12;
		lever.add(arm);

		const grip = new Mesh(cyl(registry, d * 0.095, d * 0.75, 12), BRASS);
		grip.rotation.z = Math.PI / 2;
		grip.position.x = armLength - d * 0.5;
		lever.add(grip);

		lever.position.y = topY + d * 0.07;
		root.add(lever);

		const leverNut = buildHexHead(registry, { acrossFlatsM: d * 0.34, heightM: d * 0.1 });
		leverNut.name = 'Lever nut';
		leverNut.position.y = topY + d * 0.15;
		root.add(leverNut);

		moving.push({
			object: lever,
			kind: 'rotary',
			axis: new Vector3(0, 1, 0),
			travel: Math.PI / 2,
			restPosition: lever.position.clone(),
			label: 'Lever handle'
		});

		topY += d * 0.36;
	}

	root.updateMatrixWorld(true);

	return {
		root,
		moving,
		heightM: topY,
		lengthM: faceToFace,
		cuttables,
		// A quarter turn valve reports the arc its reference point travels, so the
		// simulation and the animation agree on what "opening" means.
		strokeM: Math.PI * 0.5 * (d / 2),
		dispose: () => registry.dispose()
	};
}

interface RotaryOptions {
	nominalSizeInch: number;
	closure: 'ballBore' | 'ballVNotch' | 'disc' | 'plugPort';
	withActuator: boolean;
	withHandle: boolean;
}

/**
 * A ball valve: a bored ball turning through a quarter of a turn between two seat rings.
 *
 * The proportions here are derived from the geometry rather than copied from a table,
 * because the geometry is what fixes them. A ball can only turn between two seats if it
 * is enough larger than its bore for the opening to clear the seat lip. The bore through
 * it is the intersection of a cylinder with a sphere, so a cylinder drawn longer than
 * 2 sqrt(R^2 - r^2) sticks out of the ball's sides. And the body cavity has to clear the
 * ball, or the ball rises through the casting. All three were wrong in this model, and
 * all three are asserted in reference/scripts/check-valve-fit.ts.
 *
 * Sources for the rest: ASME B16.10 for the face to face, API 608 for the design
 * requirements, and the dimension tables and cutaway drawings of Kitz, Velan and
 * Habonim for the body proportions, the lever length and the stem sealing.
 */
function buildBallValve(
	registry: GeometryRegistry,
	options: {
		nominalSizeInch: number;
		/** A V notch ball is the characterised version, for throttling service. */
		closure: 'ballBore' | 'ballVNotch';
		withActuator: boolean;
		withHandle: boolean;
	}
): ValveAssembly {
	const root = new Group();
	const moving: MovingPart[] = [];
	const cuttables: Object3D[] = [];

	const d = referenceBoreM(options.nominalSizeInch);
	const wall = bodyWallM(options.nominalSizeInch);
	const faceToFace = d * faceToFaceRatio(options.nominalSizeInch, 'ballLong');
	const halfLength = faceToFace / 2;
	const flangeThickness = d * flangeThicknessRatio(options.nominalSizeInch);
	const flangeCentre = halfLength - flangeThickness / 2;
	const flangeInnerFace = halfLength - flangeThickness;

	// --- The proportions the geometry fixes --------------------------------
	//
	// Full port, so the bore through the ball is the bore of the pipe. That is what
	// separates a full port valve from a reduced port one of the same size.
	const portRadius = d * 0.5;

	// The ball has to be larger than its bore, or the opening would sweep across the seat
	// and the valve could never seal. The limit follows from requiring a seat that seals
	// outside the port and stays clear of the port opening:
	//
	//     r <= a_s < rho_c < sqrt(R^2 - r^2)   gives   R > r sqrt(2)
	//
	// so the hard minimum is 1.414 and practice runs 1.5 to 1.7. 1.55 is the value the
	// research recommends for a DN50 full port valve, which is a 76 mm ball on a 49 mm bore.
	const ballRadius = portRadius * 1.55;

	// The cavity clears the ball so it turns freely, which is also what gives the seat
	// rings somewhere to sit.
	const cavityRadius = ballRadius * 1.08;
	const shellRadius = cavityRadius + wall;

	// How far a cylinder of the port radius reaches inside a ball of this radius. A bore
	// drawn any longer than twice this pokes out of the ball's sides: it is the half length
	// at which the cylinder and the sphere still meet.
	const portPlaneM = Math.sqrt(ballRadius * ballRadius - portRadius * portRadius);

	// The seat bore is deliberately a little larger than the port. Sized to the port, the
	// sealing circle is the same circle as the edge of the hole, which is a seal of zero
	// width sitting on the rim of the opening it has to close.
	const seatBoreRadius = portRadius * 1.02;
	const seatOuterRadius = portRadius * 1.62;
	const seatThickness = d * 0.12;
	const shellLength = Math.min(faceToFace * 0.62, cavityRadius * 2.1);

	// --- Body --------------------------------------------------------------
	// The shell is drawn open ended so a section view shows the cavity the ball turns in.
	const shell = new Mesh(
		cyl(registry, shellRadius, shellLength, 40, true),
		CAST_IRON
	);
	shell.name = 'Body shell';
	shell.rotation.z = Math.PI / 2;
	root.add(shell);
	cuttables.push(shell);

	// A ball or plug body splits so the trim can be assembled into it, and the joint is
	// drawn because it explains how the valve is built and serviced. The end pieces are
	// annuli: the port passes through them.
	for (const side of [-1, 1]) {
		const end = buildAnnulus(registry, {
			innerRadiusM: portRadius * 1.12,
			outerRadiusM: shellRadius,
			heightM: d * 0.14
		});
		end.name = 'Body end';
		end.rotation.z = Math.PI / 2;
		end.position.x = side * (shellLength / 2 + d * 0.07);
		root.add(end);
		cuttables.push(end);

		// The joint bolts, running through the end piece into the shell.
		const bolts = buildCapScrews(registry, {
			count: options.nominalSizeInch <= 2 ? 6 : 8,
			circleRadiusM: shellRadius * 0.8,
			screwRadiusM: d * 0.035,
			lengthM: d * 0.3
		});
		bolts.rotation.z = Math.PI / 2;
		bolts.position.x = side * (shellLength / 2 + d * 0.07);
		root.add(bolts);
	}

	// The necks carry the casting out to the flanges, which is how a real body is shaped
	// and also what leaves the room the ball needs to be larger than the bore it carries.
	const neckLength = flangeInnerFace - (shellLength / 2 + d * 0.14);
	if (neckLength > 0) {
		for (const side of [-1, 1]) {
			const neck = buildPortNeck(registry, {
				innerRadiusM: portRadius * 1.24,
				outerRadiusM: portRadius * 1.3,
				lengthM: neckLength,
				boreRadiusM: portRadius
			});
			neck.position.x = side * (shellLength / 2 + d * 0.14 + neckLength / 2);
			root.add(neck);
			cuttables.push(neck);
		}
	}

	for (const side of [-1, 1]) {
		const flange = buildFlange(registry, {
			boreM: d,
			nominalSizeInch: options.nominalSizeInch,
			raisedFace: true
		});
		flange.position.x = side * flangeCentre;
		root.add(flange);
	}

	// The nameplate on the side of the body, which every valve carries.
	const plate = buildNameplate(registry, { widthM: d * 0.55, heightM: d * 0.28 });
	plate.position.set(0, -cavityRadius * 0.35, cavityRadius * 0.99);
	root.add(plate);

	// --- The seats, which belong to the body -------------------------------
	// A seat ring is held in the body and the ball turns against it. It must not be part
	// of the closure: built there, it swings out through the side of the casting on the
	// first quarter turn.
	for (const side of [-1, 1]) {
		const seat = buildSeatRing(registry, {
			portRadiusM: seatBoreRadius,
			outerRadiusM: seatOuterRadius,
			heightM: seatThickness,
			face: 'conical'
		});
		seat.name = 'Seat ring';
		seat.rotation.z = Math.PI / 2;
		// The lip sits where the ball's surface reaches the seat's bore, so the two touch on
		// a circle outside the port opening, and the ring runs away from the ball behind it.
		// Measuring from the seat's bore rather than the port is what gives the seal a width.
		seat.position.x =
			side * (Math.sqrt(ballRadius * ballRadius - seatBoreRadius * seatBoreRadius) + seatThickness / 2);
		root.add(seat);
	}

	// --- The closure -------------------------------------------------------
	const closureGroup = new Group();
	closureGroup.name = 'Ball and stem';

	const ballMaterial = options.closure === 'ballBore' ? STAINLESS : TRIM;

	if (options.closure === 'ballBore') {
		// A bored ball is a sphere with the cylinder of the port taken out of it. Drawn as a
		// solid sphere with a tube hidden inside, it read as a ball with no hole at all,
		// because the sphere is opaque and the bore never reached its surface.
		//
		// So the ball is two patches that meet exactly on the circle where a cylinder of the
		// port radius leaves the sphere: the outer surface, from one port edge to the other,
		// and the bore wall between them. Together they are a closed surface, the bore has a
		// wall that a section view can show, and the open valve can be seen straight through.
		//
		// SphereGeometry measures its polar angle from its own Y, so both patches are turned
		// onto the bore axis, which runs along Z at rest.
		const thetaStart = Math.asin(portRadius / ballRadius);
		const outer = new Mesh(
			registry.track(
				new SphereGeometry(
					ballRadius,
					40,
					24,
					0,
					Math.PI * 2,
					thetaStart,
					Math.PI - 2 * thetaStart
				)
			),
			ballMaterial
		);
		outer.name = 'Ball';
		outer.rotation.x = Math.PI / 2;
		closureGroup.add(outer);

		// The bore wall, from one port edge circle to the other. Its ends land on the same
		// circles the outer patch ends on, so the two together close.
		const bore = new Mesh(cyl(registry, portRadius, portPlaneM * 2, 32, true), PIPE);
		bore.name = 'Ball bore';
		bore.rotation.x = Math.PI / 2;
		closureGroup.add(bore);
	} else {
		// A V port ball: the upstream half of the bore is the round port the upstream seat
		// seals on, and the downstream half is cut into a V, which is the edge that meters
		// the flow against the downstream seat. The body, the seats and the stem are the
		// standard ball valve's, because a V port ball is a drop-in for a round port one.
		//
		// Bray's selection guide gives the proportions: a 90 degree V on a 2 inch full port
		// ball is 33.5 percent of the round port's Cv, which is the sector of the bore the V
		// leaves at full open, and the V's mouth is never wider than the bore, so the seats
		// still seal on the spherical land outside it.
		const vAngle = Math.PI / 2;
		const vHalf = vAngle / 2;
		const thetaStart = Math.asin(portRadius / ballRadius);

		// The outer surface, in two patches. The V takes a wedge out of the downstream half
		// of the band the bore leaves, so the remainder is not a rectangle in the sphere's
		// own coordinates and one SphereGeometry cannot draw it.
		const away = new Mesh(
			registry.track(
				new SphereGeometry(
					ballRadius,
					40,
					24,
					Math.PI / 2,
					Math.PI * 2 - vAngle,
					thetaStart,
					Math.PI - 2 * thetaStart
				)
			),
			ballMaterial
		);
		away.name = 'Ball';
		away.rotation.x = Math.PI / 2;
		closureGroup.add(away);

		const land = new Mesh(
			registry.track(
				new SphereGeometry(
					ballRadius,
					16,
					12,
					-Math.PI / 2,
					vAngle,
					Math.PI / 2,
					Math.PI - 2 * thetaStart - Math.PI / 2
				)
			),
			ballMaterial
		);
		land.name = 'Ball land';
		land.rotation.x = Math.PI / 2;
		closureGroup.add(land);

		// The upstream half of the bore: the round port, whose edge the upstream seat seals
		// on. Full circle, from the ball's mid plane back to the port edge.
		const upstream = new Mesh(cyl(registry, portRadius, portPlaneM, 32, true), PIPE);
		upstream.name = 'Port';
		upstream.rotation.x = Math.PI / 2;
		upstream.position.z = -portPlaneM / 2;
		closureGroup.add(upstream);

		// The downstream half: the arc of the sector the V leaves at the bore's radius.
		const throat = new Mesh(
			registry.track(
				new CylinderGeometry(
					portRadius,
					portRadius,
					portPlaneM,
					32,
					1,
					true,
					Math.PI / 2 - vHalf,
					vAngle
				)
			),
			PIPE
		);
		throat.name = 'V throat';
		throat.rotation.x = Math.PI / 2;
		throat.position.z = portPlaneM / 2;
		closureGroup.add(throat);

		// The two flat faces of the V. Each runs from the bore wall out to the sphere, from
		// the mid plane where the V's mouth is widest to the port edge where it closes, and
		// is bounded by the sphere on one side and the bore on the other.
		for (const side of [-1, 1]) {
			const shape = new Shape();
			shape.moveTo(portRadius, 0);
			shape.lineTo(ballRadius, 0);
			shape.absarc(0, 0, ballRadius, 0, Math.asin(portRadius / ballRadius), true);
			shape.lineTo(portRadius, portPlaneM);
			shape.closePath();
			const face = new Mesh(
				registry.track(new ShapeGeometry(shape, 24)),
				ballMaterial
			);
			face.name = 'V face';
			// The shape is drawn in its own plane with x out from the bore axis and y along
			// the bore, so it is laid onto the plane at its own azimuth about the bore axis.
			face.rotation.x = -Math.PI / 2;
			face.rotation.z = side * (Math.PI / 2 + vHalf);
			closureGroup.add(face);
		}
	}

	// --- The stem, its housing and the gland --------------------------------
	const stemRadius = d * 0.13;
	const neckRadius = d * 0.28;
	const housingHeight = d * 0.95;

	// The tang on the stem engages a slot in the ball, with clearance so the ball can
	// settle on its seats independently of the stem. It is drawn as a rectangular tongue
	// rather than as a round pin, because that is what carries the torque.
	const tang = new Mesh(slab(registry, d * 0.26, d * 0.22, d * 0.34), STAINLESS);
	tang.name = 'Stem tang';
	tang.position.y = ballRadius * 0.82;
	closureGroup.add(tang);

	const stemBottom = ballRadius * 0.5;
	const stemLength = shellRadius + housingHeight + d * 0.30 - stemBottom;
	const stem = new Mesh(cyl(registry, stemRadius, stemLength, 20), STAINLESS);
	stem.name = 'Stem';
	stem.position.y = stemBottom + stemLength / 2;
	closureGroup.add(stem);

	// The stem bearing the stem turns in, and its thrust washer, which together are what
	// keep the stem square to the ball.
	const bearing = new Mesh(
		cyl(registry, stemRadius * 1.5, d * 0.09, 24),
		PTFE
	);
	bearing.position.y = ballRadius * 0.98;
	closureGroup.add(bearing);

	root.add(closureGroup);
	moving.push({
		object: closureGroup,
		kind: 'rotary',
		axis: new Vector3(0, 1, 0),
		travel: Math.PI / 2,
		restPosition: closureGroup.position.clone(),
		label: options.closure === 'ballBore' ? 'Ball and stem' : 'V notch ball and stem'
	});

	// The housing is bored, because the stem turns inside it and the packing sits in the
	// bore. Drawn solid, the stem ran through solid iron with nowhere to seal.
	const housing = buildAnnulus(registry, {
		innerRadiusM: stemRadius * 1.4,
		outerRadiusM: neckRadius,
		heightM: housingHeight
	});
	housing.name = 'Stem housing';
	housing.position.y = ballRadius + housingHeight / 2 + d * 0.04;
	root.add(housing);
	cuttables.push(housing);

	const housingTop = ballRadius + d * 0.04 + housingHeight;

	// Three packing rings, not six: a quarter turn stem turns in place instead of sliding
	// through the packing, so there is far less to seal. They sit in the housing bore
	// below the gland that compresses them.
	const packing = buildPackingStack(registry, {
		stemRadiusM: stemRadius,
		boxRadiusM: stemRadius * 1.35,
		ringCount: 3,
		heightM: d * 0.3
	});
	packing.name = 'Packing';
	packing.position.y = housingTop - d * 0.2;
	root.add(packing);

	// The gland nut, which is the whole stem seal on a valve this size: it threads onto
	// the housing and squeezes the packing down as it is tightened.
	const gland = new Mesh(
		registry.track(new CylinderGeometry(neckRadius * 0.92, neckRadius * 0.92, d * 0.2, 6)),
		STEEL_BOLT
	);
	gland.name = 'Gland nut';
	gland.position.y = housingTop + d * 0.1;
	root.add(gland);

	// The stop plate. A quarter turn valve has to be stopped at both ends of its travel,
	// or an operator can drive the ball past its seat.
	const stopPlate = new Mesh(slab(registry, d * 0.7, d * 0.05, d * 0.46), STAINLESS);
	stopPlate.name = 'Stop plate';
	stopPlate.position.y = housingTop + d * 0.22;
	root.add(stopPlate);

	let topY = housingTop + d * 0.26;

	if (options.withActuator) {
		// A piston actuator with a lever arm, on a mounting pad above the housing.
		const barrelRadius = d * 0.5;
		const barrelLength = d * 1.5;
		const mountHeight = d * 0.22;

		const mount = new Mesh(slab(registry, d * 0.9, mountHeight, d * 0.5), PAINTED_STEEL);
		mount.position.y = topY + mountHeight / 2;
		root.add(mount);

		const barrel = new Mesh(cyl(registry, barrelRadius, barrelLength, 32), PAINTED_STEEL);
		barrel.name = 'Actuator barrel';
		barrel.rotation.z = Math.PI / 2;
		barrel.position.set(0, topY + mountHeight + barrelRadius, 0);
		root.add(barrel);
		cuttables.push(barrel);

		const lever = new Group();
		const arm = new Mesh(slab(registry, barrelLength * 0.55, d * 0.1, d * 0.06), PAINTED_STEEL);
		arm.position.x = barrelLength * 0.24;
		lever.add(arm);
		lever.position.set(0, topY + mountHeight * 0.5, 0);
		root.add(lever);

		moving.push({
			object: lever,
			kind: 'rotary',
			axis: new Vector3(0, 1, 0),
			travel: Math.PI / 2,
			restPosition: lever.position.clone(),
			label: 'Actuator lever'
		});

		const positionerBody = new Mesh(slab(registry, d * 0.48, d * 0.44, d * 0.3), PAINTED_STEEL);
		positionerBody.name = 'Positioner';
		positionerBody.position.set(0, topY + mountHeight + barrelRadius * 2.4, 0);
		root.add(positionerBody);
		cuttables.push(positionerBody);

		topY += mountHeight + barrelRadius * 3;
	} else if (options.withHandle) {
		// A lever handle, which is what a valve this size actually has. The length is the
		// maker's published figure for a DN50 valve, about four and a half bores, because
		// the handle has to develop enough torque to break the ball off its seats.
		const lever = new Group();
		lever.name = 'Lever handle';

		const armLength = d * 4.5;
		const hub = new Mesh(slab(registry, d * 0.5, d * 0.1, d * 0.42), CAST_IRON);
		lever.add(hub);

		const arm = new Mesh(slab(registry, armLength, d * 0.09, d * 0.16), CAST_IRON);
		arm.position.x = armLength / 2 - d * 0.1;
		lever.add(arm);

		// The grip, which is what makes a lever read as something a hand closes around.
		const grip = new Mesh(cyl(registry, d * 0.09, d * 0.7, 12), BRASS);
		grip.rotation.z = Math.PI / 2;
		grip.position.x = armLength - d * 0.45;
		lever.add(grip);

		lever.position.y = topY + d * 0.06;
		root.add(lever);

		// The retaining nut on the stem that holds the handle down, which is the part an
		// operator removes to re-index the handle on the stem flats.
		const handleNut = new Mesh(
			registry.track(new CylinderGeometry(stemRadius * 1.5, stemRadius * 1.5, d * 0.09, 6)),
			STEEL_BOLT
		);
		handleNut.name = 'Handle nut';
		handleNut.position.y = topY + d * 0.14;
		root.add(handleNut);

		moving.push({
			object: lever,
			kind: 'rotary',
			axis: new Vector3(0, 1, 0),
			travel: Math.PI / 2,
			restPosition: lever.position.clone(),
			label: 'Lever handle'
		});

		topY += d * 0.34;
	}

	root.updateMatrixWorld(true);

	return {
		root,
		moving,
		heightM: topY,
		lengthM: faceToFace,
		cuttables,
		// A quarter turn valve reports the arc its reference point travels, so the
		// simulation and the animation agree on what "opening" means.
		strokeM: Math.PI * 0.5 * (d / 2),
		dispose: () => registry.dispose()
	};
}

/**
 * A quarter turn valve: ball, butterfly or plug.
 *
 * All three rotate a closure through 90 degrees about a shaft crossing the pipe. What
 * differs is the closure and the body that houses it.
 */
function buildRotaryValve(registry: GeometryRegistry, options: RotaryOptions): ValveAssembly {
	const root = new Group();
	const moving: MovingPart[] = [];
	const cuttables: Object3D[] = [];

	const d = referenceBoreM(options.nominalSizeInch);
	const wall = bodyWallM(options.nominalSizeInch);

	// A butterfly is a wafer and a ball is a long pattern body, so the length comes
	// from the pattern rather than from one figure for the family.
	const pattern =
		options.closure === 'disc' ? 'butterflyWafer' : options.closure === 'plugPort' ? 'gate' : 'ballLong';
	const faceToFace = d * faceToFaceRatio(options.nominalSizeInch, pattern);
	const halfLength = faceToFace / 2;
	const shellRadius = d * 0.62 + wall;

	// --- Body ---------------------------------------------------------------
	if (options.closure === 'disc') {
		// A wafer butterfly body is a thin ring, which is the reason the family is used
		// on large lines. It is also why a wafer valve has nearly the same face to face
		// at every size up to NPS 6: the body does not grow, only the bore does.
		const ring = new Mesh(cyl(registry, shellRadius, faceToFace, 40, true), CAST_IRON);
		ring.rotation.z = Math.PI / 2;
		root.add(ring);
		cuttables.push(ring);

		// The seat is the liner: an elastomer sleeve in the body's cavity, standing proud of
		// both faces so it also seals against the pipe flanges. The disc's knife edge
		// compresses its bead, and the interference between the two is what sets the valve's
		// shutoff rating.
		const liner = buildAnnulus(registry, {
			innerRadiusM: d * 0.5,
			outerRadiusM: d * 0.585,
			heightM: faceToFace + d * 0.02,
			material: PTFE,
			name: 'Liner'
		});
		liner.rotation.z = Math.PI / 2;
		root.add(liner);
		cuttables.push(liner);

		for (const side of [-1, 1]) {
			// A wafer valve has no stubs: it is clamped between two pipe flanges, so only
			// the flange ring is drawn.
			const flange = buildFlange(registry, {
				boreM: d,
				nominalSizeInch: options.nominalSizeInch,
				raisedFace: false
			});
			flange.position.x = side * (halfLength + d * 0.015);
			root.add(flange);
		}
	} else {
		const shell = new Mesh(
			cyl(registry, shellRadius, Math.min(faceToFace * 0.62, d * 1.5), 40, true),
			CAST_IRON
		);
		shell.rotation.z = Math.PI / 2;
		root.add(shell);
		cuttables.push(shell);

		// A ball or plug body splits in two so the closure can be assembled into it. The
		// joint is drawn because it explains how the valve is built and serviced.
		const joint = buildCapScrews(registry, {
			count: options.nominalSizeInch <= 2 ? 6 : 8,
			circleRadiusM: shellRadius * 0.88,
			screwRadiusM: d * 0.035,
			lengthM: faceToFace * 0.14
		});
		joint.rotation.z = Math.PI / 2;
		joint.position.x = halfLength * 0.42;
		root.add(joint);

		// The shell is shorter than the face-to-face length, and necks carry it out to
		// the flanges. That is how a real body casting is shaped, and it is also what
		// leaves the room a ball needs to be larger than the bore it carries.
		const shellLength = Math.min(faceToFace * 0.62, d * 1.5);
		const flangeThickness = d * flangeThicknessRatio(options.nominalSizeInch);
		const flangeCentre = halfLength - flangeThickness / 2;
		const flangeInnerFace = halfLength - flangeThickness;

		const neckLength = flangeInnerFace - shellLength / 2;
		if (neckLength > 0) {
			for (const side of [-1, 1]) {
				const neck = buildPortNeck(registry, {
					innerRadiusM: d * 0.54,
					outerRadiusM: d * 0.58,
					lengthM: neckLength,
					boreRadiusM: d * 0.45
				});
				neck.position.x = side * (shellLength / 2 + neckLength / 2);
				root.add(neck);
				cuttables.push(neck);
			}
		}

		for (const side of [-1, 1]) {
			const flange = buildFlange(registry, {
				boreM: d,
				nominalSizeInch: options.nominalSizeInch,
				raisedFace: true
			});
			flange.position.x = side * flangeCentre;
			root.add(flange);
		}
	}

	// --- The closure --------------------------------------------------------
	const closureGroup = new Group();

	switch (options.closure) {
		case 'ballBore':
		case 'ballVNotch': {
			// The ball has to be larger than its bore. The opening sits at
			// sqrt(R^2 - r^2) from the centre and must swing clear of the seat over a
			// quarter turn, which needs R/r of at least sqrt(3); real valves run 1.5 to
			// 1.8, so the ball is visibly bigger than the pipe it sits in.
			const ballRadius = d * 0.8;
			const ball = new Mesh(sphere(registry, ballRadius, 40, 28), STAINLESS);
			closureGroup.add(ball);

			const boreRadius = d * 0.44;
			if (options.closure === 'ballBore') {
				const hole = new Mesh(cyl(registry, boreRadius, ballRadius * 2.3, 28, true), PIPE);
				hole.rotation.z = Math.PI / 2;
				closureGroup.add(hole);

				// The two seat rings the ball turns against.
				for (const side of [-1, 1]) {
					const seat = buildSoftSeat(registry, {
						innerRadiusM: boreRadius,
						outerRadiusM: ballRadius * 0.78,
						heightM: d * 0.14
					});
					seat.rotation.z = Math.PI / 2;
					seat.position.x = side * ballRadius * 0.7;
					closureGroup.add(seat);
				}
			} else {
				// A V notch replaces the round bore, which is what turns an unusable
				// capacity curve into an equal percentage one.
				const notch = buildVNotch(registry, {
					widthM: ballRadius * 0.82,
					heightM: boreRadius * 2,
					depthM: ballRadius * 2.3
				});
				notch.rotation.y = Math.PI / 2;
				closureGroup.add(notch);
			}

			// The stem enters from the top through its own packing. Its shoulder makes it
			// blowout proof: pressure cannot eject it.
			const stemRadius = d * 0.14;
			const stem = new Mesh(cyl(registry, stemRadius, ballRadius * 3.4), STAINLESS);
			stem.position.y = ballRadius * 1.6;
			closureGroup.add(stem);

			const thrustWasher = new Mesh(torus(registry, stemRadius * 1.6, d * 0.02), PTFE);
			thrustWasher.rotation.x = Math.PI / 2;
			thrustWasher.position.y = ballRadius * 0.9;
			closureGroup.add(thrustWasher);

			moving.push({
				object: closureGroup,
				kind: 'rotary',
				axis: new Vector3(0, 1, 0),
				travel: Math.PI / 2,
				restPosition: closureGroup.position.clone(),
				label: options.closure === 'ballBore' ? 'Ball, seats and stem' : 'V notch ball and stem'
			});
			break;
		}

		case 'disc': {
			// The disc is a lens, not a plate: thickest at the centre where the stem meets
			// it and tapering to a knife edge at the rim, which is the edge that compresses
			// the liner. Its diameter is a little under the bore, 0.97 of it on a Bray DN150,
			// because the liner's bead stands proud into the bore and has to be compressed.
			const discRadius = d * 0.48;
			const discCentreThickness = d * 0.29;
			const discEdgeThickness = d * 0.07;
			const profile: Vector2[] = [
				new Vector2(0, discCentreThickness / 2),
				new Vector2(discRadius * 0.55, discCentreThickness * 0.42),
				new Vector2(discRadius, discEdgeThickness / 2),
				new Vector2(discRadius, -discEdgeThickness / 2),
				new Vector2(discRadius * 0.55, -discCentreThickness * 0.42),
				new Vector2(0, -discCentreThickness / 2)
			];
			const discGeometry = registry.track(new LatheGeometry(profile, 40));
			// The lathe turns the lens about Y, so it is turned onto X: at rest the disc faces
			// along the pipe and blocks it, which is the shut position.
			discGeometry.rotateZ(Math.PI / 2);
			const disc = new Mesh(discGeometry, STAINLESS);
			disc.name = 'Disc';
			closureGroup.add(disc);

			// The stem is the disc's own top: a resilient butterfly valve up to 12 inch has a
			// one piece disc and stem, with no pins to work loose. It runs up through the
			// bushings and the stem seal to the square the actuator drives.
			const shaftRadius = d * 0.105;
			const shaftTop = shellRadius + d * 1.4;
			const shaft = new Mesh(
				cyl(registry, shaftRadius, shaftTop + discRadius * 0.4, 24),
				STAINLESS
			);
			shaft.name = 'Stem';
			shaft.position.y = (shaftTop - discRadius * 0.4) / 2;
			closureGroup.add(shaft);

			moving.push({
				object: closureGroup,
				kind: 'rotary',
				axis: new Vector3(0, 1, 0),
				travel: Math.PI / 2,
				restPosition: closureGroup.position.clone(),
				label: 'Disc and shaft'
			});
			break;
		}

		case 'plugPort':
			return buildPlugValve(registry, options);
	}

	root.add(closureGroup);

	// --- Neck, packing and the drive ----------------------------------------
	const neckRadius = d * 0.24;
	const neckHeight = d * 0.5;
	const neck = new Mesh(cyl(registry, neckRadius, neckHeight), CAST_IRON);
	neck.position.y = shellRadius + neckHeight / 2;
	root.add(neck);
	cuttables.push(neck);

	// A quarter turn stem carries two or three packing rings, not six: the stem turns
	// in place rather than sliding through the packing, so there is far less to seal.
	const packing = buildPackingStack(registry, {
		stemRadiusM: d * 0.13,
		boxRadiusM: neckRadius * 0.78,
		ringCount: 3,
		heightM: d * 0.26
	});
	packing.position.y = shellRadius + neckHeight + d * 0.08;
	root.add(packing);

	let topY = shellRadius + neckHeight + d * 0.26;

	if (options.withActuator) {
		// The ISO 5211 pad the actuator bolts to: 90 mm across on an F07 with a 70 mm bolt
		// circle and four M8 studs. It is a published interface, which is the point of it,
		// so a replacement actuator of any make fits without touching the valve.
		const padHeight = d * 0.07;
		const pad = new Mesh(cyl(registry, d * 0.295, padHeight, 32), CAST_IRON);
		pad.name = 'Mounting pad';
		pad.position.y = topY + padHeight / 2;
		root.add(pad);
		cuttables.push(pad);

		for (let i = 0; i < 4; i++) {
			const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
			const stud = new Mesh(
				registry.track(new CylinderGeometry(d * 0.026, d * 0.026, d * 0.1, 8)),
				STEEL_BOLT
			);
			stud.name = 'Pad stud';
			stud.position.set(
				Math.cos(angle) * d * 0.23,
				topY + padHeight + d * 0.02,
				Math.sin(angle) * d * 0.23
			);
			root.add(stud);
		}

		// A rack and pinion actuator, sized from the published envelope rather than from the
		// bore: the F07 class unit this pad takes is 221 mm long and 118 mm across.
		const barrelRadius = d * 0.387;
		const barrelLength = d * 1.45;
		const mountHeight = d * 0.22;

		const mount = new Mesh(slab(registry, d * 0.9, mountHeight, d * 0.5), PAINTED_STEEL);
		mount.name = 'Actuator mount';
		mount.position.y = topY + padHeight + mountHeight / 2;
		root.add(mount);

		const barrel = new Mesh(cyl(registry, barrelRadius, barrelLength, 32), PAINTED_STEEL);
		barrel.name = 'Actuator body';
		barrel.rotation.z = Math.PI / 2;
		barrel.position.set(0, topY + padHeight + mountHeight + barrelRadius, 0);
		root.add(barrel);
		cuttables.push(barrel);

		// The lever that turns the shaft, which swings as the valve strokes.
		const lever = new Group();
		const arm = new Mesh(slab(registry, barrelLength * 0.55, d * 0.1, d * 0.06), PAINTED_STEEL);
		arm.position.x = barrelLength * 0.24;
		lever.add(arm);
		lever.position.set(0, topY + padHeight + mountHeight * 0.5, 0);
		root.add(lever);

		moving.push({
			object: lever,
			kind: 'rotary',
			axis: new Vector3(0, 1, 0),
			travel: Math.PI / 2,
			restPosition: lever.position.clone(),
			label: 'Actuator lever'
		});

		const positionerBody = new Mesh(slab(registry, d * 0.48, d * 0.44, d * 0.3), PAINTED_STEEL);
		positionerBody.name = 'Positioner';
		positionerBody.position.set(0, topY + padHeight + mountHeight + barrelRadius * 2.4, 0);
		root.add(positionerBody);
		cuttables.push(positionerBody);

		// The top of the assembly is the top of the actuator body, so only one of its
		// diameters counts above the pad, not three.
		topY += padHeight + mountHeight + barrelRadius * 2;
	} else if (options.withHandle) {
		// A lever handle, which is what a small quarter turn valve actually has.
		const lever = new Group();
		const arm = new Mesh(slab(registry, d * 1.5, d * 0.09, d * 0.05), CAST_IRON);
		arm.position.x = d * 0.7;
		lever.add(arm);

		const grip = new Mesh(cyl(registry, d * 0.07, d * 0.34, 12), BRASS);
		grip.rotation.z = Math.PI / 2;
		grip.position.x = d * 1.3;
		lever.add(grip);

		lever.position.y = topY + d * 0.12;
		root.add(lever);

		moving.push({
			object: lever,
			kind: 'rotary',
			axis: new Vector3(0, 1, 0),
			travel: Math.PI / 2,
			restPosition: lever.position.clone(),
			label: 'Lever handle'
		});

		topY += d * 0.3;
	}

	root.updateMatrixWorld(true);

	// The stroke a quarter turn valve reports is the arc its reference point travels,
	// so the simulation and the animation agree on what "opening" means.
	return {
		root,
		moving,
		heightM: topY,
		lengthM: faceToFace,
		cuttables,
		strokeM: Math.PI * 0.5 * (d / 2),
		dispose: () => registry.dispose()
	};
}

// ---------------------------------------------------------------------------
// Self acting valves
// ---------------------------------------------------------------------------

/** A swing or dual plate check valve. */
function buildCheckValve(
	registry: GeometryRegistry,
	options: { nominalSizeInch: number; design: 'swing' | 'dualPlate' }
): ValveAssembly {
	const root = new Group();
	const moving: MovingPart[] = [];
	const cuttables: Object3D[] = [];

	const d = referenceBoreM(options.nominalSizeInch);
	const wall = bodyWallM(options.nominalSizeInch);
	const pattern = options.design === 'dualPlate' ? 'dualPlate' : 'check';
	const faceToFace = d * faceToFaceRatio(options.nominalSizeInch, pattern);
	const halfLength = faceToFace / 2;

	if (options.design === 'dualPlate') {
		// A wafer body, only about one bore thick and clamped between two flanges. The
		// thinness is the defining feature of the design and the reason it is used where
		// installation length matters.
		// The wafer is 104 mm across on a DN50 valve, which is the figure Neway and US Valve
		// both publish, and only one bore thick.
		const shell = new Mesh(cyl(registry, d * 1.02, faceToFace, 40, true), CAST_IRON);
		shell.name = 'Wafer body';
		shell.rotation.z = Math.PI / 2;
		root.add(shell);
		cuttables.push(shell);

		for (const side of [-1, 1]) {
			const flange = buildFlange(registry, {
				boreM: d,
				nominalSizeInch: options.nominalSizeInch,
				raisedFace: false
			});
			flange.position.x = side * (halfLength + d * 0.015);
			root.add(flange);
		}

		// The central hinge pin, which must be vertical in horizontal piping: the plates
		// swing on it under their own weight as well as under pressure.
		const pin = new Mesh(cyl(registry, d * 0.055, d * 1.05), STAINLESS);
		pin.name = 'Hinge pin';
		root.add(pin);

		// The stop pin above it, which limits how far the plates open. Without a stop the
		// plates sag past their design angle and the heels drag on the seat.
		const stopPin = new Mesh(cyl(registry, d * 0.045, d * 1.05), STAINLESS);
		stopPin.name = 'Stop pin';
		stopPin.position.x = d * 0.42;
		root.add(stopPin);

		for (const side of [-1, 1]) {
			const half = new Group();

			// A half disc: a semicircular plate whose straight edge is the hinge. The two
			// halves each cover one side of the bore, so together they close the full
			// circle.
			const shape = new Shape();
			shape.absarc(0, 0, d * 0.5, 0, Math.PI, false);
			shape.closePath();
			const plateThickness = d * 0.05;
			const plateGeometry = registry.track(
				new ExtrudeGeometry(shape, { depth: plateThickness, bevelEnabled: false })
			);
			plateGeometry.translate(0, 0, -plateThickness / 2);
			// The shape is drawn in its own plane, so where it ends up on the valve has to
			// be stated outright: the straight edge onto the hinge pin, which stands
			// vertical across the bore, the bulge onto the half of the bore this disc
			// covers, and the thickness along the pipe. Left to a pair of Euler angles the
			// discs ended up hinged on the flow axis, tumbling in place like a butterfly
			// disc instead of swinging open.
			plateGeometry.applyMatrix4(
				new Matrix4().makeBasis(
					new Vector3(0, side, 0),
					new Vector3(0, 0, side),
					new Vector3(1, 0, 0)
				)
			);
			const plate = new Mesh(plateGeometry, STAINLESS);
			half.add(plate);

			// The torsion spring that closes the plate before the flow can reverse. It
			// wraps the pin inboard of the end, which is where a fitter can see it.
			const spring = new Mesh(torus(registry, d * 0.09, d * 0.018), SPRING_STEEL);
			spring.rotation.x = Math.PI / 2;
			spring.position.set(-d * 0.08, side * d * 0.4, 0);
			half.add(spring);

			root.add(half);
			moving.push({
				object: half,
				kind: 'rotary',
				// Both halves hinge on the same pin and both swing downstream. That takes
				// opposite senses of rotation about the pin, the way two doors on one
				// spine open together, so the sense is carried on the axis and the travel
				// stays positive.
				axis: new Vector3(0, side, 0),
				// A dual plate opens to less than a quarter turn: the plates fold back into
				// the bore and stop against the pin above the hinge.
				travel: (80 * Math.PI) / 180,
				restPosition: half.position.clone(),
				label: side > 0 ? 'Upper half disc' : 'Lower half disc'
			});
		}

		root.updateMatrixWorld(true);
		return {
			root,
			moving,
			// The wafer has nothing above the ring, so its height is the ring's radius.
			heightM: d * 1.02,
			lengthM: faceToFace,
			cuttables,
			strokeM: d * 0.05,
			dispose: () => registry.dispose()
		};
	}

	// --- Swing check --------------------------------------------------------
	// The body is a barrel about 118 mm across on a DN50 valve, which is the widest figure
	// the catalogues publish for it, and it is short: the necks carry it out to the flanges.
	const shellRadius = d * 1.16;
	const shellLength = Math.min(faceToFace * 0.6, d * 1.6);
	const flangeThickness = d * flangeThicknessRatio(options.nominalSizeInch);
	const flangeCentre = halfLength - flangeThickness / 2;
	const flangeInnerFace = halfLength - flangeThickness;

	const shell = new Mesh(cyl(registry, shellRadius, shellLength, 40, true), CAST_IRON);
	shell.name = 'Body';
	shell.rotation.z = Math.PI / 2;
	root.add(shell);
	cuttables.push(shell);

	const neckLength = flangeInnerFace - shellLength / 2;
	if (neckLength > 0) {
		for (const side of [-1, 1]) {
			const neck = buildPortNeck(registry, {
				innerRadiusM: d * 0.58 + wall * 0.6,
				outerRadiusM: d * 0.58,
				lengthM: neckLength,
				boreRadiusM: d * 0.46
			});
			neck.position.x = side * (shellLength / 2 + neckLength / 2);
			root.add(neck);
			cuttables.push(neck);
		}
	}

	for (const side of [-1, 1]) {
		const flange = buildFlange(registry, {
			boreM: d,
			nominalSizeInch: options.nominalSizeInch,
			raisedFace: true
		});
		flange.position.x = side * flangeCentre;
		root.add(flange);
	}

	// The seat, inclined so the disc can swing clear of it.
	const seat = buildSeatRing(registry, {
		portRadiusM: d * 0.44,
		outerRadiusM: d * 0.56,
		heightM: d * 0.14,
		face: 'conical'
	});
	seat.rotation.z = Math.PI / 2;
	seat.position.set(-d * 0.18, 0, 0);
	root.add(seat);

	// The hinge pin, across the bore above the seat. The disc swings on it, and it comes
	// out through the cover, which is how the disc is replaced without cutting the valve
	// out of the line.
	const pin = new Mesh(cyl(registry, d * 0.05, shellRadius * 2.1, 16), STAINLESS);
	pin.name = 'Hinge pin';
	pin.rotation.x = Math.PI / 2;
	pin.position.set(-d * 0.28, d * 0.52, 0);
	root.add(pin);

	// The hinge, above the seat, with the disc hanging from it on its arm.
	const hinge = new Group();
	hinge.name = 'Disc assembly';
	hinge.position.set(-d * 0.28, d * 0.52, 0);

	const arm = new Mesh(slab(registry, d * 0.62, d * 0.1, d * 0.07), STAINLESS);
	arm.name = 'Disc arm';
	arm.position.set(d * 0.24, -d * 0.26, 0);
	arm.rotation.z = -Math.PI / 5;
	hinge.add(arm);

	// The disc's rim has to overhang the seat bore to seal on it, and it is thick enough to
	// carry the pressure it holds back.
	const disc = new Mesh(cyl(registry, d * 0.53, d * 0.14, 32), STAINLESS);
	disc.name = 'Disc';
	disc.rotation.z = Math.PI / 2;
	disc.position.set(d * 0.15, -d * 0.52, 0);
	hinge.add(disc);

	// The disc nut and washer that retain the disc on its hinge, which is how the part
	// is replaced without cutting the valve out of the line.
	const discNut = new Mesh(cyl(registry, d * 0.07, d * 0.06, 6), STEEL_BOLT);
	discNut.name = 'Disc nut';
	discNut.rotation.z = Math.PI / 2;
	discNut.position.set(d * 0.32, -d * 0.52, 0);
	hinge.add(discNut);

	root.add(hinge);
	moving.push({
		object: hinge,
		kind: 'rotary',
		axis: new Vector3(0, 0, 1),
		// A swing check opens substantially 90 degrees: the disc ends up parallel to the
		// flow, resting against the body. Eased off 90 so it cannot be driven through the
		// casting it stops against.
		travel: (85 * Math.PI) / 180,
		restPosition: hinge.position.clone(),
		label: 'Disc, hinge arm and nut'
	});

	// The bolted cover, which is the only maintenance access. A check valve has no
	// bonnet, no stem and no packing, and their absence is the point.
	// The casting rises from the barrel to the cover flange, because the disc stands
	// vertically when it is open and needs the room. The cover sits 165 mm above the pipe
	// centreline, which is where Everyvalve, Vastas and Velan all put it.
	const bonnetHeight = d * 3.25 - shellRadius - d * 0.25;
	const bonnet = new Mesh(
		cyl(registry, shellRadius * 0.5, bonnetHeight, 32, true),
		CAST_IRON
	);
	bonnet.name = 'Cover neck';
	bonnet.position.y = shellRadius + bonnetHeight / 2;
	root.add(bonnet);
	cuttables.push(bonnet);

	const coverHeight = d * 0.25;
	const cover = buildCover(registry, {
		radiusM: shellRadius * 0.62,
		heightM: coverHeight,
		boltCount: options.nominalSizeInch <= 2 ? 4 : 6,
		boltCircleM: shellRadius * 0.5,
		boltRadiusM: d * 0.04
	});
	// The top of the cover lands on the published height above the pipe centreline.
	cover.position.y = d * 3.25 - coverHeight / 2;
	root.add(cover);
	cuttables.push(cover);

	root.updateMatrixWorld(true);

	return {
		root,
		moving,
		// The assembly stands as tall as the top of its cover, which the catalogues put 165 mm
		// above the pipe centreline.
		heightM: d * 3.25,
		lengthM: faceToFace,
		cuttables,
		strokeM: d * 0.08,
		dispose: () => registry.dispose()
	};
}

/**
 * A relief valve.
 *
 * The proportions are the ones that make a relief valve recognisable: a narrow nozzle
 * inside a wide body, a spindle up to a spring whose height is a large fraction of the
 * whole valve, an adjusting screw with its lock nut at the top, and a cap. A relief
 * valve is also the one valve in the catalogue whose nozzle is visibly much smaller
 * than its inlet, because it is sized on an orifice rather than on the line.
 */
function buildReliefValve(
	registry: GeometryRegistry,
	options: { setPressureBarGauge: number }
): ValveAssembly {
	const root = new Group();
	const moving: MovingPart[] = [];
	const cuttables: Object3D[] = [];

	// An API J orifice is 36 mm actual diameter inside a 2 inch inlet, so the nozzle is
	// the narrow part of the valve by a wide margin.
	const inletBore = referenceBoreM(2);
	const nozzleBore = 0.036;
	const bodyRadius = nozzleBore * 0.78 + 0.016;
	const bodyHeight = nozzleBore * 2.8;

	// --- Inlet and body -----------------------------------------------------
	const inletStub = buildPipeStub(registry, { boreM: inletBore, lengthM: inletBore * 0.5 });
	inletStub.position.y = -inletBore * 0.25;
	root.add(inletStub);

	const inletFlange = buildFlange(registry, { boreM: inletBore, nominalSizeInch: 2, raisedFace: true });
	inletFlange.name = 'Inlet flange';
	inletFlange.rotation.z = Math.PI / 2;
	inletFlange.position.y = -inletBore * 0.46;
	root.add(inletFlange);

	const shell = new Mesh(cyl(registry, bodyRadius, bodyHeight, 32, true), CAST_IRON);
	shell.name = 'Body';
	shell.position.y = bodyHeight / 2;
	root.add(shell);
	cuttables.push(shell);

	// The outlet, branching sideways so the body drains rather than holding liquid.
	const outletBore = nozzleBore * 0.9;
	const outletStub = buildPipeStub(registry, { boreM: outletBore, lengthM: outletBore * 1.1 });
	outletStub.rotation.z = Math.PI / 2;
	outletStub.position.set(bodyRadius * 0.5 + outletBore * 0.4, bodyHeight * 0.42, 0);
	root.add(outletStub);

	const outletFlange = buildFlange(registry, { boreM: outletBore, nominalSizeInch: 2, raisedFace: true });
	outletFlange.name = 'Outlet flange';
	outletFlange.position.set(bodyRadius * 0.5 + outletBore * 0.95, bodyHeight * 0.42, 0);
	root.add(outletFlange);

	// --- Nozzle, seat and blowdown ring -------------------------------------
	const nozzle = new Mesh(cyl(registry, nozzleBore * 0.5, inletBore * 0.75, 28, true), TRIM);
	nozzle.name = 'Nozzle';
	nozzle.position.y = inletBore * 0.75;
	root.add(nozzle);

	const nozzleSeat = new Mesh(torus(registry, nozzleBore * 0.5, nozzleBore * 0.05), TRIM);
	nozzleSeat.name = 'Nozzle seat';
	nozzleSeat.rotation.x = Math.PI / 2;
	nozzleSeat.position.y = inletBore * 1.12;
	root.add(nozzleSeat);

	// The blowdown adjusting ring: the part that tunes overpressure and blowdown, and
	// the reason those two numbers are a setting rather than a property of the spring.
	const adjustingRing = new Mesh(torus(registry, nozzleBore * 0.62, nozzleBore * 0.05), BRASS);
	adjustingRing.name = 'Blowdown ring';
	adjustingRing.rotation.x = Math.PI / 2;
	adjustingRing.position.y = inletBore * 0.9;
	root.add(adjustingRing);

	// --- Disc, spindle and guide -------------------------------------------
	const discGroup = new Group();

	const disc = new Mesh(cyl(registry, nozzleBore * 0.6, nozzleBore * 0.14, 28), STAINLESS);
	disc.name = 'Disc';
	discGroup.add(disc);

	// The spindle runs from the disc up to the adjusting screw and stops there. Any longer
	// and it leaves the valve through the top of the bonnet.
	const spindleBottom = -inletBore * 0.3;
	const spindleTop = bodyHeight * 0.86;
	const spindle = new Mesh(
		cyl(registry, nozzleBore * 0.11, spindleTop - spindleBottom, 20),
		STAINLESS
	);
	spindle.name = 'Spindle';
	spindle.position.y = (spindleTop + spindleBottom) / 2;
	discGroup.add(spindle);

	// The guide keeps the disc square on its seat. Without it the disc would cock over
	// and leak, which is the classic failure of a poorly guided relief valve.
	const guide = new Mesh(cyl(registry, nozzleBore * 0.26, nozzleBore * 0.36, 20, true), BRASS);
	guide.name = 'Disc guide';
	guide.position.y = nozzleBore * 0.42;
	discGroup.add(guide);

	discGroup.position.y = inletBore * 1.2;
	root.add(discGroup);

	moving.push({
		object: discGroup,
		kind: 'linear',
		axis: new Vector3(0, 1, 0),
		// API full lift is about a quarter of the orifice diameter.
		travel: nozzleBore * 0.25,
		restPosition: discGroup.position.clone(),
		label: 'Disc, spindle and guide'
	});

	// --- Bonnet, spring and adjusting screw ---------------------------------
	const bonnetRadius = bodyRadius * 0.86;
	const bonnetHeight = bodyHeight * 1.6;

	const bonnet = new Mesh(cyl(registry, bonnetRadius, bonnetHeight, 32, true), CAST_IRON);
	bonnet.name = 'Bonnet';
	bonnet.position.y = bodyHeight + bonnetHeight / 2;
	root.add(bonnet);
	cuttables.push(bonnet);

	const bonnetJoint = buildBoltedJoint(registry, {
		radiusM: bonnetRadius * 1.08,
		studCircleM: bonnetRadius * 0.84,
		thicknessM: inletBore * 0.06,
		studRadiusM: inletBore * 0.016,
		studCount: 4
	});
	bonnetJoint.position.y = bodyHeight + inletBore * 0.03;
	root.add(bonnetJoint);

	// The spring: the part that sets the pressure and, by area, the largest thing
	// inside the valve.
	const springHeight = bonnetHeight * 0.6;
	const spring = buildHelicalSpring(registry, {
		coilRadiusM: bonnetRadius * 0.5,
		heightM: springHeight,
		coils: 11,
		wireRadiusM: bonnetRadius * 0.07
	});
	spring.name = 'Spring';
	spring.position.y = bodyHeight + bonnetHeight * 0.5;
	root.add(spring);

	// The spring plates: the lower one takes the spindle force, the upper one the
	// adjusting screw.
	const lowerPlate = new Mesh(cyl(registry, bonnetRadius * 0.6, inletBore * 0.035), STEEL_BOLT);
	lowerPlate.name = 'Lower spring plate';
	lowerPlate.position.y = bodyHeight + bonnetHeight * 0.2;
	root.add(lowerPlate);

	const upperPlate = new Mesh(cyl(registry, bonnetRadius * 0.6, inletBore * 0.035), STEEL_BOLT);
	upperPlate.name = 'Upper spring plate';
	upperPlate.position.y = bodyHeight + bonnetHeight * 0.81;
	root.add(upperPlate);

	// The adjusting screw and its lock nut, which set the spring compression and then
	// lock it. On a real valve this is sealed so the set pressure cannot drift.
	const adjustingScrew = buildHexHead(registry, {
		acrossFlatsM: inletBore * 0.085,
		heightM: bonnetHeight * 0.26
	});
	adjustingScrew.position.y = bodyHeight + bonnetHeight * 0.95;
	root.add(adjustingScrew);

	const lockNut = buildHexHead(registry, {
		acrossFlatsM: inletBore * 0.095,
		heightM: inletBore * 0.045
	});
	lockNut.position.y = bodyHeight + bonnetHeight * 0.87;
	root.add(lockNut);

	// The cap, which keeps the weather out of the spring chamber.
	const cap = new Mesh(cyl(registry, bonnetRadius * 0.74, bonnetHeight * 0.2, 32), PAINTED_STEEL);
	cap.name = 'Cap';
	cap.position.y = bodyHeight + bonnetHeight * 1.09;
	root.add(cap);
	cuttables.push(cap);

	// The lifting lever, used to test the valve by hand. It sits outside the valve on a
	// fulcrum on the bonnet and presses a pin that runs through the cap to the top of the
	// spindle, so pulling the outer end down lifts the disc off its seat.
	const capTop = bodyHeight + bonnetHeight * 1.19;

	const liftingPin = new Mesh(
		cyl(registry, nozzleBore * 0.055, bonnetHeight * 0.36, 16),
		STAINLESS
	);
	liftingPin.name = 'Lifting pin';
	liftingPin.position.y = capTop - bonnetHeight * 0.12;
	root.add(liftingPin);

	// The fulcrum the lever pivots on, standing on the cap.
	const fulcrum = new Mesh(
		slab(registry, inletBore * 0.05, bonnetHeight * 0.12, bonnetRadius * 0.5),
		CAST_IRON
	);
	fulcrum.name = 'Lever fulcrum';
	fulcrum.position.set(0, capTop + bonnetHeight * 0.04, 0);
	root.add(fulcrum);

	const lever = new Group();
	lever.name = 'Lifting lever';
	const leverArm = new Mesh(slab(registry, bonnetRadius * 2.2, inletBore * 0.05, inletBore * 0.04), BRASS);
	// The inner end reaches over the lifting pin, so the arm is offset the other way from
	// where it was: pulling the far end down is what raises the pin.
	leverArm.position.x = bonnetRadius * 1.1;
	lever.add(leverArm);
	lever.position.set(0, capTop + bonnetHeight * 0.1, 0);
	root.add(lever);

	moving.push({
		object: lever,
		kind: 'rotary',
		axis: new Vector3(0, 0, 1),
		travel: (25 * Math.PI) / 180,
		restPosition: lever.position.clone(),
		label: 'Lifting lever'
	});

	root.updateMatrixWorld(true);

	void options.setPressureBarGauge;

	return {
		root,
		moving,
		heightM: bodyHeight + bonnetHeight * 1.25,
		lengthM: bodyRadius * 3.6,
		cuttables,
		strokeM: nozzleBore * 0.25,
		dispose: () => registry.dispose()
	};
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

/** Build the geometry for a valve in the catalogue. */
export function buildValveAssembly(id: ValveId, options: ValveBuildOptions): ValveAssembly {
	const registry = new GeometryRegistry();
	const d = referenceBoreM(options.nominalSizeInch);

	// The travel comes from the valve pattern rather than from one figure for every
	// valve, because the difference is large and the user can see it: a gate retracts
	// its wedge clear of the port and needs about one bore, while a globe plug only has
	// to leave its seat and needs a quarter of that.
	const strokeFor = (pattern: 'gate' | 'globe'): number =>
		options.strokeM ?? d * travelRatio(options.nominalSizeInch, pattern);

	switch (id) {
		case 'gate':
			return buildLinearValve(registry, {
				nominalSizeInch: options.nominalSizeInch,
				strokeM: strokeFor('gate'),
				character: 'gate',
				balanced: false,
				withPositioner: false,
				withHandwheel: true
			});

		case 'globe':
			return buildLinearValve(registry, {
				nominalSizeInch: options.nominalSizeInch,
				strokeM: strokeFor('globe'),
				character: 'globe',
				balanced: false,
				withPositioner: false,
				withHandwheel: true
			});

		case 'controlValve':
			return buildLinearValve(registry, {
				nominalSizeInch: options.nominalSizeInch,
				// A control valve plug travels about three quarters of a bore: more than a
				// globe because it has to reach its full rated capacity, less than a gate
				// because it never has to clear the port entirely.
				strokeM: options.strokeM ?? d * 0.75,
				character: 'control',
				balanced: options.balanced,
				withPositioner: options.withPositioner,
				withHandwheel: false
			});

		case 'ball':
			return buildBallValve(registry, {
				nominalSizeInch: options.nominalSizeInch,
				closure: 'ballBore',
				withActuator: false,
				withHandle: true
			});

		case 'ballCharacterised':
			return buildBallValve(registry, {
				nominalSizeInch: options.nominalSizeInch,
				closure: 'ballVNotch',
				withActuator: options.withPositioner,
				withHandle: !options.withPositioner
			});

		case 'butterfly':
			return buildRotaryValve(registry, {
				nominalSizeInch: options.nominalSizeInch,
				closure: 'disc',
				withActuator: options.withPositioner,
				withHandle: !options.withPositioner
			});

		case 'plug':
			return buildRotaryValve(registry, {
				nominalSizeInch: options.nominalSizeInch,
				closure: 'plugPort',
				withActuator: false,
				withHandle: true
			});

		case 'check-swing':
			return buildCheckValve(registry, { nominalSizeInch: options.nominalSizeInch, design: 'swing' });

		case 'check-dualPlate':
			return buildCheckValve(registry, {
				nominalSizeInch: options.nominalSizeInch,
				design: 'dualPlate'
			});

		case 'relief':
			return buildReliefValve(registry, {
				setPressureBarGauge: options.setPressureBarGauge ?? 10
			});
	}
}

export { GHOST };
