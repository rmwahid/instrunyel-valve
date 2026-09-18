<script lang="ts">
	/**
	 * The instrument panel.
	 *
	 * Three groups, in the order a signal travels: the transmitter and its current
	 * loop, the valve itself, and the forces acting on it. Presenting them in that
	 * order matters, because the whole lesson of a control loop is that a fault in
	 * the first group explains a symptom in the third.
	 */
	import type { SimulatorReadouts } from '$lib/sim/engine';
	import { signalStatusLabel, isFault } from '$lib/sim/signal';
	import { describeActuator, positionFromPressure } from '$lib/sim/actuator';
	import type { ValveModel } from '$lib/sim/valves/types';
	import { NAMUR_NE43 } from '$lib/sim/units';

	interface Props {
		readouts: SimulatorReadouts;
		valve: ValveModel;
		/** Unit of the controlled variable, for the measurement readout. */
		controlledUnit: string;
		/** Range of the controlled variable, for the percent display. */
		controlledRange: { min: number; max: number };
	}

	let { readouts, valve, controlledUnit, controlledRange }: Props = $props();

	const actuator = $derived(valve.spec.actuator);

	const measurementPercent = $derived(
		controlledRange.max > controlledRange.min
			? ((readouts.measurement - controlledRange.min) / (controlledRange.max - controlledRange.min)) *
					100
			: 0
	);

	/** Where the air pressure sits in the bench set span, as a percentage. */
	const benchSetPercent = $derived.by(() => {
		if (!actuator) return 0;
		const span = actuator.benchSetHighBar - actuator.benchSetLowBar;
		if (span <= 0) return 0;
		return ((readouts.deliveredPressureBar - actuator.benchSetLowBar) / span) * 100;
	});

	/**
	 * The status the panel reports is the one the controller acts on.
	 *
	 * A broken loop leaves the transmitter perfectly healthy while what arrives at the
	 * controller is a fault, so reporting the transmitter's own status would show a
	 * reassuring "Valid" on a loop that has stopped working.
	 */
	const statusFault = $derived(isFault(readouts.receivedStatus));

	function format(value: number, digits = 2): string {
		if (!Number.isFinite(value)) return '--';
		return value.toFixed(digits);
	}

	/**
	 * Elapsed simulated time, as minutes and seconds.
	 *
	 * Shown because the process runs on its own clock rather than the wall clock: a
	 * level loop takes minutes of process time to fill a tank, and a student needs to
	 * see that time passing to understand why the loop feels slow. It also makes a
	 * stalled simulation obvious at a glance, since a clock that does not move is
	 * unambiguous in a way that a settled measurement is not.
	 */
	function formatSimTime(seconds: number): string {
		if (!Number.isFinite(seconds)) return '--';
		const whole = Math.max(0, Math.floor(seconds));
		const minutes = Math.floor(whole / 60);
		const remainder = whole % 60;
		return `${minutes}:${String(remainder).padStart(2, '0')}`;
	}

	function signed(value: number, digits = 0): string {
		if (!Number.isFinite(value)) return '--';
		const rounded = value.toFixed(digits);
		return value > 0 ? `+${rounded}` : rounded;
	}
</script>

<div class="panel-wrap">
	<!-- Signal chain ------------------------------------------------------- -->
	<section class="panel">
		<header class="panel-header">
			<h3>Measurement</h3>
			<span class="tag" data-fault={statusFault}>
				{signalStatusLabel(readouts.receivedStatus)}
			</span>
		</header>
		<div class="panel-body">
			<div class="readout">
				<span class="muted">Simulation time</span>
				<span class="tabular">{formatSimTime(readouts.timeSeconds)}</span>
			</div>
			<div class="readout">
				<span class="muted">Process value</span>
				<span class="tabular"
					>{format(readouts.trueMeasurement, 3)} <span class="dim">{controlledUnit}</span></span
				>
			</div>
			<div class="readout">
				<span class="muted">Transmitted</span>
				<span class="tabular"
					>{format(readouts.measurement, 3)} <span class="dim">{controlledUnit}</span></span
				>
			</div>
			<div class="readout">
				<span class="muted">Transmitter output</span>
				<span class="tabular">{format(readouts.transmitterCurrentMa)} mA</span>
			</div>
			{#if readouts.receivedCurrentMa !== readouts.transmitterCurrentMa}
				<div class="readout fault-row">
					<span class="muted">Received at the I/P</span>
					<span class="tabular">{format(readouts.receivedCurrentMa)} mA</span>
				</div>
				<div class="readout fault-row">
					<span class="muted">Transmitter itself</span>
					<span class="tabular">{signalStatusLabel(readouts.transmitterStatus)}</span>
				</div>
			{/if}
			<div class="readout">
				<span class="muted">Setpoint</span>
				<span class="tabular"
					>{format(readouts.setpoint, 2)} <span class="dim">{controlledUnit}</span></span
				>
			</div>

			<div class="bar" aria-hidden="true">
				<div class="bar-fill" style:width="{Math.min(100, Math.max(0, measurementPercent))}%"></div>
				<div
					class="bar-marker"
					style:left="{controlledRange.max > controlledRange.min
						? Math.min(
								100,
								Math.max(
									0,
									((readouts.setpoint - controlledRange.min) /
										(controlledRange.max - controlledRange.min)) *
										100
								)
							)
						: 0}%"
				></div>
			</div>
			<div class="bar-scale">
				<span class="tabular">{format(controlledRange.min, 0)}</span>
				<span class="dim">NAMUR NE43: {NAMUR_NE43.downscaleFaultMa} to {NAMUR_NE43.upscaleFaultMa} mA</span>
				<span class="tabular">{format(controlledRange.max, 0)}</span>
			</div>
		</div>
	</section>

	<!-- Valve -------------------------------------------------------------- -->
	<section class="panel">
		<header class="panel-header">
			<h3>Valve</h3>
			<span class="tag">{valve.spec.name}</span>
		</header>
		<div class="panel-body">
			<div class="readout">
				<span class="muted">Commanded travel</span>
				<span class="tabular">{format(readouts.commandedTravelPercent, 1)} %</span>
			</div>
			<div class="readout">
				<span class="muted">Actual travel</span>
				<span class="tabular strong">{format(readouts.actualTravelPercent, 2)} %</span>
			</div>
			<div class="readout">
				<span class="muted">Following error</span>
				<span class="tabular" data-notice={Math.abs(readouts.followingErrorPercent) > 1}>
					{signed(readouts.followingErrorPercent, 2)} %
				</span>
			</div>

			<div class="travel-bar" aria-hidden="true">
				<div
					class="travel-command"
					style:left="{Math.min(100, Math.max(0, readouts.commandedTravelPercent))}%"
				></div>
				<div
					class="travel-actual"
					style:left="{Math.min(100, Math.max(0, readouts.actualTravelPercent))}%"
				></div>
			</div>
			<div class="bar-scale">
				<span class="dim">Command marker against actual position</span>
			</div>

			<div class="readout">
				<span class="muted">Effective Kv</span>
				<span class="tabular">{format(readouts.effectiveKv, 2)}</span>
			</div>
			<div class="readout">
				<span class="muted">Deadband</span>
				<span class="tabular" data-notice={readouts.deadbandPercent > 1}>
					{format(readouts.deadbandPercent, 2)} %
				</span>
			</div>

			{#if !readouts.selfActing}
				<div class="readout">
					<span class="muted">I/P output</span>
					<span class="tabular">{format(readouts.airPressureBar, 3)} bar</span>
				</div>
				<div class="readout">
					<span class="muted">Positioner demand</span>
					<span class="tabular">{format(readouts.positionerPressureBar, 3)} bar</span>
				</div>
				<div class="readout">
					<span class="muted">Case pressure</span>
					<span class="tabular strong">{format(readouts.deliveredPressureBar, 3)} bar</span>
				</div>
				{#if actuator}
					<div class="bench-bar" aria-hidden="true">
						<div
							class="bench-fill"
							style:width="{Math.min(100, Math.max(0, benchSetPercent))}%"
						></div>
					</div>
					<div class="bar-scale">
						<span class="tabular">{format(actuator.benchSetLowBar, 2)}</span>
						<span class="dim">Bench set span</span>
						<span class="tabular">{format(actuator.benchSetHighBar, 2)}</span>
					</div>
				{/if}
			{:else}
				<div class="note">
					Self acting: the process pressure difference provides the opening force, so there is
					no signal and no actuator air.
				</div>
			{/if}
		</div>
	</section>

	<!-- Flow and forces ---------------------------------------------------- -->
	<section class="panel">
		<header class="panel-header">
			<h3>Flow</h3>
			<span class="tag" data-fault={readouts.flow.cavitation !== 'none'}>
				{readouts.flow.cavitation === 'none' ? 'Single phase' : readouts.flow.cavitation}
			</span>
		</header>
		<div class="panel-body">
			<div class="readout">
				<span class="muted">Mass flow</span>
				<span class="tabular strong">{format(readouts.flow.massFlowKgPerHour, 1)} kg/h</span>
			</div>
			<div class="readout">
				<span class="muted">Volume flow</span>
				<span class="tabular">{format(readouts.flow.volumetricFlowM3PerHour, 3)} m3/h</span>
			</div>
			<div class="readout">
				<span class="muted">Pressure drop used</span>
				<span class="tabular">{format(readouts.flow.effectivePressureDropBar, 3)} bar</span>
			</div>
			<div class="readout">
				<span class="muted">Pressure drop available</span>
				<span class="tabular">{format(readouts.flow.availablePressureDropBar, 3)} bar</span>
			</div>
			{#if readouts.flow.choked}
				<div class="readout fault-row">
					<span class="muted">Choked</span>
					<span class="tabular">flow limited by the valve, not the system</span>
				</div>
			{/if}
			{#if readouts.flow.sigmaIndex !== null}
				<div class="readout">
					<span class="muted">Cavitation index sigma</span>
					<span class="tabular">{format(readouts.flow.sigmaIndex, 2)}</span>
				</div>
			{/if}
			<div class="readout">
				<span class="muted">Body velocity</span>
				<span class="tabular">{format(readouts.flow.bodyVelocityMPerSecond, 2)} m/s</span>
			</div>
		</div>
	</section>

	<section class="panel">
		<header class="panel-header">
			<h3>Force balance</h3>
			<span class="tag">On the stem</span>
		</header>
		<div class="panel-body">
			<div class="readout">
				<span class="muted">Spring</span>
				<span class="tabular">{signed(readouts.springForceN)} N</span>
			</div>
			<div class="readout">
				<span class="muted">Diaphragm</span>
				<span class="tabular">{signed(readouts.diaphragmForceN)} N</span>
			</div>
			<div class="readout">
				<span class="muted">Fluid on the plug</span>
				<span class="tabular">{signed(readouts.fluidForceN)} N</span>
			</div>
			<div class="readout total">
				<span>Net</span>
				<span class="tabular">{signed(readouts.netForceN)} N</span>
			</div>
			<div class="readout">
				<span class="muted">Packing friction</span>
				<span class="tabular">{signed(readouts.frictionForceN)} N</span>
			</div>
			<div class="readout">
				<span class="muted">Seat load</span>
				<span class="tabular">{signed(readouts.seatLoadN)} N</span>
			</div>
			{#if actuator}
				<div class="note small-note">{describeActuator(actuator)}</div>
			{/if}
		</div>
	</section>

	{#if readouts.notes.length > 0}
		<section class="panel notes">
			<header class="panel-header">
				<h3>Hydraulics</h3>
			</header>
			<div class="panel-body">
				{#each readouts.notes as note (note)}
					<p class="note">{note}</p>
				{/each}
			</div>
		</section>
	{/if}
</div>

<style>
	.panel-wrap {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.panel-wrap :global(.panel) {
		background: var(--surface-1);
	}

	h3 {
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-2);
		font-weight: 600;
	}

	.tag {
		font-size: 10.5px;
		padding: 2px 7px;
		border-radius: 10px;
		background: var(--surface-3);
		color: var(--text-2);
		border: 1px solid var(--line-2);
		white-space: nowrap;
	}

	.tag[data-fault='true'] {
		background: rgb(252 129 129 / 0.14);
		color: var(--fault);
		border-color: var(--fault);
	}

	.readout .strong {
		color: var(--text-1);
		font-weight: 600;
	}

	.readout .tabular[data-notice='true'] {
		color: var(--warn);
	}

	/* The net force is the sum of the three above it, so it is separated and
	   emphasised: it is the number that decides whether the stem moves. */
	.readout.total {
		margin-top: 3px;
		padding-top: 6px;
		border-top: 1px solid var(--line-2);
		font-weight: 600;
	}

	.readout.total span:first-child {
		color: var(--text-1);
	}

	.readout.fault-row .tabular {
		color: var(--fault);
	}

	.bar,
	.bench-bar {
		position: relative;
		height: 5px;
		margin: 9px 0 4px;
		background: var(--surface-3);
		border-radius: 3px;
		overflow: hidden;
	}

	.bar-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--measure), var(--accent));
		border-radius: 3px;
		transition: width 0.1s linear;
	}

	.bar-marker {
		position: absolute;
		top: -2px;
		width: 2px;
		height: 9px;
		background: var(--command);
		transition: left 0.1s linear;
	}

	.bench-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--surface-3), var(--command));
		border-radius: 3px;
		transition: width 0.1s linear;
	}

	/* The travel bar shows the command as a line and the actual position as a
	   block. The gap between them is the following error, drawn rather than
	   described. */
	.travel-bar {
		position: relative;
		height: 9px;
		margin: 9px 0 4px;
		background: var(--surface-3);
		border-radius: 3px;
	}

	.travel-actual {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		width: 3px;
		background: var(--measure);
		border-radius: 2px;
		transition: left 0.1s linear;
	}

	.travel-command {
		position: absolute;
		top: -2px;
		width: 2px;
		height: 13px;
		background: var(--command);
		transition: left 0.1s linear;
	}

	.bar-scale {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		font-size: 10.5px;
		color: var(--text-3);
	}

	.note {
		font-size: 11.5px;
		color: var(--text-2);
		line-height: 1.5;
	}

	.small-note {
		margin-top: 9px;
		padding-top: 8px;
		border-top: 1px solid var(--line-1);
		color: var(--text-3);
	}

	.notes .panel-body {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
</style>
