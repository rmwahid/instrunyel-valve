<script lang="ts">
	import { VALVE_CATALOGUE, type ValveId } from '$lib/sim/valves/catalogue';
	import { LESSONS, CONCEPTS } from '$lib/content/lessons';
	import { SCENARIOS } from '$lib/lab/scenario';
	import { describeActuator } from '$lib/sim/actuator';
	import { characteristicDescription } from '$lib/sim/characteristic';
	import { kvToCv } from '$lib/sim/units';

	interface Card {
		id: ValveId;
		name: string;
		tagline: string;
		family: string;
		ratedKv: number;
		ratedCv: number;
		characteristic: string;
		recovery: number;
		terminalRatio: number;
		services: readonly string[];
		actuatorNote: string | null;
		scenarioCount: number;
	}

	const cards: Card[] = VALVE_CATALOGUE.map((entry) => {
		const model = entry.create();
		const lesson = LESSONS[entry.id];
		const actuator = model.spec.actuator;

		return {
			id: entry.id,
			name: model.spec.name,
			tagline: lesson.tagline,
			family: model.spec.family,
			ratedKv: model.spec.ratedKv,
			ratedCv: kvToCv(model.spec.ratedKv),
			characteristic: characteristicDescription(model.spec.characteristic),
			recovery: model.spec.pressureRecoveryFactor,
			terminalRatio: model.spec.terminalPressureDropRatio,
			services: model.spec.typicalServices,
			actuatorNote: actuator ? describeActuator(actuator) : null,
			scenarioCount: SCENARIOS.filter((scenario) => scenario.valveId === entry.id).length
		};
	});

	const familyLabel: Record<string, string> = {
		linear: 'Sliding stem',
		rotary: 'Quarter turn',
		selfActing: 'Self acting',
		onOff: 'On-off'
	};

	function formatKv(value: number): string {
		return value >= 10 ? value.toFixed(0) : value.toFixed(2);
	}
</script>

<svelte:head>
	<title>Valve catalogue: Instrunyel Valve</title>
</svelte:head>

<div class="page scroll">
	<section class="intro">
		<h1>Valve and instrument catalogue</h1>
		<p class="muted">
			Every valve here is a working model, not a drawing. The capacities, pressure recovery
			factors and actuator specifications are the ones the simulation uses, so the behaviour you
			see in the lab follows from the numbers on this page.
		</p>
	</section>

	<section class="grid">
		{#each cards as card (card.id)}
			<article class="card panel">
				<header class="card-head">
					<div>
						<div class="label">{familyLabel[card.family] ?? card.family}</div>
						<h2>{card.name}</h2>
					</div>
					{#if card.scenarioCount > 0}
						<span class="badge"
							>{card.scenarioCount} scenario{card.scenarioCount === 1 ? '' : 's'}</span
						>
					{/if}
				</header>

				<p class="tagline">{card.tagline}</p>

				<dl class="specs">
					<div>
						<dt>Rated capacity</dt>
						<dd class="tabular">Kv {formatKv(card.ratedKv)} · Cv {formatKv(card.ratedCv)}</dd>
					</div>
					<div>
						<dt>Recovery / xT</dt>
						<dd class="tabular"
							>{card.recovery.toFixed(2)} / {card.terminalRatio.toFixed(2)}</dd
						>
					</div>
					<div class="wide">
						<dt>Characteristic</dt>
						<dd class="small">{card.characteristic}</dd>
					</div>
					{#if card.actuatorNote}
						<div class="wide">
							<dt>Actuator</dt>
							<dd class="small">{card.actuatorNote}</dd>
						</div>
					{/if}
				</dl>

				<div class="services">
					{#each card.services.slice(0, 3) as service (service)}
						<span class="chip">{service}</span>
					{/each}
				</div>

				<footer class="card-foot">
					<a class="go" href="/lab?valve={card.id}">Inspect in the lab</a>
				</footer>
			</article>
		{/each}
	</section>

	<section class="block">
		<h2>Guided scenarios</h2>
		<p class="muted intro-text">
			Each scenario places a valve in a process and sets the conditions so that one idea becomes
			visible. Start the simulation, follow the steps, and read the numbers as they change.
		</p>
		<div class="scenario-grid">
			{#each SCENARIOS as scenario (scenario.id)}
				<a class="link-card panel" href="/lab?scenario={scenario.id}">
					<strong>{scenario.name}</strong>
					<span class="muted">{scenario.purpose}</span>
				</a>
			{/each}
		</div>
	</section>

	<section class="block">
		<h2>Concepts</h2>
		<p class="muted intro-text">
			The ideas that hold the catalogue together, each one demonstrated by the valves listed
			against it.
		</p>
		<div class="concept-grid">
			{#each CONCEPTS as concept (concept.id)}
				<a class="link-card panel" href="/concepts#{concept.id}">
					<strong>{concept.title}</strong>
					<span class="muted">{concept.summary}</span>
				</a>
			{/each}
		</div>
	</section>
</div>

<style>
	.page {
		padding: 26px 24px 60px;
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
	}

	.intro {
		max-width: 78ch;
		margin-bottom: 26px;
	}

	.intro h1 {
		margin-bottom: 9px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(315px, 1fr));
		gap: 15px;
	}

	.card {
		display: flex;
		flex-direction: column;
		box-shadow: var(--shadow-panel);
	}

	.card-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
		padding: 13px 15px 9px;
	}

	.card-head h2 {
		font-size: 16px;
		margin-top: 2px;
	}

	.badge {
		font-size: 10.5px;
		padding: 2px 7px;
		border-radius: 10px;
		background: var(--surface-3);
		color: var(--accent);
		white-space: nowrap;
		border: 1px solid var(--accent-dim);
	}

	.tagline {
		padding: 0 15px 12px;
		color: var(--text-2);
		font-size: 13px;
	}

	.specs {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px 14px;
		margin: 0;
		padding: 12px 15px;
		border-top: 1px solid var(--line-1);
		border-bottom: 1px solid var(--line-1);
		background: rgb(0 0 0 / 0.16);
	}

	.specs > div {
		min-width: 0;
	}

	.specs .wide {
		grid-column: 1 / -1;
	}

	dt {
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-3);
	}

	dd {
		margin: 1px 0 0;
		font-size: 12.5px;
		color: var(--text-1);
	}

	dd.small {
		font-size: 11.5px;
		color: var(--text-2);
		line-height: 1.45;
	}

	.services {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		padding: 11px 15px;
	}

	.chip {
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 10px;
		background: var(--surface-2);
		color: var(--text-2);
		border: 1px solid var(--line-1);
	}

	.card-foot {
		margin-top: auto;
		padding: 11px 15px 14px;
	}

	.go {
		font-size: 12.5px;
		font-weight: 500;
	}

	.block {
		margin-top: 40px;
	}

	.block h2 {
		margin-bottom: 6px;
	}

	.intro-text {
		max-width: 78ch;
		margin-bottom: 15px;
		font-size: 13.5px;
	}

	.scenario-grid,
	.concept-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
		gap: 11px;
	}

	.link-card {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 13px 15px;
		color: var(--text-1);
		text-decoration: none;
		transition:
			border-color 0.12s ease,
			background 0.12s ease;
	}

	.link-card:hover {
		text-decoration: none;
		border-color: var(--accent-dim);
		background: var(--surface-2);
	}

	.link-card strong {
		font-size: 13.5px;
	}

	.link-card span {
		font-size: 12.5px;
		line-height: 1.5;
	}
</style>
