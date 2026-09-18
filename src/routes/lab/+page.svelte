<script lang="ts">
	/**
	 * The lab page.
	 *
	 * This is the orchestrator: it owns the simulator, drives it from the render
	 * loop, and lays out the viewport and the panels around it. Every decision about
	 * physics is made inside the simulator and every decision about geometry is made
	 * inside the 3D layer, so this file is only about wiring the two to the interface.
	 */
	import { page } from '$app/state';
	import ValveViewport from '$lib/components/ValveViewport.svelte';
	import InstrumentPanel from '$lib/components/InstrumentPanel.svelte';
	import CharacteristicChart from '$lib/components/CharacteristicChart.svelte';
	import LessonPanel from '$lib/components/LessonPanel.svelte';
	import { LESSONS } from '$lib/content/lessons';
	import { SCENARIOS, findScenario, type Scenario } from '$lib/lab/scenario';
	import { createSimulatorForScenario, buildScenarioValve } from '$lib/lab/engineFactory';
	import { buildValveModel, type ValveId } from '$lib/sim/valves/catalogue';
	import type { ProcessPort, Simulator } from '$lib/sim/engine';
	import { isReliefValve } from '$lib/sim/valves/catalogue';
	import { LOOP_PRESETS, type LoopExercise } from '$lib/lab/loopExercise';

	// --- Resolve what to show from the URL ---------------------------------

	/**
	 * A display option can be set from the query string, so a view can be linked to.
	 * Anything other than an explicit negative counts as on.
	 */
	function flagFromUrl(name: string, fallback: boolean): boolean {
		const value = page.url.searchParams.get(name);
		if (value === null) return fallback;
		return !['off', '0', 'false'].includes(value.toLowerCase());
	}

	const requestedScenarioId = page.url.searchParams.get('scenario');
	const requestedValveId = page.url.searchParams.get('valve') as ValveId | null;

	const initialScenario: Scenario | null =
		(requestedScenarioId ? findScenario(requestedScenarioId) : undefined) ??
		(requestedValveId ? SCENARIOS.find((candidate) => candidate.valveId === requestedValveId) : undefined) ??
		null;

	const initialValveId: ValveId = initialScenario?.valveId ?? requestedValveId ?? 'controlValve';

	// --- Simulator state ---------------------------------------------------

	let scenario = $state<Scenario | null>(initialScenario);
	let valveId = $state<ValveId>(initialValveId);

	interface Live {
		simulator: Simulator;
		valve: ReturnType<typeof buildScenarioValve>;
		processName: string;
		processDescription: string;
		processUnit: string;
		processRange: { min: number; max: number };
		/** The process port, which owns the operator controls. */
		process: ProcessPort;
	}

	function createLive(nextScenario: Scenario | null, nextValveId: ValveId): Live {
		if (nextScenario) {
			const { simulator, process } = createSimulatorForScenario(nextScenario);
			return {
				simulator,
				valve: buildScenarioValve(nextScenario),
				processName: process.name,
				processDescription: process.description,
				processUnit: process.controlledUnit,
				processRange: process.controlledRange,
				process
			};
		}

		// Manual mode with no scenario: the catalogue valve under hand control.
		const valve = buildValveModel(nextValveId);
		const base = SCENARIOS[0];
		const manualScenario: Scenario = {
			...base,
			id: 'manual',
			name: `${valve.spec.name} under manual control`,
			valveId: nextValveId,
			nominalSizeInch: valve.spec.ports.nominalSizeInch,
			manualOutputPercent: 40,
			withPositioner: valve.spec.actuator?.hasPositioner ?? true
		};
		const { simulator, process } = createSimulatorForScenario(manualScenario);
		return {
			simulator,
			valve,
			processName: process.name,
			processDescription: process.description,
			processUnit: process.controlledUnit,
			processRange: process.controlledRange,
			process
		};
	}

	/**
	 * The running simulator.
	 *
	 * Held with `$state.raw` because it is always replaced as a whole and never
	 * mutated through this binding. The simulator owns its own mutable state in a
	 * closure, and deep-proxying it would make Svelte track hundreds of fields that
	 * change sixty times a second for no benefit.
	 */
	let live = $state.raw<Live>(createLive(initialScenario, initialValveId));

	// --- Display options ---------------------------------------------------

	let showFlow = $state(flagFromUrl('flow', true));
	let showShell = $state(flagFromUrl('casing', true));
	let showFloor = $state(flagFromUrl('floor', true));
	let showChart = $state(flagFromUrl('chart', false));
	/**
	 * Section view: a cutting plane through the whole assembly.
	 *
	 * Offered alongside hiding the casing because the two answer different questions.
	 * Hiding the casing shows where the internals are; a section shows how thick the
	 * walls are and how the flow path is shaped, which is what a student needs in order
	 * to understand why a globe valve drops more pressure than a gate.
	 */
	let sectionView = $state(flagFromUrl('section', false));
	let sectionOffset = $state(0);
	let running = $state(true);
	/**
	 * Counter that tells the panels when to re-read the simulator.
	 *
	 * The simulator publishes a fresh readout object on every step, but it does so
	 * inside its own closure where Svelte cannot see it. Bumping this counter pulls
	 * the new values through the derived bindings below, which is the idiomatic way
	 * to bridge imperative state into a reactive graph without proxying it.
	 */
	let refreshTick = $state(0);

	/** Readout values, refreshed at a readable rate rather than every frame. */
	const readouts = $derived.by(() => {
		void refreshTick;
		return live.simulator.readouts;
	});

	/** Which control mode is active, manual or automatic. */
	const controlMode = $derived.by(() => {
		void refreshTick;
		return live.simulator.mode;
	});

	const valve = $derived(live.valve);
	const lesson = $derived(LESSONS[valveId]);
	const reliefModel = $derived(isReliefValve(valve) ? valve : null);

	/** The flow coefficient of the reference fluid, used as the chart's normaliser. */
	const referenceFlow = $derived(
		Math.max(
			live.processRange.max,
			live.simulator.readouts.flow.volumetricFlowM3PerHour,
			1
		)
	);

	/**
	 * The valve authority for the chart.
	 *
	 * Authority is a property of the system, not the valve, so it is read from the
	 * hydraulic boundary the process last reported: the share of the total pressure
	 * drop the valve kept when it was wide open.
	 */
	const valveAuthority = $derived.by(() => {
		const available = readouts.flow.availablePressureDropBar;
		if (available <= 0) return 0.5;
		return Math.min(1, Math.max(0.01, readouts.flow.effectivePressureDropBar / available));
	});

	function rebuild(nextScenario: Scenario | null, nextValveId: ValveId): void {
		live = createLive(nextScenario, nextValveId);
		valveId = nextValveId;
		scenario = nextScenario;
		refreshTick++;
	}

	function selectScenario(next: Scenario): void {
		rebuild(next, next.valveId);
		// The preset has to be applied to the simulator that was just built, which is
		// why it reads from the live binding rather than from the scenario.
		applyScenarioPreset(next);
	}

	function applyScenarioPreset(next: Scenario): void {
		if (next.manualOutputPercent !== undefined) {
			live.simulator.setManualOutputPercent(next.manualOutputPercent);
		}
		if (next.setpoint !== undefined) {
			live.simulator.setSetpoint(next.setpoint);
		}
	}

	// --- Frame loop --------------------------------------------------------

	let accumulatorSeconds = 0;

	function onTick(deltaSeconds: number): void {
		if (running) {
			live.simulator.advance(deltaSeconds);
		}
		accumulatorSeconds += deltaSeconds;
		// Refreshing the panel state at about 20 Hz rather than every frame keeps the
		// interface readable: a number that changes sixty times a second cannot be
		// read, and it would make the whole reactivity graph do pointless work.
		if (accumulatorSeconds >= 0.05) {
			accumulatorSeconds = 0;
			refreshTick++;
		}
	}

	// --- Controls ----------------------------------------------------------

	function onManualInput(event: Event): void {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		live.simulator.setManualOutputPercent(value);
		refreshTick++;
	}

	function onSetpointInput(event: Event): void {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		live.simulator.setSetpoint(value);
		refreshTick++;
	}

	function setMode(mode: 'manual' | 'auto'): void {
		live.simulator.setMode(mode);
		refreshTick++;
	}

	function applyLoopPreset(preset: LoopExercise): void {
		live.simulator.setPid({
			gain: preset.gain,
			integralSeconds: preset.integralSeconds,
			derivativeSeconds: preset.derivativeSeconds,
			outputMinPercent: 0,
			outputMaxPercent: 100,
			action: 'reverse'
		});
		live.simulator.setMode('auto');
		refreshTick++;
	}

	function resetSimulation(): void {
		live.simulator.resetProcess();
		refreshTick++;
	}

	function toggleProcessAction(actionId: string): void {
		const action = live.process.actions.find((candidate) => candidate.id === actionId);
		if (!action) return;
		action.apply(!action.isActive());
		// One step is taken so the panels show the effect immediately rather than at
		// the next frame, which matters when the simulation is paused.
		live.simulator.step();
		refreshTick++;
	}

	function faultLabel(): string {
		return live.simulator.readouts.receivedCurrentMa < 3.6 ? 'Clear loop fault' : 'Break the loop';
	}

	function toggleLoopFault(): void {
		const broken = live.simulator.readouts.receivedCurrentMa < 3.6;
		live.simulator.setLoopFault(
			broken
				? { type: 'none', description: 'Loop healthy' }
				: { type: 'openCircuit', description: 'Loop broken at the transmitter' }
		);
		refreshTick++;
	}
</script>

<svelte:head>
	<title>{valve.spec.name}: Instrunyel Valve lab</title>
</svelte:head>

<div class="lab">
	<!-- Left column: scenario selection and controls ----------------------- -->
	<aside class="left scroll">
		<section>
			<h2 class="section-title">Scenario</h2>
			<div class="scenario-list">
				{#each SCENARIOS as candidate (candidate.id)}
					<button
						class="scenario-item"
						data-active={scenario?.id === candidate.id}
						onclick={() => selectScenario(candidate)}
					>
						<strong>{candidate.name}</strong>
						<span>{LESSONS[candidate.valveId].tagline}</span>
					</button>
				{/each}
			</div>
		</section>
	</aside>

	<!-- Centre: 3D view and the plot --------------------------------------- -->
	<section class="stage">
		<div class="stage-main">
			<ValveViewport
				{valveId}
				nominalSizeInch={valve.spec.ports.nominalSizeInch}
				strokeM={valve.spec.actuator?.strokeM ?? 0.04}
				withPositioner={valve.spec.actuator?.hasPositioner ?? false}
				withHandwheel={valve.spec.actuation === 'manual'}
				balanced={valve.spec.ports.balanceSealAreaM2 > 0}
				setPressureBarGauge={reliefModel?.setPressureBarGauge() ?? 10}
				opening={readouts.actualTravelPercent / 100}
				flowM3PerHour={readouts.flow.volumetricFlowM3PerHour}
				referenceFlowM3PerHour={referenceFlow}
				fluidPhase={scenario?.fluid.phase ?? 'liquid'}
				cavitating={readouts.flow.cavitation !== 'none'}
				{showFlow}
				{showShell}
				{showFloor}
				{sectionView}
				{sectionOffset}
				{onTick}
			/>
		</div>

		<div class="stage-bar">
			<!--
				Running is a control, not a display option, so it sits apart from the
				view toggles and reads its state in words. A checkbox among the display
				options gave no clue that unchecking it stopped the simulation, which is
				indistinguishable from the simulation being broken.
			-->
			<div class="run-control">
				<button
					data-variant={running ? 'primary' : undefined}
					onclick={() => (running = !running)}
					aria-pressed={running}
				>
					{running ? 'Running' : 'Paused'}
				</button>
				<span class="dim run-hint">
					{running ? 'Simulation advancing at real time' : 'Simulation held at the current state'}
				</span>
			</div>

			<div class="view-options">
				<label><input type="checkbox" bind:checked={showFlow} /> Flow</label>
				<label><input type="checkbox" bind:checked={showShell} /> Casing</label>
				<label><input type="checkbox" bind:checked={showFloor} /> Floor</label>
				<label title="Cut the valve open with a section plane">
					<input type="checkbox" bind:checked={sectionView} /> Section
				</label>
				{#if sectionView}
					<input
						class="section-slider"
						type="range"
						min="-0.15"
						max="0.15"
						step="0.002"
						value={sectionOffset}
						oninput={(event) => (sectionOffset = Number(event.currentTarget.value))}
						title="Slide the section plane through the valve"
						aria-label="Section plane position"
					/>
				{/if}
			</div>

			<div class="stage-actions">
				<button onclick={() => (showChart = !showChart)} data-active={showChart}>
					Characteristic
				</button>
				<button onclick={resetSimulation}>Reset process</button>
			</div>
		</div>

		{#if showChart}
			<div class="chart-panel panel">
				<CharacteristicChart
					ratedKv={valve.spec.ratedKv}
					characteristic={valve.spec.characteristic}
					rangeability={valve.spec.rangeability}
					totalPressureDropBar={Math.max(readouts.flow.availablePressureDropBar, 1)}
					{valveAuthority}
					specificGravity={1}
					opening={readouts.actualTravelPercent / 100}
				/>
			</div>
		{/if}
	</section>

	<!-- Right column: instruments and lesson ------------------------------- -->
	<aside class="right scroll">
		<InstrumentPanel
			{readouts}
			{valve}
			controlledUnit={live.processUnit}
			controlledRange={live.processRange}
		/>

		<!-- Process panel ------------------------------------------------- -->
		<section class="panel">
			<header class="panel-header">
				<h3>Process</h3>
			</header>
			<div class="panel-body">
				<div class="readout">
					<span class="muted">Arrangement</span>
					<span>{live.processName}</span>
				</div>
				{#each readouts.processReadouts as item (item.label + item.unit)}
					<div class="readout">
						<span class="muted">{item.label}</span>
						<span class="tabular">{item.value.toFixed(2)} {item.unit}</span>
					</div>
				{/each}

				{#if readouts.processActions.length > 0}
					<div class="process-actions">
						{#each readouts.processActions as action (action.id)}
							<button
								data-variant={action.active ? 'primary' : undefined}
								onclick={() => toggleProcessAction(action.id)}
							>
								{action.label}
							</button>
						{/each}
					</div>
				{/if}

				<p class="note">{live.processDescription}</p>
			</div>
		</section>

		<!-- Control panel ------------------------------------------------- -->
		<section class="panel">
			<header class="panel-header">
				<h3>Control</h3>
				<div class="mode-switch">
					<button
						data-active={controlMode === 'manual'}
						onclick={() => setMode('manual')}
						disabled={!valve.spec.actuator && valve.spec.actuation !== 'manual'}
					>
						Manual
					</button>
					<button
						data-active={controlMode === 'auto'}
						onclick={() => setMode('auto')}
						disabled={!live.simulator.config.pid}
					>
						Auto
					</button>
				</div>
			</header>
			<div class="panel-body">
				{#if readouts.selfActing}
					<p class="note">
						This valve is self acting. It has no command signal: the process pressure
						difference provides the opening force, so there is nothing to control.
					</p>
				{:else if controlMode === 'manual'}
					<label class="slider">
						<span class="label">Command</span>
						<span class="tabular">{readouts.controllerOutputPercent.toFixed(1)} %</span>
						<input
							type="range"
							min="0"
							max="100"
							step="0.5"
							value={readouts.controllerOutputPercent}
							oninput={onManualInput}
						/>
					</label>
				{:else}
					<label class="slider">
						<span class="label">Setpoint</span>
						<span class="tabular"
							>{readouts.setpoint.toFixed(2)} <span class="dim">{live.processUnit}</span></span
						>
						<input
							type="range"
							min={live.processRange.min}
							max={live.processRange.max}
							step={(live.processRange.max - live.processRange.min) / 200}
							value={readouts.setpoint}
							oninput={onSetpointInput}
						/>
					</label>

					<div class="tuning">
						<div class="label">Loop tuning</div>
						<div class="preset-row">
							{#each LOOP_PRESETS as preset (preset.id)}
								<button onclick={() => applyLoopPreset(preset)}>{preset.name}</button>
							{/each}
						</div>
					</div>
				{/if}

				<div class="fault-row-controls">
					<button onclick={toggleLoopFault}>{faultLabel()}</button>
				</div>
			</div>
		</section>

		<!-- Lesson panel --------------------------------------------------- -->
		<section class="panel lesson-panel">
			<LessonPanel {lesson} {scenario} />
		</section>
	</aside>
</div>

<style>
	.lab {
		display: grid;
		grid-template-columns: 230px minmax(0, 1fr) 340px;
		gap: 1px;
		background: var(--line-1);
		flex: 1 1 auto;
		min-height: 0;
		height: calc(100vh - 52px);
	}

	.left,
	.right {
		background: var(--surface-0);
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-height: 0;
	}

	.right {
		gap: 10px;
	}

	.section-title {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-3);
		margin-bottom: 9px;
		font-weight: 600;
	}

	.scenario-list {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.scenario-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
		text-align: left;
		padding: 8px 10px;
		background: var(--surface-1);
		border: 1px solid var(--line-1);
		color: var(--text-2);
	}

	.scenario-item strong {
		font-size: 12px;
		color: var(--text-1);
		font-weight: 500;
		line-height: 1.35;
	}

	.scenario-item span {
		font-size: 11px;
		line-height: 1.4;
		color: var(--text-3);
	}

	.scenario-item:hover {
		border-color: var(--line-2);
		background: var(--surface-2);
	}

	.scenario-item[data-active='true'] {
		border-color: var(--accent);
		background: var(--surface-2);
	}

	.scenario-item[data-active='true'] strong {
		color: var(--accent);
	}

	.stage {
		display: flex;
		flex-direction: column;
		background: var(--surface-0);
		min-height: 0;
		min-width: 0;
	}

	.stage-main {
		flex: 1 1 auto;
		min-height: 0;
		position: relative;
	}

	.stage-bar {
		display: flex;
		align-items: center;
		gap: 18px;
		padding: 7px 12px;
		background: var(--surface-1);
		border-top: 1px solid var(--line-1);
		flex: 0 0 auto;
		flex-wrap: wrap;
	}

	.run-control {
		display: flex;
		align-items: center;
		gap: 9px;
	}

	.run-hint {
		font-size: 11px;
	}

	/* The view options take the space that is left, so the actions stay right
	   aligned whatever else is on the bar. */
	.view-options {
		flex: 1 1 auto;
	}

	.view-options {
		display: flex;
		gap: 13px;
		flex-wrap: wrap;
	}

	.view-options label {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 11.5px;
		color: var(--text-2);
		cursor: pointer;
	}

	.view-options input {
		accent-color: var(--accent);
		cursor: pointer;
	}

	/* The section slider sits inline with the toggles and only appears when the section
	   view is on, so it never takes space when it has nothing to control. */
	.section-slider {
		width: 110px;
		margin-left: 4px;
	}

	.stage-actions {
		display: flex;
		gap: 6px;
	}

	.stage-actions button {
		font-size: 11.5px;
		padding: 4px 9px;
	}

	.chart-panel {
		flex: 0 0 auto;
		border-left: none;
		border-right: none;
		border-bottom: none;
		border-radius: 0;
		padding: 12px;
		max-width: 420px;
		border-top: 1px solid var(--line-1);
	}

	h3 {
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-2);
		font-weight: 600;
	}

	.mode-switch {
		display: flex;
		gap: 3px;
	}

	.mode-switch button {
		font-size: 11px;
		padding: 3px 9px;
	}

	.slider {
		display: block;
		margin-bottom: 4px;
	}

	.slider > .label,
	.slider > .tabular {
		display: inline-block;
	}

	.slider > .tabular {
		float: right;
		color: var(--text-1);
	}

	.slider input {
		margin-top: 7px;
		clear: both;
	}

	.tuning {
		margin-top: 13px;
		padding-top: 11px;
		border-top: 1px solid var(--line-1);
	}

	.preset-row {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		margin-top: 7px;
	}

	.preset-row button {
		font-size: 11px;
		padding: 4px 9px;
	}

	.fault-row-controls {
		margin-top: 13px;
		padding-top: 11px;
		border-top: 1px solid var(--line-1);
	}

	.fault-row-controls button {
		font-size: 11.5px;
		width: 100%;
	}

	.process-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 11px;
	}

	.process-actions button {
		font-size: 11.5px;
	}

	.note {
		font-size: 11.5px;
		line-height: 1.55;
		color: var(--text-3);
		margin-top: 11px;
		padding-top: 10px;
		border-top: 1px solid var(--line-1);
	}

	.lesson-panel {
		flex: 1 1 auto;
		min-height: 260px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	@media (max-width: 1200px) {
		.lab {
			grid-template-columns: 200px minmax(0, 1fr) 300px;
		}
	}

	@media (max-width: 980px) {
		.lab {
			grid-template-columns: 1fr;
			height: auto;
		}

		.stage-main {
			height: 420px;
		}

		.left,
		.right {
			max-height: none;
		}
	}
</style>
