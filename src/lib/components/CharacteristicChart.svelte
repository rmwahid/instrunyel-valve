<script lang="ts">
	/**
	 * The inherent and installed characteristic, plotted together.
	 *
	 * Drawn as SVG rather than on a canvas because it is a small static plot with a
	 * few hundred points, and SVG keeps it crisp, selectable and inspectable without
	 * a charting library. The two curves are the whole point of the chart: the gap
	 * between them is the difference between what the trim was designed to do and
	 * what the loop actually experiences.
	 */
	import {
		characteristicCurve,
		type HydraulicSystem,
		type InherentCharacteristic
	} from '$lib/sim/characteristic';

	interface Props {
		/** Rated flow coefficient of the valve, which sets the system resistance. */
		ratedKv: number;
		characteristic: InherentCharacteristic;
		rangeability: number;
		/** Total pressure drop available to the system, bar. */
		totalPressureDropBar: number;
		/** Share of that drop the valve takes when wide open. */
		valveAuthority: number;
		/** Specific gravity of the fluid, for the liquid equation. */
		specificGravity: number;
		/** Current opening, drawn as a cursor. */
		opening: number;
	}

	let {
		ratedKv,
		characteristic,
		rangeability,
		totalPressureDropBar,
		valveAuthority,
		specificGravity,
		opening
	}: Props = $props();

	const WIDTH = 320;
	const HEIGHT = 190;
	const PAD_LEFT = 34;
	const PAD_RIGHT = 10;
	const PAD_TOP = 12;
	const PAD_BOTTOM = 24;

	const system = $derived<HydraulicSystem>({
		totalPressureDropBar,
		valveAuthority,
		ratedKv,
		specificGravity
	});

	const points = $derived(
		characteristicCurve(system, characteristic, 41, { rangeability })
	);

	function xFor(opening: number): number {
		return PAD_LEFT + opening * (WIDTH - PAD_LEFT - PAD_RIGHT);
	}

	function yFor(fraction: number): number {
		return HEIGHT - PAD_BOTTOM - fraction * (HEIGHT - PAD_TOP - PAD_BOTTOM);
	}

	function pathFor(accessor: (point: (typeof points)[number]) => number): string {
		return points
			.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xFor(point.opening).toFixed(2)} ${yFor(accessor(point)).toFixed(2)}`)
			.join(' ');
	}

	const inherentPath = $derived(pathFor((point) => point.inherent));
	const installedPath = $derived(pathFor((point) => point.installed));

	const cursorX = $derived(xFor(Math.min(1, Math.max(0, opening))));

	/** The pressure drop curve is scaled to its own maximum, so its shape is visible. */
	const maxValveDrop = $derived(
		Math.max(...points.map((point) => point.valvePressureDropBar), 0.0001)
	);
	const pressurePath = $derived(
		pathFor((point) => point.valvePressureDropBar / maxValveDrop)
	);

	const gridLines = [0, 0.25, 0.5, 0.75, 1];
</script>

<figure class="chart">
	<figcaption>
		<svg viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-label="Valve characteristic chart">
			<!-- Grid -->
			{#each gridLines as line (line)}
				<line
					class="grid"
					x1={PAD_LEFT}
					x2={WIDTH - PAD_RIGHT}
					y1={yFor(line)}
					y2={yFor(line)}
				/>
				<text class="axis" x={PAD_LEFT - 6} y={yFor(line) + 3} text-anchor="end">
					{Math.round(line * 100)}
				</text>
			{/each}

			<!-- Axes -->
			<line class="axis-line" x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={yFor(0)} y2={yFor(0)} />
			<line class="axis-line" x1={PAD_LEFT} x2={PAD_LEFT} y1={PAD_TOP} y2={yFor(0)} />

			<!-- Curve of the pressure drop the valve keeps, scaled to its own maximum -->
			<path class="pressure" d={pressurePath} />

			<!-- Inherent characteristic -->
			<path class="inherent" d={inherentPath} />

			<!-- Installed characteristic -->
			<path class="installed" d={installedPath} />

			<!-- Cursor at the current opening -->
			<line class="cursor" x1={cursorX} x2={cursorX} y1={PAD_TOP} y2={yFor(0)} />

			<!-- Axis labels -->
			<text class="axis" x={PAD_LEFT} y={HEIGHT - 8} text-anchor="start">0</text>
			<text class="axis" x={(WIDTH + PAD_LEFT - PAD_RIGHT) / 2} y={HEIGHT - 8} text-anchor="middle">
				Stem travel, percent
			</text>
			<text class="axis" x={WIDTH - PAD_RIGHT} y={HEIGHT - 8} text-anchor="end">100</text>
		</svg>

		<span class="legend-row">
			<span class="legend"><i class="swatch inherent"></i>Inherent</span>
			<span class="legend"><i class="swatch installed"></i>Installed</span>
			<span class="legend"><i class="swatch pressure"></i>Valve pressure drop</span>
		</span>
	</figcaption>

	<p class="authority">
		Valve authority <strong class="tabular">{valveAuthority.toFixed(2)}</strong>.
		{#if valveAuthority > 0.6}
			The valve owns most of the system pressure drop, so the installed curve stays close to the
			inherent one and a linear trim holds a steady loop gain.
		{:else if valveAuthority > 0.3}
			The valve owns a modest share of the pressure drop, which is the range a control engineer
			aims for. The installed curve departs from the inherent one by a moderate amount.
		{:else}
			The valve owns only a small share of the pressure drop, so its installed curve is far from
			the inherent one. A linear trim would have a very uneven loop gain here, which is why equal
			percentage is used instead.
		{/if}
	</p>
</figure>

<style>
	.chart {
		margin: 0;
	}

	svg {
		width: 100%;
		height: auto;
		display: block;
		background: var(--surface-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-sm);
	}

	.grid {
		stroke: var(--line-1);
		stroke-width: 1;
	}

	.axis-line {
		stroke: var(--line-2);
		stroke-width: 1;
	}

	.axis {
		fill: var(--text-3);
		font-size: 8px;
		font-family: var(--font-sans);
	}

	.inherent {
		fill: none;
		stroke: var(--text-3);
		stroke-width: 1.6;
		stroke-dasharray: 4 3;
	}

	.installed {
		fill: none;
		stroke: var(--accent);
		stroke-width: 2.2;
	}

	.pressure {
		fill: none;
		stroke: var(--command);
		stroke-width: 1.4;
		opacity: 0.75;
	}

	.cursor {
		stroke: var(--measure);
		stroke-width: 1;
		stroke-dasharray: 2 2;
	}

	figcaption {
		margin: 0;
	}

	.legend-row {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 7px;
		font-size: 11px;
		color: var(--text-3);
	}

	.legend {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}

	.swatch {
		width: 13px;
		height: 2px;
		border-radius: 1px;
		display: inline-block;
	}

	.swatch.inherent {
		background: repeating-linear-gradient(
			90deg,
			var(--text-3) 0 4px,
			transparent 4px 7px
		);
	}

	.swatch.installed {
		background: var(--accent);
	}

	.swatch.pressure {
		background: var(--command);
	}

	.authority {
		margin-top: 9px;
		font-size: 11.5px;
		line-height: 1.5;
		color: var(--text-2);
	}

	.authority strong {
		color: var(--text-1);
	}
</style>
