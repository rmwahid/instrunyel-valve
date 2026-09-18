/**
 * The outside screw and yoke assembly: the parts of a steel gate or globe valve that
 * sit above the body.
 *
 * This is a separate module from `parts.ts` because the assembly is the largest part
 * of a real valve and the most detailed. Above the body of a steel gate valve there
 * are about twenty identifiable parts, and drawing them is what separates a model
 * that reads like a datasheet from one that reads like a pipe fitting with a knob on
 * it.
 *
 * The two proportions that matter most, measured from manufacturer drawings:
 *
 *  - A gate valve is mostly an empty frame. Of the open height, the body is 39
 *    percent, the bonnet and stuffing box 20 percent, the yoke 22 percent, and the
 *    stem nut and handwheel assembly 18 percent. A globe valve is distributed
 *    differently, with more bonnet and less body.
 *  - The bolted bonnet joint with its ring of studs and heavy hex nuts is the second
 *    visual signature, and its shape is a specification rather than a style: API 600
 *    5.5.6 allows a non-circular joint only for Class 150 valves and for sizes up to
 *    NPS 2 1/2, so a Class 150 gate valve has an oval joint while a globe valve of the
 *    same size has a circular one.
 *
 * Sources: API STD 600 13th edition (stem diameter, packing box, bolting, handwheel
 * limits, backseat, gland), ASME B18.2.2 (heavy hex nut dimensions), and the
 * dimension tables and exploded views of L&T, Velan, Powell and JC Valves.
 */

import { BoxGeometry, CylinderGeometry, Group, Mesh } from 'three';
import {
	buildAnnulus,
	buildHelicalSpring,
	buildPipeStub,
	cyl,
	GeometryRegistry,
	torus
} from './parts';
import {
	BRASS,
	CAST_IRON,
	GASKET,
	GRAPHITE_PACKING,
	NAMEPLATE,
	STAINLESS,
	STEEL_BOLT
} from './materials';

// ---------------------------------------------------------------------------
// Sizes the standards fix
// ---------------------------------------------------------------------------

/**
 * Minimum stem diameter from API 600 13th edition Table 5, in metres.
 *
 * The standard gives a floor, not the bar a manufacturer actually uses: drawings show
 * the next standard size up in most cases. The floor is used here because it is the
 * only published figure, and the model adds the visible thickness of the thread on top
 * of it.
 */
export function stemDiameterM(nominalSizeInch: number): number {
	const table: readonly (readonly [number, number])[] = [
		[2, 0.01905], // 3/4 in
		[3, 0.02223], // 7/8 in
		[4, 0.0254], // 1 in
		[6, 0.02858] // 1 1/8 in
	];
	if (nominalSizeInch <= table[0][0]) return table[0][1];
	for (let i = 1; i < table.length; i++) {
		if (nominalSizeInch <= table[i][0]) {
			const [lowSize, lowValue] = table[i - 1];
			const [highSize, highValue] = table[i];
			const t = (nominalSizeInch - lowSize) / (highSize - lowSize);
			return lowValue + t * (highValue - lowValue);
		}
	}
	return table[table.length - 1][1];
}

/**
 * The radial width of one packing ring, from API 600 Table 6, in metres.
 *
 * The table is indexed by stem diameter, not by valve size, because it is the stem
 * that the packing seals against.
 */
export function packingWidthM(stemDiameterMetres: number): number {
	const stemMm = stemDiameterMetres * 1000;
	if (stemMm <= 27) return 0.0064; // 1/4 in
	if (stemMm <= 37) return 0.0079; // 5/16 in
	return 0.0095; // 3/8 in
}

/**
 * Bonnet stud radius from API 600 5.5.8, in metres.
 *
 * The standard sets a minimum stud size by valve size: M10 or 3/8 in up to NPS 2 1/2,
 * and M12 or 1/2 in from NPS 3 to 8. It also requires at least four studs.
 */
export function bonnetStudRadiusM(nominalSizeInch: number): number {
	return nominalSizeInch <= 2.5 ? 0.005 : 0.006;
}

/** How many studs the joint carries. Four is the API minimum and what a small valve has. */
export function bonnetStudCount(nominalSizeInch: number): number {
	return nominalSizeInch <= 2.5 ? 4 : 8;
}

/**
 * Heavy hex nut across-flats, from ASME B18.2.2.
 *
 * A heavy hex nut is about 1.75 times its nominal diameter across the flats, where an
 * ordinary hex nut is about 1.5. Valves use heavy hex because the bolting is loaded to
 * gasket seating stress, and the difference is visible: a valve nut looks
 * disproportionately chunky next to the stud it sits on.
 */
export function heavyHexRadiusM(studRadiusM: number): number {
	return studRadiusM * 1.75;
}

/** Height of a heavy hex nut, about 1.0 times the nominal diameter. */
export function heavyHexHeightM(studRadiusM: number): number {
	return studRadiusM * 2;
}

// ---------------------------------------------------------------------------
// The bolted bonnet joint
// ---------------------------------------------------------------------------

/**
 * The body to bonnet joint: two flanges, a gasket, and a ring of through studs with
 * heavy hex nuts.
 *
 * Three details make this read as a real joint rather than as a flange:
 *
 *  - The stud is a through stud, so a length of plain thread shows below the lower
 *    flange. A bolt with a head would be wrong.
 *  - Every nut sits on a spot-faced pad, because API 600 5.5.7 requires the nut bearing
 *    surface to be parallel to the flange face and spot facing is how that is done.
 *  - The gasket is drawn as a thin band so the section view shows it, which is the
 *    whole reason the joint is sectioned in a cutaway drawing.
 */
export function buildBoltedBonnetJoint(
	registry: GeometryRegistry,
	options: {
		/** Gasket mean radius, which sets the flange size. */
		meanRadiusM: number;
		studRadiusM: number;
		studCount: number;
		thicknessM: number;
		/**
		 * Stretch the flange along the flow axis. A Class 150 gate valve has an oval
		 * joint, which is the oval gasket and flange the manufacturer drawings show.
		 */
		oval?: boolean;
	}
): Group {
	const group = new Group();
	group.name = 'Bonnet joint';

	const flangeRadius = options.meanRadiusM * 1.32;
	const flangeThickness = options.thicknessM;
	const stretch = options.oval ? 1.45 : 1;
	const nutRadius = heavyHexRadiusM(options.studRadiusM);
	const nutHeight = heavyHexHeightM(options.studRadiusM);

	// The flange pair. Both are drawn because the joint is a joint, not a single flange.
	for (const side of [-1, 1]) {
		const rim = new Mesh(cyl(registry, flangeRadius, flangeThickness * 0.55, 40), CAST_IRON);
		rim.scale.set(stretch, 1, 1);
		rim.position.y = side * flangeThickness * 0.3;
		group.add(rim);
	}

	// The gasket.
	const gasket = new Mesh(cyl(registry, options.meanRadiusM, flangeThickness * 0.18, 40), GASKET);
	gasket.scale.set(stretch, 1, 1);
	group.add(gasket);

	const boltCircle = flangeRadius * 0.84;
	for (let i = 0; i < options.studCount; i++) {
		const angle = (i / options.studCount) * Math.PI * 2 + Math.PI / options.studCount;
		const x = Math.cos(angle) * boltCircle * stretch;
		const z = Math.sin(angle) * boltCircle;

		// The stud, passing right through both flanges with thread showing at each end.
		const stud = new Mesh(
			cyl(registry, options.studRadiusM, flangeThickness * 2.1, 10),
			STEEL_BOLT
		);
		stud.position.set(x, 0, z);
		group.add(stud);

		// The spot face.
		const pad = new Mesh(
			cyl(registry, nutRadius * 1.15, flangeThickness * 0.16, 16),
			CAST_IRON
		);
		pad.position.set(x, flangeThickness * 0.62, z);
		group.add(pad);

		// The heavy hex nut above the pad, which is the end a fitter turns.
		const nut = new Mesh(
			registry.track(new CylinderGeometry(nutRadius, nutRadius, nutHeight, 6)),
			STEEL_BOLT
		);
		nut.position.set(x, flangeThickness * 0.7 + nutHeight / 2, z);
		group.add(nut);
	}

	return group;
}

// ---------------------------------------------------------------------------
// The stuffing box
// ---------------------------------------------------------------------------

/**
 * The stuffing box stack: backseat bushing, spacer, packing rings, gland, gland flange,
 * two eyebolts.
 *
 * The order matters and is the order a maintenance procedure follows. From the bottom:
 *
 *  - The backseat bushing screws into the throat of the bonnet. It does two jobs: it
 *    closes the bottom of the box so the packing cannot extrude downward, and its cone
 *    is the seat the stem shoulder lands on when the valve is fully open, which
 *    isolates the packing from line pressure.
 *  - A spacer ring, then the packing rings. Five is the API 600 minimum and the number
 *    a manufacturer section shows.
 *  - The gland, which has an outer shoulder so it cannot fall into the box.
 *  - The gland flange with exactly two holes and no slots, loaded by two eyebolts that
 *    pivot on a groove pin so the flange can be lifted clear without losing them.
 */
export function buildStuffingBox(
	registry: GeometryRegistry,
	options: {
		stemRadiusM: number;
		/** Depth of the packing box, from the backseat bushing to the top face. */
		depthM: number;
		/** Radius of the box bore at the top, where the gland enters. */
		boxRadiusM: number;
		ringCount?: number;
	}
): Group {
	const group = new Group();
	group.name = 'Stuffing box';
	const stemRadius = options.stemRadiusM;
	const boxRadius = options.boxRadiusM;
	const ringCount = options.ringCount ?? 5;
	const bottom = -options.depthM / 2;

	// The backseat bushing, with its external thread suggested by a ribbed band.
	const bushingHeight = options.depthM * 0.17;
	const bushing = new Mesh(cyl(registry, boxRadius * 0.96, bushingHeight, 28), STAINLESS);
	bushing.position.y = bottom + bushingHeight / 2;
	group.add(bushing);
	for (let i = 0; i < 3; i++) {
		const rib = new Mesh(
			torus(registry, boxRadius * 0.97, bushingHeight * 0.07),
			STAINLESS
		);
		rib.rotation.x = Math.PI / 2;
		rib.position.y = bottom + bushingHeight * (0.2 + i * 0.3);
		group.add(rib);
	}

	// The conical backseat face, which is what the stem shoulder seals against.
	const cone = new Mesh(
		registry.track(
			new CylinderGeometry(stemRadius * 1.85, stemRadius * 1.2, bushingHeight * 0.45, 28)
		),
		STAINLESS
	);
	cone.position.y = bottom + bushingHeight * 1.15;
	group.add(cone);

	// The spacer ring.
	const spacerHeight = options.depthM * 0.06;
	const spacer = new Mesh(cyl(registry, boxRadius, spacerHeight, 28), STAINLESS);
	spacer.position.y = bottom + bushingHeight * 1.4 + spacerHeight / 2;
	group.add(spacer);

	// The packing rings.
	const stackBottom = bottom + bushingHeight * 1.4 + spacerHeight;
	const stackHeight = options.depthM * 0.6;
	const ringHeight = stackHeight / ringCount;
	for (let i = 0; i < ringCount; i++) {
		const ring = new Mesh(cyl(registry, boxRadius, ringHeight * 0.88, 28), GRAPHITE_PACKING);
		ring.position.y = stackBottom + (i + 0.5) * ringHeight;
		group.add(ring);
	}

	// The gland, with its shoulder.
	const glandBottom = stackBottom + stackHeight;
	const glandBody = new Mesh(cyl(registry, boxRadius * 0.97, options.depthM * 0.15, 28), BRASS);
	glandBody.position.y = glandBottom + options.depthM * 0.075;
	group.add(glandBody);

	const glandShoulder = new Mesh(
		cyl(registry, boxRadius * 1.2, options.depthM * 0.07, 28),
		BRASS
	);
	glandShoulder.position.y = glandBottom + options.depthM * 0.18;
	group.add(glandShoulder);

	// The gland flange, a two eared plate with one hole per ear.
	const flangeY = glandBottom + options.depthM * 0.27;
	const flangeHalfWidth = boxRadius * 1.85;
	const earRadius = options.stemRadiusM * 0.5;
	group.add(
		buildGlandFlange(registry, {
			halfWidthM: flangeHalfWidth,
			thicknessM: options.depthM * 0.1,
			earRadiusM: earRadius,
			stemRadiusM: options.stemRadiusM
		}).translateY(flangeY)
	);

	// The two eyebolts and their nuts, which are the only gland fasteners allowed.
	for (const side of [-1, 1]) {
		const boltRadius = earRadius * 0.5;

		const shank = new Mesh(
			cyl(registry, boltRadius, options.depthM * 0.55, 10),
			STEEL_BOLT
		);
		shank.position.set(side * flangeHalfWidth, flangeY + options.depthM * 0.12, 0);
		group.add(shank);

		const eye = new Mesh(torus(registry, boltRadius * 1.7, boltRadius * 0.42), STEEL_BOLT);
		eye.rotation.y = Math.PI / 2;
		eye.position.set(side * flangeHalfWidth, flangeY - options.depthM * 0.12, 0);
		group.add(eye);

		const nut = new Mesh(
			registry.track(
				new CylinderGeometry(boltRadius * 2.1, boltRadius * 2.1, boltRadius * 2.4, 6)
			),
			STEEL_BOLT
		);
		nut.position.set(side * flangeHalfWidth, flangeY + options.depthM * 0.38, 0);
		group.add(nut);
	}

	// The groove pin the eyebolts pivot on.
	const pin = new Mesh(cyl(registry, earRadius * 0.22, flangeHalfWidth * 2.1, 8), STEEL_BOLT);
	pin.rotation.z = Math.PI / 2;
	pin.position.y = flangeY - options.depthM * 0.12;
	group.add(pin);

	return group;
}

/** The gland flange: a plate with an ear on each side and a hole in each ear. */
function buildGlandFlange(
	registry: GeometryRegistry,
	options: { halfWidthM: number; thicknessM: number; earRadiusM: number; stemRadiusM: number }
): Group {
	const group = new Group();
	group.name = 'Gland flange';
	const centreRadius = options.halfWidthM * 0.42;

	// The centre plate is a washer, not a disc. The stem passes through it, and its bore
	// clears the packing follower that sits below rather than the stem itself, which is
	// what lets the flange slide down to compress the packing.
	const plate = buildAnnulus(registry, {
		innerRadiusM: options.stemRadiusM * 1.35,
		outerRadiusM: centreRadius,
		heightM: options.thicknessM
	});
	group.add(plate);

	// Two ears reaching out to the eyebolts.
	for (const side of [-1, 1]) {
		const ear = new Mesh(
			registry.track(
				new CylinderGeometry(options.earRadiusM * 1.9, options.earRadiusM * 1.9, options.thicknessM, 20)
			),
			BRASS
		);
		ear.position.x = side * options.halfWidthM;
		group.add(ear);

		// The web bridges the plate to the ear, so it starts at the plate's rim rather
		// than at the axis. Run from the centre it would be drawn straight through the
		// bore the stem passes down.
		const webStart = centreRadius * 0.8;
		const webEnd = options.halfWidthM;
		const web = new Mesh(
			registry.track(
				new CylinderGeometry(
					options.thicknessM * 0.9,
					options.thicknessM * 0.9,
					webEnd - webStart,
					8
				)
			),
			BRASS
		);
		web.rotation.z = Math.PI / 2;
		web.position.x = side * (webStart + webEnd) / 2;
		group.add(web);
	}

	return group;
}

// ---------------------------------------------------------------------------
// The yoke
// ---------------------------------------------------------------------------

/**
 * The open yoke: two cast legs with daylight between them, and the machined cap that
 * carries the stem nut.
 *
 * The openness is the point. A yoke exists so the rising stem and its thread can be
 * watched while the valve operates, which is what "outside screw and yoke" means. A
 * closed or solid upper structure never reads as this family of valve.
 *
 * The legs splay outward from the stuffing box to the cap, which is the shape of the
 * casting: narrow where it meets the bonnet, wider where it carries the handwheel
 * thrust.
 */
export function buildOpenYoke(
	registry: GeometryRegistry,
	options: {
		heightM: number;
		baseHalfWidthM: number;
		topHalfWidthM: number;
		legWidthM: number;
		legDepthM: number;
		capRadiusM: number;
		capThicknessM: number;
	}
): Group {
	const group = new Group();
	group.name = 'Yoke';

	// Each leg is a stack of short segments rather than a single slab, so it can splay.
	// A single leaning slab would change thickness along its length, which a casting
	// does not do.
	const segments = 6;
	for (const side of [-1, 1]) {
		for (let i = 0; i < segments; i++) {
			const t = (i + 0.5) / segments;
			const halfWidth =
				options.baseHalfWidthM + (options.topHalfWidthM - options.baseHalfWidthM) * t;
			const segment = new Mesh(
				geometryBox(registry, options.legWidthM, options.heightM / segments, options.legDepthM),
				CAST_IRON
			);
			segment.position.set(side * halfWidth, options.heightM * t, 0);
			group.add(segment);
		}
	}

	// The yoke cap: the machined pad that carries the stem nut and its thrust bearing.
	// It is bored, because the stem nut hangs down through it, and drawn open ended so
	// the bore is there to see rather than hidden behind a solid face.
	const cap = new Mesh(
		cyl(registry, options.capRadiusM, options.capThicknessM, 32, true),
		CAST_IRON
	);
	cap.position.y = options.heightM + options.capThicknessM / 2;
	group.add(cap);

	// The grease fitting on the side of the cap, which API 600 5.7.4 requires at the
	// stem nut bearing.
	const fitting = new Mesh(
		registry.track(
			new CylinderGeometry(
				options.capRadiusM * 0.15,
				options.capRadiusM * 0.15,
				options.capRadiusM * 0.55,
				6
			)
		),
		BRASS
	);
	fitting.rotation.z = Math.PI / 2;
	fitting.position.set(
		options.capRadiusM * 1.15,
		options.heightM + options.capThicknessM * 0.55,
		0
	);
	group.add(fitting);

	return group;
}

/**
 * The stem nut, or yoke sleeve: the bronze nut that turns in the yoke cap and drives
 * the threaded stem.
 *
 * This is the part that rotates when the handwheel is turned, which is why it is
 * returned separately from the yoke so the scene can spin it. On a rising stem valve
 * the wheel, the nut and the stem all turn together while the stem rises through the
 * nut, so the nut is the interface between the operator and the moving stem.
 */
export function buildStemNut(
	registry: GeometryRegistry,
	options: {
		stemRadiusM: number;
		capRadiusM: number;
		capThicknessM: number;
		/** Length of threaded engagement. API 600 requires 1.5 stem diameters. */
		engagementM: number;
	}
): Group {
	const group = new Group();
	group.name = 'Stem nut';
	const nutRadius = options.capRadiusM * 0.5;
	const collarThickness = options.capThicknessM * 0.3;
	const hexHeight = options.stemRadiusM * 1.6;
	const retainerThickness = options.capThicknessM * 0.3;

	// The origin is the thrust face, which is the top of the yoke cap: the nut bears down
	// on the cap when the valve is opened, so that face is what the rest is measured from.

	// The threaded sleeve, which descends through the cap bore and turns on the stem.
	const sleeve = new Mesh(cyl(registry, nutRadius, options.engagementM, 28), BRASS);
	sleeve.position.y = -options.engagementM / 2;
	group.add(sleeve);

	// The thrust collar that bears on the cap face.
	const collar = new Mesh(cyl(registry, nutRadius * 1.4, collarThickness, 28), BRASS);
	collar.position.y = collarThickness / 2;
	group.add(collar);

	// The hexagonal drive the handwheel mounts on. API 600 5.8.11 allows a hexagonal
	// interface or a keyed round one, and the hex is what most makers use.
	const hex = new Mesh(
		registry.track(new CylinderGeometry(nutRadius * 0.7, nutRadius * 0.7, hexHeight, 6)),
		BRASS
	);
	hex.position.y = collarThickness + hexHeight / 2;
	group.add(hex);

	// The retainer that locks the nut into the cap. It must be positively locked, which
	// is why it is drawn as a nut rather than as a plain cap.
	const retainer = new Mesh(cyl(registry, nutRadius * 1.15, retainerThickness, 28), STAINLESS);
	retainer.position.y = collarThickness + hexHeight + retainerThickness / 2;
	group.add(retainer);

	return group;
}

/**
 * Where the handwheel hub sits above the yoke cap face, which is the middle of the
 * stem nut's hex drive.
 *
 * The wheel and the nut are cut to the same drive, so anything that moves one has to
 * move the other. Reading both from here is what keeps them together; the wheel used to
 * be placed by an unrelated expression and floated clear of the hex.
 */
export function stemNutWheelSeatM(options: {
	stemRadiusM: number;
	capThicknessM: number;
}): number {
	const collarThickness = options.capThicknessM * 0.3;
	const hexHeight = options.stemRadiusM * 1.6;
	return collarThickness + hexHeight / 2;
}

// ---------------------------------------------------------------------------
// The handwheel
// ---------------------------------------------------------------------------

/**
 * A cast handwheel: five spokes, a round section rim, and a hub.
 *
 * API 600 5.11.2 limits the wheel to six spokes, and the manufacturer exploded views
 * show five, so five is what is drawn. The rim is a round section torus rather than a
 * flat ring because that is what a casting is, and each spoke tapers from a thick hub
 * to a thin rim, which is both how the casting looks and how the load runs.
 *
 * The wheel is marked OPEN with an arrow on a real valve and turns clockwise to close.
 */
export function buildCastHandwheel(
	registry: GeometryRegistry,
	options: { radiusM: number; spokes?: number; hubHeightM: number }
): Group {
	const group = new Group();
	group.name = 'Handwheel';
	const spokeCount = options.spokes ?? 5;
	const rimTube = options.radiusM * 0.1;
	const hubRadius = options.radiusM * 0.2;

	const rim = new Mesh(torus(registry, options.radiusM, rimTube), CAST_IRON);
	rim.rotation.x = Math.PI / 2;
	group.add(rim);

	for (let i = 0; i < spokeCount; i++) {
		const angle = (i / spokeCount) * Math.PI * 2;
		const direction = { x: Math.cos(angle), z: -Math.sin(angle) };

		// A spoke is drawn in two pieces so it can taper.
		const nearHub = new Mesh(
			geometryBox(registry, options.radiusM * 0.3, hubRadius * 1.4, hubRadius * 0.85),
			CAST_IRON
		);
		nearHub.position.set(
			direction.x * options.radiusM * 0.33,
			0,
			direction.z * options.radiusM * 0.33
		);
		nearHub.rotation.y = -angle;
		group.add(nearHub);

		const nearRim = new Mesh(
			geometryBox(registry, options.radiusM * 0.42, rimTube * 1.4, rimTube * 1.0),
			CAST_IRON
		);
		nearRim.position.set(
			direction.x * options.radiusM * 0.7,
			0,
			direction.z * options.radiusM * 0.7
		);
		nearRim.rotation.y = -angle;
		group.add(nearRim);
	}

	const hub = new Mesh(cyl(registry, hubRadius, options.hubHeightM, 24), CAST_IRON);
	group.add(hub);

	return group;
}

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------

/**
 * The nameplate with its two rivets.
 *
 * Every valve carries one and it is fixed with rivets rather than screws, which is what
 * the manufacturer parts lists show. It is a small part, but it is one of the details
 * that tells a viewer they are looking at a real valve.
 */
export function buildNameplate(
	registry: GeometryRegistry,
	options: { widthM: number; heightM: number }
): Group {
	const group = new Group();
	group.name = 'Nameplate';
	const thickness = options.heightM * 0.14;

	const plate = new Mesh(
		geometryBox(registry, options.widthM, options.heightM, thickness),
		NAMEPLATE
	);
	group.add(plate);

	for (const side of [-1, 1]) {
		const rivet = new Mesh(cyl(registry, thickness * 0.55, thickness * 2.4, 6), STAINLESS);
		rivet.rotation.z = Math.PI / 2;
		rivet.position.x = side * options.widthM * 0.34;
		group.add(rivet);
	}

	return group;
}

/**
 * The threaded part of the stem, drawn as a helical ridge.
 *
 * API 600 requires a trapezoidal ACME thread, left hand, with an engagement of at least
 * one and a half stem diameters. Drawing it matters because the exposed thread between
 * the stuffing box and the stem nut is one of the things a viewer looks at to tell an
 * outside screw valve from an inside screw one.
 */
export function buildStemThread(
	registry: GeometryRegistry,
	options: { stemRadiusM: number; lengthM: number; pitchM: number }
): Group {
	const coils = Math.max(4, Math.round(options.lengthM / options.pitchM));
	return buildHelicalSpring(registry, {
		coilRadiusM: options.stemRadiusM * 0.98,
		heightM: options.lengthM,
		coils,
		wireRadiusM: options.stemRadiusM * 0.15,
		segmentsPerCoil: 10
	});
}

/** A short stub of pipe with a flange, for a valve that ends in a flange. */
export function buildFlangedEnd(
	registry: GeometryRegistry,
	options: { boreM: number; lengthM: number; nominalSizeInch: number }
): Group {
	return buildPipeStub(registry, { boreM: options.boreM, lengthM: options.lengthM });
}

/**
 * A box, registered for disposal.
 *
 * Named differently from the geometry types so a local helper cannot shadow an
 * imported class, which produces a confusing "not callable" error.
 */
function geometryBox(
	registry: GeometryRegistry,
	width: number,
	height: number,
	depth: number
): import('three').BufferGeometry {
	return registry.track(new BoxGeometry(width, height, depth));
}
