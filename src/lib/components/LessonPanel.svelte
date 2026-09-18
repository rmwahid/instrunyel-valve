<script lang="ts">
	/**
	 * The lesson panel: what the valve is, how it works, and what to look at.
	 *
	 * The scenario steps are shown first when a scenario is running, because a
	 * student who has just opened the lab needs to be told what to do before being
	 * told why it matters.
	 */
	import type { Lesson } from '$lib/content/lessons';
	import type { Scenario } from '$lib/lab/scenario';

	interface Props {
		lesson: Lesson;
		/** The running scenario, when there is one. */
		scenario: Scenario | null;
	}

	let { lesson, scenario }: Props = $props();

	type Tab = 'steps' | 'lesson' | 'application';
	let tab = $state<Tab>('steps');

	// A scenario always has steps, so opening on the steps tab is never empty.
	$effect(() => {
		void scenario;
		tab = 'steps';
	});
</script>

<div class="lesson">
	<div class="tabs" role="tablist">
		<button
			role="tab"
			aria-selected={tab === 'steps'}
			data-active={tab === 'steps'}
			onclick={() => (tab = 'steps')}
		>
			Steps
		</button>
		<button
			role="tab"
			aria-selected={tab === 'lesson'}
			data-active={tab === 'lesson'}
			onclick={() => (tab = 'lesson')}
		>
			How it works
		</button>
		<button
			role="tab"
			aria-selected={tab === 'application'}
			data-active={tab === 'application'}
			onclick={() => (tab = 'application')}
		>
			Where to use it
		</button>
	</div>

	<div class="body scroll">
		{#if tab === 'steps'}
			{#if scenario}
				<div class="scenario-head">
					<h3>{scenario.name}</h3>
					<p class="purpose">{scenario.purpose}</p>
				</div>
				<ol class="steps">
					{#each scenario.steps as step, index (index)}
						<li>{step}</li>
					{/each}
				</ol>
			{:else}
				<p class="muted">
					No scenario is running, so the valve is under manual control. Open a scenario from
					the list to follow a guided demonstration, or drive the valve by hand and watch the
					numbers respond.
				</p>
				<div class="scenario-head">
					<h3>{lesson.tagline}</h3>
				</div>
			{/if}
		{:else if tab === 'lesson'}
			{#each lesson.sections as section (section.heading)}
				<section>
					<h4>{section.heading}</h4>
					<p>{section.body}</p>
				</section>
			{/each}

			<section class="key-points">
				<h4>Worth remembering</h4>
				<ul>
					{#each lesson.keyPoints as point (point)}
						<li>{point}</li>
					{/each}
				</ul>
			</section>
		{:else}
			<section>
				<h4>Good applications</h4>
				<ul class="good">
					{#each lesson.applications as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
			</section>

			<section>
				<h4>Where it is the wrong choice</h4>
				<ul class="bad">
					{#each lesson.limitations as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>
</div>

<style>
	.lesson {
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
	}

	.tabs {
		display: flex;
		gap: 2px;
		padding: 8px 10px 0;
		border-bottom: 1px solid var(--line-1);
		flex: 0 0 auto;
	}

	.tabs button {
		border: none;
		background: transparent;
		color: var(--text-3);
		border-radius: var(--radius-sm) var(--radius-sm) 0 0;
		padding: 6px 11px;
		font-size: 12px;
		border-bottom: 2px solid transparent;
	}

	.tabs button:hover:not([data-active='true']) {
		color: var(--text-1);
		background: var(--surface-2);
		border-color: transparent;
	}

	.tabs button[data-active='true'] {
		color: var(--text-1);
		background: transparent;
		border-bottom-color: var(--accent);
	}

	.body {
		padding: 14px 15px 20px;
		flex: 1 1 auto;
		min-height: 0;
	}

	.scenario-head h3 {
		font-size: 14px;
		margin-bottom: 6px;
	}

	.purpose {
		font-size: 12.5px;
		line-height: 1.6;
		color: var(--text-2);
		margin-bottom: 15px;
	}

	.steps {
		margin: 0;
		padding-left: 0;
		list-style: none;
		counter-reset: step;
		display: flex;
		flex-direction: column;
		gap: 9px;
	}

	.steps li {
		counter-increment: step;
		display: flex;
		gap: 10px;
		font-size: 12.5px;
		line-height: 1.6;
		color: var(--text-2);
	}

	.steps li::before {
		content: counter(step);
		flex: 0 0 auto;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--surface-3);
		color: var(--accent);
		font-size: 10.5px;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-top: 1px;
	}

	section + section {
		margin-top: 17px;
		padding-top: 15px;
		border-top: 1px solid var(--line-1);
	}

	h4 {
		font-size: 12.5px;
		color: var(--text-1);
		margin-bottom: 6px;
	}

	section p {
		font-size: 12.5px;
		line-height: 1.65;
		color: var(--text-2);
	}

	ul {
		margin: 0;
		padding-left: 16px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	li {
		font-size: 12.5px;
		line-height: 1.6;
		color: var(--text-2);
	}

	.key-points li::marker {
		color: var(--accent);
	}

	.good li::marker {
		color: var(--ok);
	}

	.bad li::marker {
		color: var(--warn);
	}
</style>
