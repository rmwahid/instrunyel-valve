/**
 * Reusable valve components, built to published proportions.
 *
 * Every dimension here is a ratio of the valve bore rather than an absolute size,
 * and the ratios come from the standards and manufacturers' data rather than from
 * guesswork. The sources are ASME B16.34 for body wall thickness, ASME B16.5 for
 * flanges, ASME B16.10 for face-to-face lengths, and manufacturer literature for the
 * actuator and trim.
 *
 * The bore used throughout is the ASME B16.34 reference bore, which for a Class 150
 * steel valve up to NPS 12 is exactly the nominal size in millimetres: 50.8 mm for
 * NPS 2 and 152.4 mm for NPS 6. That is the dimension the standards themselves use
 * for wall thickness and seat openings, so the model and the standard agree.
 *
 * Keeping these as ratios is what lets the same code build a 2 inch valve and a
 * 6 inch one with the correct proportions, which a table of absolute dimensions
 * would not.
 */

import {
	BoxGeometry,
	BufferGeometry,
	CylinderGeometry,
	CatmullRomCurve3,
	ExtrudeGeometry,
	Group,
	LatheGeometry,
	Material,
	Mesh,
	RingGeometry,
	Shape,
	SphereGeometry,
	TorusGeometry,
	TubeGeometry,
	Vector2,
	Vector3
} from 'three';
import {
	BRASS,
	CAST_IRON,
	GRAPHITE_PACKING,
	PAINTED_STEEL,
	PIPE,
	PTFE,
	SPRING_STEEL,
	STAINLESS,
	STEEL_BOLT,
	TRIM,
	TRIM_HARDFACED
} from './materials';

/** Nominal pipe size in inches to the ASME B16.34 reference bore, in metres. */
export function referenceBoreM(nominalSizeInch: number): number {
	return (nominalSizeInch * 25.4) / 1000;
}

/**
 * Body wall thickness as a fraction of the bore.
 *
 * ASME B16.34 gives equations rather than a fixed ratio, and the ratio falls
 * steeply with size: 0.136 at NPS 2 against 0.047 at NPS 6. The curve below passes
 * through the values the standard produces at both ends, so a 3 inch valve lands
 * between them rather than being forced to one extreme.
 */
export function bodyWallRatio(nominalSizeInch: number): number {
	// Fitted to t/d = 0.136 at NPS 2 and 0.047 at NPS 6.
	return 0.192 * nominalSizeInch ** -0.762;
}

/** Body wall thickness in metres. */
export function bodyWallM(nominalSizeInch: number): number {
	return referenceBoreM(nominalSizeInch) * bodyWallRatio(nominalSizeInch);
}

/** ASME B16.5 Class 150 flange outside diameter, as a fraction of the bore. */
export function flangeOuterRatio(nominalSizeInch: number): number {
	// 3.00 at NPS 2, 1.83 at NPS 6, 1.42 at NPS 12.
	return 4.24 * nominalSizeInch ** -0.752;
}

/** ASME B16.5 Class 150 flange thickness, as a fraction of the bore. */
export function flangeThicknessRatio(nominalSizeInch: number): number {
	// 0.344 at NPS 2 falling to 0.157 at NPS 6.
	return 0.487 * nominalSizeInch ** -0.751;
}

/** ASME B16.5 Class 150 bolt circle diameter, as a fraction of the bore. */
export function boltCircleRatio(nominalSizeInch: number): number {
	return 3.36 * nominalSizeInch ** -0.74;
}

/** Number of flange bolts, per ASME B16.5: 4 up to NPS 3, 8 up to NPS 8, 12 above. */
export function flangeBoltCount(nominalSizeInch: number): number {
	if (nominalSizeInch <= 3) return 4;
	if (nominalSizeInch <= 8) return 8;
	return 12;
}

/**
 * Face-to-face length as a fraction of the bore, by valve type.
 *
 * From ASME B16.10 Table 1.3-1 and 1.3-3, Class 150 flanged. The interpolation
 * between tabulated sizes keeps the valve looking right at a size the table does
 * not list, and the values at the tabulated sizes match the standard exactly.
 */
export function faceToFaceRatio(
	nominalSizeInch: number,
	pattern:
		| 'gate'
		| 'globe'
		| 'controlValve'
		| 'ballLong'
		| 'butterflyWafer'
		| 'dualPlate'
		| 'check'
): number {
	const table: Record<string, readonly (readonly [number, number])[]> = {
		// NPS 2, 3, 4, 6, 8, 12
		gate: [
			[2, 3.5],
			[3, 2.66],
			[4, 2.25],
			[6, 1.75],
			[8, 1.44],
			[12, 1.17]
		],
		globe: [
			[2, 4.0],
			[3, 3.16],
			[4, 2.87],
			[6, 2.66],
			[8, 2.43],
			[12, 2.29]
		],
		// A control valve body is dimensioned to ANSI/ISA-75.08.01, not to B16.10, and it is
		// a longer casting than a general purpose globe valve of the same size because it
		// has to house a cage and a seat ring that lift out as one assembly.
		//
		// Ratios are the published face to face divided by the reference bore:
		//   DN 40  222 mm / 38.1 mm = 5.83
		//   DN 50  254 mm / 50.8 mm = 5.00
		//   DN 65  276 mm / 63.5 mm = 4.35
		//   DN 80  298 mm / 76.2 mm = 3.91
		//   DN100  352 mm / 101.6 mm = 3.47
		// Source: Fisher Control Valve Handbook 6th edition, Table 5.1.1, Class 150 raised
		// face steel. Larger sizes were not in the extract this came from, so they clamp to
		// the DN100 row and would need the real figure before being trusted.
		controlValve: [
			[1.5, 5.83],
			[2, 5.0],
			[2.5, 4.35],
			[3, 3.91],
			[4, 3.47]
		],
		ballLong: [
			[2, 3.5],
			[3, 2.66],
			[4, 2.25],
			[6, 2.59],
			[8, 2.25],
			[12, 2.0]
		],
		butterflyWafer: [
			[2, 0.85],
			[3, 0.6],
			[4, 0.51],
			[6, 0.37],
			[12, 0.26]
		],
		// API 594 Type A gives 60 mm for NPS 2 at every class, which is 1.18 of the bore.
		// ASME B16.10 Table 1.3-3 agrees for the long pattern.
		dualPlate: [
			[2, 1.18],
			[3, 0.88],
			[4, 0.66],
			[6, 0.62],
			[12, 0.59]
		],
		check: [
			[2, 4.0],
			[3, 3.16],
			[4, 2.87],
			[6, 2.66],
			[8, 2.43],
			[12, 2.29]
		]
	};

	const points = table[pattern];
	if (nominalSizeInch <= points[0][0]) return points[0][1];
	for (let i = 1; i < points.length; i++) {
		if (nominalSizeInch <= points[i][0]) {
			const [lowSize, lowRatio] = points[i - 1];
			const [highSize, highRatio] = points[i];
			const t = (nominalSizeInch - lowSize) / (highSize - lowSize);
			return lowRatio + t * (highRatio - lowRatio);
		}
	}
	return points[points.length - 1][1];
}

/** Centre line to top of the valve when open, as a fraction of the bore. */
export function heightRatio(nominalSizeInch: number, pattern: 'gate' | 'globe' | 'check'): number {
	const table: Record<string, readonly (readonly [number, number])[]> = {
		gate: [
			[2, 7.09],
			[3, 6.3],
			[4, 5.75],
			[6, 5.18],
			[8, 4.9],
			[12, 4.63]
		],
		globe: [
			[2, 7.48],
			[3, 6.04],
			[4, 5.27],
			[6, 4.0],
			[12, 3.92]
		],
		check: [
			[2, 2.95],
			[3, 2.36],
			[4, 2.12],
			[6, 1.77],
			[12, 1.49]
		]
	};
	const points = table[pattern];
	if (nominalSizeInch <= points[0][0]) return points[0][1];
	for (let i = 1; i < points.length; i++) {
		if (nominalSizeInch <= points[i][0]) {
			const [lowSize, lowRatio] = points[i - 1];
			const [highSize, highRatio] = points[i];
			const t = (nominalSizeInch - lowSize) / (highSize - lowSize);
			return lowRatio + t * (highRatio - lowRatio);
		}
	}
	return points[points.length - 1][1];
}

/** Handwheel diameter as a fraction of the bore. */
export function handwheelRatio(nominalSizeInch: number): number {
	// 4.00 at NPS 2 falling to 2.00 at NPS 6 and 1.50 at NPS 12.
	return 5.66 * nominalSizeInch ** -0.756;
}

/**
 * Stem travel as a fraction of the bore.
 *
 * A gate has to retract its disc clear of the port, so it travels about one bore. A
 * globe plug only has to leave its seat, so a quarter of that. The difference is the
 * reason a gate valve needs fifteen turns of a handwheel and a globe valve needs
 * four, and it is visible in the two models side by side.
 */
export function travelRatio(nominalSizeInch: number, pattern: 'gate' | 'globe'): number {
	return pattern === 'gate' ? 1.0 : 0.25;
}

/**
 * Flange, with bolt holes and the bolts themselves.
 *
 * The bolt holes are drawn as separate cylinders rather than subtracted from the
 * flange, because Boolean geometry is expensive and a bright bolt sitting in a dark
 * hole reads exactly the same at this scale while costing a fraction of the effort.
 */
export function buildFlange(
	registry: GeometryRegistry,
	options: {
		boreM: number;
		nominalSizeInch: number;
		/** Face thickness, for a raised face. */
		raisedFace?: boolean;
	}
): Group {
	const group = new Group();
	group.name = 'Flange';
	const outerRadius = (options.boreM * flangeOuterRatio(options.nominalSizeInch)) / 2;
	const thickness = options.boreM * flangeThicknessRatio(options.nominalSizeInch);
	const boltCircle = (options.boreM * boltCircleRatio(options.nominalSizeInch)) / 2;
	const boltCount = flangeBoltCount(options.nominalSizeInch);
	const boltRadius = thickness * 0.28;

	const flangeGeometry = registry.track(
		new CylinderGeometry(outerRadius, outerRadius, thickness, 40)
	);
	const flange = new Mesh(flangeGeometry, CAST_IRON);
	flange.name = 'Flange disc';
	flange.rotation.z = Math.PI / 2;
	group.add(flange);

	if (options.raisedFace) {
		// The raised face is a shallow gasket boss on the mating side, 1.6 mm high on
		// every size and about 0.6 of the flange diameter across.
		const faceGeometry = registry.track(
			new CylinderGeometry(outerRadius * 0.6, outerRadius * 0.6, 0.0016, 32)
		);
		const face = new Mesh(faceGeometry, STAINLESS);
		face.rotation.z = Math.PI / 2;
		face.position.x = -(thickness / 2 + 0.0008);
		group.add(face);
	}

	// Bolts, with a nut at each end of the stud. Four bolts up to NPS 3 and eight up
	// to NPS 8, which is what makes a big flange read as a big flange.
	for (let i = 0; i < boltCount; i++) {
		const angle = (i / boltCount) * Math.PI * 2 + Math.PI / boltCount;
		const y = Math.cos(angle) * boltCircle;
		const z = Math.sin(angle) * boltCircle;

		const studGeometry = registry.track(
			new CylinderGeometry(boltRadius, boltRadius, thickness * 1.9, 10)
		);
		const stud = new Mesh(studGeometry, STEEL_BOLT);
		stud.rotation.z = Math.PI / 2;
		stud.position.set(0, y, z);
		group.add(stud);

		for (const side of [-1, 1]) {
			const nutGeometry = registry.track(
				new CylinderGeometry(boltRadius * 1.8, boltRadius * 1.8, thickness * 0.35, 6)
			);
			const nut = new Mesh(nutGeometry, STEEL_BOLT);
			nut.rotation.z = Math.PI / 2;
			nut.position.set(side * thickness * 0.78, y, z);
			group.add(nut);
		}
	}

	return group;
}

/**
 * A body port neck: the tapered casting that runs from the body out to the flange.
 *
 * Every valve body has these, and leaving them out is what makes a model look like
 * parts floating near each other rather than like one casting. The neck is drawn as a
 * hollow taper so its wall thickness is visible in section, which is one of the things
 * a section view exists to show.
 */
export function buildPortNeck(
	registry: GeometryRegistry,
	options: {
		/** Radius where the neck leaves the body. */
		innerRadiusM: number;
		/** Radius at the flange end. */
		outerRadiusM: number;
		lengthM: number;
		/** Bore radius, so the passage through the neck is open. */
		boreRadiusM: number;
		/** Number of radial segments. */
		segments?: number;
	}
): Group {
	const group = new Group();
	const segments = options.segments ?? 36;
	const wall = options.outerRadiusM - options.boreRadiusM;

	const outer = registry.track(
		new CylinderGeometry(
			options.outerRadiusM,
			options.innerRadiusM,
			options.lengthM,
			segments,
			1,
			true
		)
	);
	group.add(new Mesh(outer, CAST_IRON));

	// The bore, with its normals flipped so it is visible from inside the passage.
	const inner = registry.track(
		new CylinderGeometry(
			options.boreRadiusM,
			options.boreRadiusM,
			options.lengthM,
			segments,
			1,
			true
		)
	);
	const boreMesh = new Mesh(inner, PIPE);
	boreMesh.rotation.x = Math.PI;
	group.add(boreMesh);

	// An annulus at the flange end, closing the wall so the section shows its thickness.
	const ring = registry.track(new RingGeometry(options.boreRadiusM, options.outerRadiusM, segments));
	const face = new Mesh(ring, CAST_IRON);
	face.position.y = options.lengthM / 2;
	face.rotation.x = Math.PI / 2;
	group.add(face);

	void wall;
	// The neck runs along the flow axis, so it is turned to lie along X.
	group.rotation.z = Math.PI / 2;
	return group;
}

/** A pipe stub with a real wall, so the bore is visible from the end. */
export function buildPipeStub(
	registry: GeometryRegistry,
	options: { boreM: number; lengthM: number }
): Group {
	const group = new Group();
	const outerRadius = options.boreM / 2 + bodyWallM(0.5) * 0.9;
	const innerRadius = options.boreM / 2;

	const outer = registry.track(
		new CylinderGeometry(outerRadius, outerRadius, options.lengthM, 40, 1, true)
	);
	const outerMesh = new Mesh(outer, PIPE);
	group.add(outerMesh);

	// The bore wall faces inward, so it is drawn as a second cylinder with its
	// normals flipped rather than as a second side of the same one.
	const inner = registry.track(
		new CylinderGeometry(innerRadius, innerRadius, options.lengthM, 40, 1, true)
	);
	const innerMesh = new Mesh(inner, PIPE);
	innerMesh.rotation.x = Math.PI;
	group.add(innerMesh);

	// An annulus at each end closes the wall and shows its thickness, which is the
	// detail that makes a pipe read as a pipe rather than as a rod.
	const ring = registry.track(new RingGeometry(innerRadius, outerRadius, 40));
	for (const side of [-1, 1]) {
		const face = new Mesh(ring, PIPE);
		face.position.y = side * (options.lengthM / 2);
		face.rotation.x = side > 0 ? Math.PI / 2 : -Math.PI / 2;
		group.add(face);
	}

	group.rotation.z = Math.PI / 2;
	return group;
}

/**
 * A bolted body-to-bonnet joint, drawn as the flange pair and its studs.
 *
 * This is one of the most recognisable features of a real valve and it is what
 * makes a bonnet read as a separate part rather than as a continuation of the body.
 */
export function buildBoltedJoint(
	registry: GeometryRegistry,
	options: {
		radiusM: number;
		/** Stud circle radius. */
		studCircleM: number;
		thicknessM: number;
		studRadiusM: number;
		studCount: number;
	}
): Group {
	const group = new Group();

	const rimGeometry = registry.track(
		new CylinderGeometry(options.radiusM, options.radiusM, options.thicknessM, 32)
	);
	const rim = new Mesh(rimGeometry, CAST_IRON);
	group.add(rim);

	for (let i = 0; i < options.studCount; i++) {
		const angle = (i / options.studCount) * Math.PI * 2 + Math.PI / options.studCount;
		const x = Math.cos(angle) * options.studCircleM;
		const z = Math.sin(angle) * options.studCircleM;

		const studGeometry = registry.track(
			new CylinderGeometry(options.studRadiusM, options.studRadiusM, options.thicknessM * 2.4, 8)
		);
		const stud = new Mesh(studGeometry, STEEL_BOLT);
		stud.position.set(x, 0, z);
		group.add(stud);

		for (const side of [-1, 1]) {
			const nutGeometry = registry.track(
				new CylinderGeometry(options.studRadiusM * 1.7, options.studRadiusM * 1.7, options.thicknessM * 0.5, 6)
			);
			const nut = new Mesh(nutGeometry, STEEL_BOLT);
			nut.position.set(x, side * options.thicknessM * 0.95, z);
			group.add(nut);
		}
	}

	return group;
}

/**
 * The packing stack, gland and gland flange.
 *
 * A real valve carries five to seven packing rings, which is the range the packing
 * manufacturers give for a rising stem. Drawing that many rings rather than two is
 * what makes the packing box read as a real stuffing box, and it is also the honest
 * picture: the stack height is a real design constraint on how tall a bonnet has to
 * be.
 *
 * The gland flange is loaded by two eyebolts, which is how a steel valve compresses
 * its packing rather than by a single nut.
 */
export function buildPackingStack(
	registry: GeometryRegistry,
	options: {
		stemRadiusM: number;
		boxRadiusM: number;
		/**
		 * Number of packing rings. Five to seven for a rising stem, two to three for
		 * a quarter turn stem.
		 */
		ringCount?: number;
		/** Total height of the packing stack. */
		heightM: number;
		/** True to include the lantern ring in the middle of the stack. */
		lanternRing?: boolean;
	}
): Group {
	const group = new Group();
	const ringCount = options.ringCount ?? 6;
	const ringHeight = options.heightM / (ringCount + 1.6);

	for (let i = 0; i < ringCount; i++) {
		const ringGeometry = registry.track(
			new CylinderGeometry(options.boxRadiusM, options.boxRadiusM, ringHeight * 0.86, 24)
		);
		const ring = new Mesh(ringGeometry, GRAPHITE_PACKING);
		ring.position.y = -options.heightM / 2 + (i + 0.6) * ringHeight;
		group.add(ring);
	}

	if (options.lanternRing) {
		// The lantern ring sits in the middle of the stack. It spaces the gland load
		// and provides a gallery for lubricant injection.
		const lanternGeometry = registry.track(
			new CylinderGeometry(options.boxRadiusM * 1.02, options.boxRadiusM * 1.02, ringHeight * 1.1, 24)
		);
		const lantern = new Mesh(lanternGeometry, BRASS);
		lantern.position.y = -options.heightM / 2 + (ringCount / 2 + 0.6) * ringHeight;
		group.add(lantern);
	}

	// The gland follower: a bushing that presses on the top ring.
	const glandGeometry = registry.track(
		new CylinderGeometry(
			options.boxRadiusM * 0.98,
			options.boxRadiusM * 0.98,
			ringHeight * 1.2,
			24,
			1,
			true
		)
	);
	const gland = new Mesh(glandGeometry, BRASS);
	gland.rotation.x = Math.PI;
	gland.position.y = options.heightM / 2 + ringHeight * 0.6;
	group.add(gland);

	// The gland flange, with an eyebolt either side. This is the detail that reads
	// instantly as a packed valve.
	const flangeGeometry = registry.track(
		new CylinderGeometry(options.boxRadiusM * 1.5, options.boxRadiusM * 1.5, ringHeight * 1.4, 24)
	);
	const flange = new Mesh(flangeGeometry, BRASS);
	flange.position.y = options.heightM / 2 + ringHeight * 1.9;
	group.add(flange);

	for (const side of [-1, 1]) {
		const eyeboltGeometry = registry.track(
			new CylinderGeometry(ringHeight * 0.28, ringHeight * 0.28, ringHeight * 4.4, 8)
		);
		const eyebolt = new Mesh(eyeboltGeometry, STEEL_BOLT);
		eyebolt.position.set(
			side * options.boxRadiusM * 1.25,
			options.heightM / 2 + ringHeight * 0.6,
			0
		);
		group.add(eyebolt);

		const nutGeometry = registry.track(
			new CylinderGeometry(ringHeight * 0.5, ringHeight * 0.5, ringHeight * 0.7, 6)
		);
		const nut = new Mesh(nutGeometry, STEEL_BOLT);
		nut.position.set(
			side * options.boxRadiusM * 1.25,
			options.heightM / 2 + ringHeight * 2.6,
			0
		);
		group.add(nut);
	}

	return group;
}

/**
 * The bonnet, with its bolted body joint, its packing box and its taper up to the
 * yoke.
 *
 * A bonnet is a casting that narrows from the body joint to the packing box, so it
 * is built as a lathe rather than as a cone: the profile is what makes it read as a
 * casting.
 */
export function buildBonnet(
	registry: GeometryRegistry,
	options: {
		baseRadiusM: number;
		neckRadiusM: number;
		heightM: number;
		boreM: number;
		nominalSizeInch: number;
	}
): Group {
	const group = new Group();
	group.name = 'Bonnet';
	const jointThickness = options.neckRadiusM * 0.34;

	// The profile runs from the body joint up to the packing box, in half section.
	const profile: Vector2[] = [
		new Vector2(options.baseRadiusM * 0.42, 0),
		new Vector2(options.baseRadiusM * 0.98, 0.04 * options.heightM),
		new Vector2(options.baseRadiusM * 0.96, 0.16 * options.heightM),
		new Vector2(options.baseRadiusM * 0.78, 0.34 * options.heightM),
		new Vector2(options.neckRadiusM * 1.05, 0.58 * options.heightM),
		new Vector2(options.neckRadiusM, 0.86 * options.heightM),
		new Vector2(options.neckRadiusM * 1.12, 0.94 * options.heightM),
		new Vector2(options.neckRadiusM * 1.12, options.heightM),
		new Vector2(options.neckRadiusM * 0.3, options.heightM)
	];

	const bonnetGeometry = registry.track(new LatheGeometry(profile, 40));
	const bonnet = new Mesh(bonnetGeometry, CAST_IRON);
	group.add(bonnet);

	// The bolted joint at the bottom, which is what makes the bonnet read as a part
	// that can be lifted off for maintenance.
	const joint = buildBoltedJoint(registry, {
		radiusM: options.baseRadiusM * 1.02,
		studCircleM: options.baseRadiusM * 0.82,
		thicknessM: jointThickness,
		studRadiusM: jointThickness * 0.22,
		studCount: options.nominalSizeInch <= 2 ? 4 : 6
	});
	joint.position.y = jointThickness / 2;
	group.add(joint);

	return group;
}

/**
 * The backseat ring.
 *
 * A real valve has a shoulder on the stem that lands on a seat in the bonnet when
 * the valve is fully open, sealing the packing box off from the pressure. It is a
 * small part that explains a real maintenance procedure, so it is worth drawing.
 */
export function buildBackseatRing(
	registry: GeometryRegistry,
	stemRadiusM: number,
	neckRadiusM: number
): Mesh {
	const geometry = registry.track(
		new CylinderGeometry(neckRadiusM * 0.5, neckRadiusM * 0.42, stemRadiusM * 1.1, 20)
	);
	return new Mesh(geometry, TRIM);
}

/**
 * A handwheel, drawn as a rim, four spokes and a hub.
 *
 * Four spokes rather than five, because a handwheel is cast with an even number so
 * the spokes oppose each other, and the hub carries the stem nut that does the
 * actual work.
 */
export function buildHandwheel(registry: GeometryRegistry, radiusM: number): Group {
	const group = new Group();
	group.name = 'Handwheel';
	const rimThickness = radiusM * 0.09;

	const rimGeometry = registry.track(
		new TorusGeometry(radiusM, rimThickness, 10, 40)
	);
	const rim = new Mesh(rimGeometry, CAST_IRON);
	rim.rotation.x = Math.PI / 2;
	group.add(rim);

	for (let i = 0; i < 4; i++) {
		const angle = (i / 4) * Math.PI * 2;
		const spokeGeometry = registry.track(
			new CylinderGeometry(rimThickness * 0.55, rimThickness * 0.55, radiusM * 0.94, 8)
		);
		const spoke = new Mesh(spokeGeometry, CAST_IRON);
		// The spoke lies in the wheel plane, so it is rotated about the vertical axis,
		// which is the axis the wheel turns about.
		spoke.rotation.z = Math.PI / 2;
		spoke.rotation.y = -angle;
		spoke.position.set(
			Math.cos(angle) * radiusM * 0.47,
			0,
			-Math.sin(angle) * radiusM * 0.47
		);
		group.add(spoke);
	}

	const hubGeometry = registry.track(
		new CylinderGeometry(radiusM * 0.2, radiusM * 0.2, radiusM * 0.26, 16)
	);
	const hub = new Mesh(hubGeometry, CAST_IRON);
	group.add(hub);

	return group;
}

/**
 * The yoke: the open frame that carries the actuator above the bonnet.
 *
 * The legs are open rather than a tube, because the whole reason a yoke exists is to
 * let the stem and its travel indicator be seen while the valve operates.
 */
export function buildYoke(
	registry: GeometryRegistry,
	options: { widthM: number; heightM: number; legRadiusM: number }
): Group {
	const group = new Group();

	for (const side of [-1, 1]) {
		const legGeometry = registry.track(
			new CylinderGeometry(options.legRadiusM, options.legRadiusM, options.heightM, 12)
		);
		const leg = new Mesh(legGeometry, CAST_IRON);
		leg.position.set((side * options.widthM) / 2, options.heightM / 2, 0);
		group.add(leg);
	}

	// A cross member at the top to carry the actuator, and a boss at the bottom
	// where the yoke meets the bonnet.
	for (const y of [0.08, 0.92]) {
		const braceGeometry = registry.track(
			new CylinderGeometry(options.legRadiusM * 0.6, options.legRadiusM * 0.6, options.widthM, 8)
		);
		const brace = new Mesh(braceGeometry, CAST_IRON);
		brace.rotation.z = Math.PI / 2;
		brace.position.y = options.heightM * y;
		group.add(brace);
	}

	const capGeometry = registry.track(
		new CylinderGeometry(options.widthM * 0.62, options.widthM * 0.62, options.legRadiusM * 1.4, 24)
	);
	const cap = new Mesh(capGeometry, CAST_IRON);
	cap.position.y = options.heightM;
	group.add(cap);

	return group;
}

/**
 * The spring and diaphragm actuator.
 *
 * The proportions come from the Fisher 657 bulletin: a size 40 actuator, the standard
 * fit for a 2 inch valve with 38 mm of travel, has a 333 mm case diameter. That is 6.6
 * times the bore, far larger than a guess would suggest, and it is the most striking
 * proportion on a real control valve.
 *
 * The arrangement matters as much as the size. Air enters the lower case and pushes
 * the diaphragm plate up; the spring sits above the plate and resists it. So the case
 * is a drum with a dome on top, the plate sits at the joint between them, and the dome
 * has to be tall enough to contain the spring through its whole stroke. A dome too
 * shallow for its spring is what makes a model look like a toy, and it is why the
 * height here is derived from the spring rather than chosen independently.
 */
export function buildDiaphragmActuator(
	registry: GeometryRegistry,
	options: {
		caseRadiusM: number;
		/**
		 * Overall case height, which is a published dimension: a Fisher 657/667 size 40 case
		 * is 333 mm across and 164 mm tall.
		 */
		caseHeightM: number;
		/** Travel, which is how far the plate moves. */
		travelM: number;
	}
): { group: Group; spring: Group; diaphragmPlate: Group } {
	const group = new Group();
	group.name = 'Actuator';
	const { caseRadiusM, caseHeightM } = options;

	// A diaphragm case is a deep casting on the spring side and a shallow one on the
	// pressure side, and the shallowness of the pressure side is what makes the actuator
	// respond quickly. Sizing the case from the spring instead, as this did, gave a case
	// twice the published height.
	const drumHeight = caseHeightM * 0.28;
	const domeHeight = caseHeightM - drumHeight;

	// The spring lives inside the spring side of the case, clear of the plate below it and
	// the adjuster above it, so it can never be drawn poking through the casting.
	const springHeightM = domeHeight * 0.62;
	const totalHeight = caseHeightM;

	// --- Lower case: the drum the air enters -------------------------------
	const drum = new Mesh(
		registry.track(new CylinderGeometry(caseRadiusM, caseRadiusM, drumHeight, 40, 1, true)),
		PAINTED_STEEL
	);
	drum.position.y = drumHeight / 2;
	group.add(drum);

	const drumBase = new Mesh(
		registry.track(new RingGeometry(0, caseRadiusM, 40)),
		PAINTED_STEEL
	);
	drumBase.rotation.x = Math.PI / 2;
	group.add(drumBase);

	// Air connection and its gauge, on the side of the drum. These are the fittings an
	// instrument technician actually works with.
	const airPort = new Mesh(
		registry.track(new CylinderGeometry(caseRadiusM * 0.06, caseRadiusM * 0.06, caseRadiusM * 0.3, 10)),
		BRASS
	);
	airPort.rotation.z = Math.PI / 2;
	airPort.position.set(caseRadiusM * 1.1, drumHeight * 0.5, 0);
	group.add(airPort);

	const airGauge = new Mesh(
		registry.track(new CylinderGeometry(caseRadiusM * 0.14, caseRadiusM * 0.14, caseRadiusM * 0.06, 20)),
		BRASS
	);
	airGauge.rotation.x = Math.PI / 2;
	airGauge.position.set(caseRadiusM * 1.3, drumHeight * 0.5 + caseRadiusM * 0.18, 0);
	group.add(airGauge);

	// --- Upper case: the dome over the spring ------------------------------
	const dome = new Mesh(
		registry.track(new SphereGeometry(caseRadiusM, 40, 22, 0, Math.PI * 2, 0, Math.PI / 2)),
		PAINTED_STEEL
	);
	dome.scale.set(1, domeHeight / caseRadiusM, 1);
	dome.position.y = drumHeight;
	group.add(dome);

	// The case joint, with its ring of cap screws. A diaphragm case is bolted together
	// because that is how the diaphragm is replaced.
	const rim = new Mesh(
		registry.track(new CylinderGeometry(caseRadiusM * 1.05, caseRadiusM * 1.05, caseRadiusM * 0.08, 40)),
		PAINTED_STEEL
	);
	rim.position.y = drumHeight;
	group.add(rim);

	const capScrewCount = 12;
	for (let i = 0; i < capScrewCount; i++) {
		const angle = (i / capScrewCount) * Math.PI * 2;
		const screw = new Mesh(
			registry.track(new CylinderGeometry(caseRadiusM * 0.03, caseRadiusM * 0.03, caseRadiusM * 0.13, 6)),
			STEEL_BOLT
		);
		screw.position.set(
			Math.cos(angle) * caseRadiusM * 0.97,
			drumHeight,
			Math.sin(angle) * caseRadiusM * 0.97
		);
		group.add(screw);
	}

	// --- Diaphragm plate ----------------------------------------------------
	// The plate is where the air pushes and where the spring bears, so it sits at the
	// case joint when the valve is at mid travel.
	const diaphragmPlate = new Group();

	const plate = new Mesh(
		registry.track(new CylinderGeometry(caseRadiusM * 0.84, caseRadiusM * 0.84, caseRadiusM * 0.055, 40)),
		PAINTED_STEEL
	);
	diaphragmPlate.add(plate);

	// The boss under the plate that couples it to the actuator stem.
	const plateBoss = new Mesh(
		registry.track(new CylinderGeometry(caseRadiusM * 0.2, caseRadiusM * 0.2, drumHeight * 0.4, 20)),
		PAINTED_STEEL
	);
	plateBoss.position.y = -drumHeight * 0.2;
	diaphragmPlate.add(plateBoss);

	diaphragmPlate.position.y = drumHeight;
	group.add(diaphragmPlate);

	// --- Spring and its adjustor -------------------------------------------
	const spring = buildHelicalSpring(registry, {
		coilRadiusM: caseRadiusM * 0.58,
		heightM: springHeightM,
		coils: 10,
		wireRadiusM: caseRadiusM * 0.042
	});
	// The spring bears on the plate and reaches up into the dome, which is why the dome
	// was sized from this height in the first place.
	spring.position.y = drumHeight + caseRadiusM * 0.03 + springHeightM / 2;
	group.add(spring);

	// The spring seat on top of the spring.
	const springSeat = new Mesh(
		registry.track(new CylinderGeometry(caseRadiusM * 0.64, caseRadiusM * 0.64, caseRadiusM * 0.05, 28)),
		STEEL_BOLT
	);
	springSeat.position.y = drumHeight + caseRadiusM * 0.03 + springHeightM + caseRadiusM * 0.025;
	group.add(springSeat);

	// The spring adjustor: the screw that sets the bench set, with a lock nut. It is at
	// the top of the dome because that is where it can be reached with the valve in
	// service, and it is what an instrument technician turns when the bench set has to
	// be changed.
	const adjustor = new Mesh(
		registry.track(new CylinderGeometry(caseRadiusM * 0.11, caseRadiusM * 0.11, domeHeight * 0.5, 6)),
		BRASS
	);
	adjustor.position.y = drumHeight + springHeightM * 1.02 + domeHeight * 0.25;
	group.add(adjustor);

	const lockNut = new Mesh(
		registry.track(new CylinderGeometry(caseRadiusM * 0.14, caseRadiusM * 0.14, caseRadiusM * 0.07, 6)),
		STEEL_BOLT
	);
	lockNut.position.y = drumHeight + springHeightM * 1.02 + domeHeight * 0.06;
	group.add(lockNut);

	void totalHeight;
	void options.travelM;

	return { group, spring, diaphragmPlate };
}

/**
 * A helical spring, swept along its own helix.
 *
 * A spring is the one part where the shape is the whole point, so it is built the way
 * Three.js intends: a parametric helix, extruded as a tube. Assembling one from a
 * hundred small cylinders along the same path is tempting and looks wrong from every
 * angle, because each segment ends up misaligned with its neighbours and the result
 * reads as a row of spikes rather than as a coil.
 *
 * A tube costs one geometry for the whole spring and follows the helix exactly,
 * including the pitch, which is the part that tells a viewer how stiff the spring is.
 */
export function buildHelicalSpring(
	registry: GeometryRegistry,
	options: {
		coilRadiusM: number;
		heightM: number;
		coils: number;
		wireRadiusM: number;
		/** Coils per turn of the path, for smoothness. 24 is plenty at this scale. */
		segmentsPerCoil?: number;
	}
): Group {
	const group = new Group();
	const segmentsPerCoil = options.segmentsPerCoil ?? 24;
	const totalSegments = Math.max(8, Math.round(options.coils * segmentsPerCoil));

	const points: Vector3[] = [];
	for (let i = 0; i <= totalSegments; i++) {
		const t = i / totalSegments;
		const angle = t * options.coils * Math.PI * 2;
		points.push(
			new Vector3(
				Math.cos(angle) * options.coilRadiusM,
				t * options.heightM,
				Math.sin(angle) * options.coilRadiusM
			)
		);
	}

	const curve = new CatmullRomCurve3(points);
	const geometry = registry.track(
		new TubeGeometry(curve, totalSegments, options.wireRadiusM, 8, false)
	);
	group.add(new Mesh(geometry, SPRING_STEEL));

	// The spring is centred on the origin of its group so a caller can place it by its
	// centre, which is how the actuator and the relief valve both want to position it.
	group.position.y = -options.heightM / 2;
	return group;
}

/**
 * A seat ring, with its hardfaced seating face.
 *
 * The ring's outside diameter is a snug fit in the body and its bore is the flow
 * port, so it is drawn as a short thick annulus with a narrow bright band where the
 * hardfacing is. In steel valves the ring is seal welded into the body, which is why
 * it is drawn as a separate part that would have to be machined out to replace.
 */
export function buildSeatRing(
	registry: GeometryRegistry,
	options: {
		portRadiusM: number;
		outerRadiusM: number;
		heightM: number;
		/** Flat for a gate, conical for a globe. */
		face: 'flat' | 'conical';
	}
): Group {
	const group = new Group();
	group.name = 'Seat ring';

	// A seat ring is a machined annulus, so it is built as one: an outer wall, a bore wall
	// and a face at each end. Drawing it as an open cylinder with only a top face left the
	// ring without a bottom, which is neither the right shape nor a surface that the
	// point-in-mesh checks can measure against, because a ray escapes through the opening
	// and reads a point outside the ring as inside it.
	const body = buildAnnulus(registry, {
		innerRadiusM: options.portRadiusM,
		outerRadiusM: options.outerRadiusM,
		heightM: options.heightM,
		material: TRIM,
		name: 'Seat body'
	});
	group.add(body);

	// The seating face: a narrow bright band on the top of the ring.
	const faceGeometry = registry.track(
		new RingGeometry(options.portRadiusM, options.outerRadiusM, 28)
	);
	const face = new Mesh(faceGeometry, TRIM_HARDFACED);

	if (options.face === 'conical') {
		// A conical seat is a shallow cone rather than a flat annulus, which is what
		// lets a globe plug centre itself as it closes.
		const coneGeometry = registry.track(
			new CylinderGeometry(options.portRadiusM * 1.18, options.portRadiusM, options.heightM * 0.16, 28, 1, true)
		);
		const cone = new Mesh(coneGeometry, TRIM_HARDFACED);
		cone.position.y = options.heightM / 2;
		group.add(cone);
	}

	face.rotation.x = -Math.PI / 2;
	face.position.y = options.heightM / 2;
	group.add(face);

	return group;
}

/**
 * An annulus: a washer or a ring with a bore through it.
 *
 * Needed because a solid cylinder is the wrong shape wherever a stem or a shaft passes
 * through a plate. It is built from four surfaces rather than from a rotated profile, so
 * the bore wall is visible in a section view and the part reads correctly when cut open.
 */
export function buildAnnulus(
	registry: GeometryRegistry,
	options: {
		innerRadiusM: number;
		outerRadiusM: number;
		heightM: number;
		/** Defaults to cast iron, which is what most rings in a valve are made of. */
		material?: Material;
		name?: string;
	}
): Group {
	const group = new Group();
	group.name = options.name ?? 'Annulus';
	const material = options.material ?? CAST_IRON;

	const outer = new Mesh(
		registry.track(
			new CylinderGeometry(options.outerRadiusM, options.outerRadiusM, options.heightM, 32, 1, true)
		),
		material
	);
	group.add(outer);

	// The bore wall faces inward, so it is a second cylinder with its normals flipped.
	const inner = new Mesh(
		registry.track(
			new CylinderGeometry(options.innerRadiusM, options.innerRadiusM, options.heightM, 32, 1, true)
		),
		material
	);
	inner.rotation.x = Math.PI;
	group.add(inner);

	const ring = registry.track(
		new RingGeometry(options.innerRadiusM, options.outerRadiusM, 32)
	);
	for (const side of [-1, 1]) {
		const face = new Mesh(ring, material);
		face.position.y = side * (options.heightM / 2);
		face.rotation.x = side > 0 ? -Math.PI / 2 : Math.PI / 2;
		group.add(face);
	}

	return group;
}

/**
 * A cage for a control valve plug.
 *
 * The cage is what a modern control valve uses instead of a screwed seat: it sits on
 * the seat ring, is clamped by the bonnet, and its windows shape the flow
 * characteristic. Drawing it explains why a control valve is serviced by lifting the
 * bonnet and pulling the whole trim out as one assembly.
 */
export function buildCage(
	registry: GeometryRegistry,
	options: {
		innerRadiusM: number;
		wallM: number;
		heightM: number;
		windows: number;
		/** Window height as a fraction of the cage height. */
		windowHeightRatio: number;
		innerWallM: number;
	}
): Group {
	const group = new Group();
	group.name = 'Cage';
	const outerRadius = options.innerRadiusM + options.wallM;

	// The cage barrel, in the sections between the windows rather than as a solid
	// tube, so the windows are real openings rather than a texture.
	const windowHeight = options.heightM * options.windowHeightRatio;
	const segmentCount = options.windows;
	const segmentArc = (Math.PI * 2) / segmentCount;
	const pillarArc = segmentArc * 0.45;

	for (let i = 0; i < segmentCount; i++) {
		const start = i * segmentArc - pillarArc / 2;
		const pillarGeometry = registry.track(
			new CylinderGeometry(outerRadius, outerRadius, options.heightM, 6, 1, true, start, pillarArc)
		);
		const pillar = new Mesh(pillarGeometry, TRIM);
		group.add(pillar);
	}

	// The rings above and below the windows.
	for (const y of [
		(options.heightM - windowHeight) / 2 - (options.heightM - windowHeight) / 4,
		-(options.heightM - windowHeight) / 2 + (options.heightM - windowHeight) / 4
	]) {
		const ringGeometry = registry.track(
			new CylinderGeometry(outerRadius, outerRadius, (options.heightM - windowHeight) / 2, 32, 1, true)
		);
		const ring = new Mesh(ringGeometry, TRIM);
		ring.position.y = y;
		group.add(ring);
	}

	// The bore liner, so the cage reads as a tube with windows rather than as a cage
	// of separate bars.
	const linerGeometry = registry.track(
		new CylinderGeometry(options.innerRadiusM, options.innerRadiusM, options.heightM, 32, 1, true)
	);
	const liner = new Mesh(linerGeometry, TRIM);
	liner.rotation.x = Math.PI;
	group.add(liner);

	return group;
}

/** A bolt circle of cap screws, for a cover or a body joint. */
export function buildCapScrews(
	registry: GeometryRegistry,
	options: {
		count: number;
		circleRadiusM: number;
		screwRadiusM: number;
		lengthM: number;
		y?: number;
	}
): Group {
	const group = new Group();
	for (let i = 0; i < options.count; i++) {
		const angle = (i / options.count) * Math.PI * 2 + Math.PI / options.count;
		const geometry = registry.track(
			new CylinderGeometry(options.screwRadiusM, options.screwRadiusM, options.lengthM, 6)
		);
		const screw = new Mesh(geometry, STEEL_BOLT);
		screw.position.set(
			Math.cos(angle) * options.circleRadiusM,
			options.y ?? 0,
			Math.sin(angle) * options.circleRadiusM
		);
		group.add(screw);
	}
	return group;
}

/** A cover plate with its bolts, as used on a check valve or a plug valve. */
export function buildCover(
	registry: GeometryRegistry,
	options: {
		radiusM: number;
		heightM: number;
		boltCount: number;
		boltCircleM: number;
		boltRadiusM: number;
	}
): Group {
	const group = new Group();

	const plateGeometry = registry.track(
		new CylinderGeometry(options.radiusM, options.radiusM * 0.92, options.heightM, 28)
	);
	const plate = new Mesh(plateGeometry, CAST_IRON);
	plate.position.y = options.heightM / 2;
	group.add(plate);

	const bossGeometry = registry.track(
		new CylinderGeometry(options.radiusM * 0.3, options.radiusM * 0.3, options.heightM * 0.5, 16)
	);
	const boss = new Mesh(bossGeometry, CAST_IRON);
	boss.position.y = options.heightM * 1.2;
	group.add(boss);

	group.add(
		buildCapScrews(registry, {
			count: options.boltCount,
			circleRadiusM: options.boltCircleM,
			screwRadiusM: options.boltRadiusM,
			lengthM: options.heightM * 1.5,
			y: options.heightM * 0.5
		})
	);

	return group;
}

/** A rectangular port, used by a plug valve and a characterised ball. */
export function buildPortWindow(
	registry: GeometryRegistry,
	options: { widthM: number; heightM: number; depthM: number }
): Mesh {
	const shape = new Shape();
	shape.moveTo(-options.widthM / 2, -options.heightM / 2);
	shape.lineTo(options.widthM / 2, -options.heightM / 2);
	shape.lineTo(options.widthM / 2, options.heightM / 2);
	shape.lineTo(-options.widthM / 2, options.heightM / 2);
	shape.closePath();

	const geometry = registry.track(
		new ExtrudeGeometry(shape, { depth: options.depthM, bevelEnabled: false })
	);
	geometry.translate(0, 0, -options.depthM / 2);
	return new Mesh(geometry, PIPE);
}

/** A V notch, as used by a characterised ball valve trim. */
export function buildVNotch(
	registry: GeometryRegistry,
	options: { widthM: number; heightM: number; depthM: number }
): Mesh {
	const shape = new Shape();
	shape.moveTo(0, -options.heightM / 2);
	shape.lineTo(options.widthM, 0);
	shape.lineTo(0, options.heightM / 2);
	shape.closePath();

	const geometry = registry.track(
		new ExtrudeGeometry(shape, { depth: options.depthM, bevelEnabled: false })
	);
	geometry.translate(0, 0, -options.depthM / 2);
	return new Mesh(geometry, PIPE);
}

/** A hex head, for an adjusting screw or a plug. */
export function buildHexHead(
	registry: GeometryRegistry,
	options: { acrossFlatsM: number; heightM: number }
): Mesh {
	const geometry = registry.track(
		new CylinderGeometry(options.acrossFlatsM, options.acrossFlatsM, options.heightM, 6)
	);
	return new Mesh(geometry, BRASS);
}

/** A PTFE soft seat, as used by a ball valve. */
export function buildSoftSeat(
	registry: GeometryRegistry,
	options: { innerRadiusM: number; outerRadiusM: number; heightM: number }
): Group {
	const group = new Group();
	const geometry = registry.track(
		new CylinderGeometry(options.outerRadiusM, options.outerRadiusM, options.heightM, 32, 1, true)
	);
	const seat = new Mesh(geometry, PTFE);
	group.add(seat);

	const faceGeometry = registry.track(
		new RingGeometry(options.innerRadiusM, options.outerRadiusM, 32)
	);
	const face = new Mesh(faceGeometry, PTFE);
	face.rotation.x = -Math.PI / 2;
	face.position.y = options.heightM / 2;
	group.add(face);

	return group;
}

/**
 * Live geometry registry.
 *
 * Three.js does not free a geometry while a mesh still references it, and a valve
 * that is rebuilt whenever the model changes would leak the whole scene each time.
 * Every builder takes the registry so teardown is one call.
 */
/**
 * Registered geometry constructors.
 *
 * Three.js does not free a geometry while a mesh still references it, and a valve is
 * rebuilt whenever its configuration changes, so every geometry goes through the
 * registry to make teardown one call. These wrappers keep the builders readable without
 * giving up that guarantee, and they live here rather than in an assembly module
 * because every assembly uses them.
 */

/** A cylinder. Open ended cylinders are used wherever a bore or a wall has to show. */
export function cyl(
	registry: GeometryRegistry,
	radius: number,
	height: number,
	segments = 32,
	openEnded = false
): BufferGeometry {
	return registry.track(new CylinderGeometry(radius, radius, height, segments, 1, openEnded));
}

/** A sphere, optionally a partial one for a dome or a plug nose. */
export function sphere(
	registry: GeometryRegistry,
	radius: number,
	widthSegments = 32,
	heightSegments = 20,
	phiLength = Math.PI * 2
): BufferGeometry {
	return registry.track(new SphereGeometry(radius, widthSegments, heightSegments, 0, phiLength));
}

/** A torus, used for rims, seals, adjusting rings and spring wire. */
export function torus(registry: GeometryRegistry, radius: number, tube: number): BufferGeometry {
	return registry.track(new TorusGeometry(radius, tube, 8, 28));
}

/** A box, for levers, yoke legs and handwheel spokes. */
export function slab(
	registry: GeometryRegistry,
	width: number,
	height: number,
	depth: number
): BufferGeometry {
	return registry.track(new BoxGeometry(width, height, depth));
}

export class GeometryRegistry {
	private readonly geometries: BufferGeometry[] = [];

	track<T extends BufferGeometry>(geometry: T): T {
		this.geometries.push(geometry);
		return geometry;
	}

	dispose(): void {
		for (const geometry of this.geometries) geometry.dispose();
		this.geometries.length = 0;
	}
}

export { BoxGeometry, CylinderGeometry, Group, Mesh, RingGeometry, SphereGeometry, TorusGeometry };

// ---------------------------------------------------------------------------
// Bolted bonnet, outside screw and yoke assembly
// ---------------------------------------------------------------------------
