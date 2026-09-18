/**
 * Shared materials and finishes for the 3D lab.
 *
 * Materials are created once and shared between meshes because each one carries a
 * shader program on the GPU, and a scene built from hundreds of unique materials
 * would compile hundreds of programs for no reason.
 */

import {
	Color,
	DoubleSide,
	MeshPhysicalMaterial,
	MeshStandardMaterial,
	type Material
} from 'three';

/** Cast iron, the default body material. */
export const CAST_IRON = new MeshStandardMaterial({
	color: new Color('#4a5560'),
	roughness: 0.72,
	metalness: 0.35
});

/**
 * Cast iron drawn double sided, for the half shell bodies.
 *
 * A separate material rather than a flag set on CAST_IRON at the point of use,
 * because a material is shared by every mesh that references it. See the note in
 * `buildBodyShell` for what setting the flag on the shared material did.
 */
export const CAST_IRON_SHELL = new MeshStandardMaterial({
	color: new Color('#4a5560'),
	roughness: 0.72,
	metalness: 0.35,
	side: DoubleSide
});

/** Machined stainless, used for stems, discs and trim. */
export const STAINLESS = new MeshStandardMaterial({
	color: new Color('#b8c2cc'),
	roughness: 0.28,
	metalness: 0.92
});

/** The plug and seat trim, slightly darker to read as a different alloy. */
export const TRIM = new MeshStandardMaterial({
	color: new Color('#8d99a6'),
	roughness: 0.34,
	metalness: 0.88
});

/** Diaphragm case and actuator housing, painted steel. */
export const PAINTED_STEEL = new MeshStandardMaterial({
	color: new Color('#2f6f8f'),
	roughness: 0.62,
	metalness: 0.28
});

/** Spring steel, for the visible spring in a cutaway actuator. */
export const SPRING_STEEL = new MeshStandardMaterial({
	color: new Color('#9aa6b2'),
	roughness: 0.4,
	metalness: 0.85
});

/** Cast aluminium instrument case, as a positioner housing is made of. */
export const ALUMINIUM = new MeshStandardMaterial({
	color: new Color('#b4bcc4'),
	roughness: 0.52,
	metalness: 0.55
});

/** Instrument air tubing and fittings, brass. */
export const BRASS = new MeshStandardMaterial({
	color: new Color('#b8933f'),
	roughness: 0.42,
	metalness: 0.85
});

/** Pipe wall, cut away in the sectional view. */
export const PIPE = new MeshStandardMaterial({
	color: new Color('#3c4650'),
	roughness: 0.68,
	metalness: 0.4,
	side: 2
});

/** PTFE soft seat and seals. */
export const PTFE = new MeshStandardMaterial({
	color: new Color('#e8e4dc'),
	roughness: 0.55,
	metalness: 0.02
});

/** Graphite packing rings around the stem. */
export const PACKING = new MeshStandardMaterial({
	color: new Color('#26282c'),
	roughness: 0.92,
	metalness: 0.05
});

/**
 * The process fluid.
 *
 * Translucent, with a slight emission so it reads as flowing even in a static
 * frame. The colour is tinted per fluid so water and steam are distinguishable at
 * a glance.
 */
export function createFluidMaterial(colorHex: string, opacity = 0.42): MeshPhysicalMaterial {
	return new MeshPhysicalMaterial({
		color: new Color(colorHex),
		transparent: true,
		opacity,
		roughness: 0.15,
		metalness: 0,
		transmission: 0.6,
		thickness: 0.05,
		clearcoat: 0.6
	});
}

/** Water, a cool blue. */
export const FLUID_WATER = createFluidMaterial('#3fa9d8');

/** Steam, near white with a warm tint. */
export const FLUID_STEAM = createFluidMaterial('#d8d2c8', 0.3);

/** Air and other gases, a pale grey. */
export const FLUID_GAS = createFluidMaterial('#9fb4c4', 0.22);

/** The high pressure side of a cutaway, tinted red for the pressure convention. */
export const PRESSURE_HIGH = createFluidMaterial('#d8563f', 0.4);

/** Cavitation bubbles at the vena contracta. */
export const CAVITATION = createFluidMaterial('#f0f4f8', 0.72);

/** Transparent housing used to show internals without a full cutaway. */
export const GHOST = new MeshPhysicalMaterial({
	color: new Color('#8fa8bd'),
	transparent: true,
	opacity: 0.16,
	roughness: 0.1,
	metalness: 0.1,
	transmission: 0.85,
	thickness: 0.02,
	depthWrite: false
});

/** The floor the assembly sits on. */
export const FLOOR = new MeshStandardMaterial({
	color: new Color('#1b2026'),
	roughness: 0.9,
	metalness: 0.05
});

/** Steel bolting: studs, nuts, cap screws. */
export const STEEL_BOLT = new MeshStandardMaterial({
	color: new Color('#6e7681'),
	roughness: 0.45,
	metalness: 0.9
});

/** Graphite packing rings. Darker and rougher than the earlier packing material. */
export const GRAPHITE_PACKING = new MeshStandardMaterial({
	color: new Color('#1e2126'),
	roughness: 0.95,
	metalness: 0.04
});

/** Hardfaced seating surface, such as Stellite on a seat ring. */
export const TRIM_HARDFACED = new MeshStandardMaterial({
	color: new Color('#c8d2dc'),
	roughness: 0.18,
	metalness: 0.95
});

/**
 * The colour a sectioned face is drawn in.
 *
 * A cutaway in an engineering drawing hatches the cut material, but at this scale a
 * flat colour reads more clearly than a hatch pattern and costs nothing. The colour
 * is deliberately warmer than the castings so a cut face is unmistakable: it is how
 * the eye tells "this part is sliced" from "this part is dark".
 */
export const SECTION_FACE = new MeshStandardMaterial({
	color: new Color('#8a5a3c'),
	roughness: 0.8,
	metalness: 0.1,
	side: DoubleSide
});

/** The body to bonnet gasket, a thin band a cutaway drawing shows at the joint. */
export const GASKET = new MeshStandardMaterial({
	color: new Color('#2b2f36'),
	roughness: 0.88,
	metalness: 0.15
});

/** A stainless identification plate. */
export const NAMEPLATE = new MeshStandardMaterial({
	color: new Color('#cfd6dd'),
	roughness: 0.32,
	metalness: 0.85
});

/** Highlight ring used to mark an active part under inspection. */
export const HIGHLIGHT = new MeshStandardMaterial({
	color: new Color('#4fd1c5'),
	emissive: new Color('#2c7a72'),
	emissiveIntensity: 0.6,
	roughness: 0.4,
	metalness: 0.3
});

/** Every material this module creates, for disposal on teardown. */
export const SHARED_MATERIALS: readonly Material[] = [
	CAST_IRON,
	CAST_IRON_SHELL,
	STEEL_BOLT,
	GRAPHITE_PACKING,
	TRIM_HARDFACED,
	GASKET,
	NAMEPLATE,
	SECTION_FACE,
	STAINLESS,
	TRIM,
	PAINTED_STEEL,
	ALUMINIUM,
	SPRING_STEEL,
	BRASS,
	PIPE,
	PTFE,
	PACKING,
	FLUID_WATER,
	FLUID_STEAM,
	FLUID_GAS,
	PRESSURE_HIGH,
	CAVITATION,
	GHOST,
	FLOOR,
	HIGHLIGHT
];
