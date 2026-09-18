<script lang="ts">
	/**
	 * The concepts page: the cross cutting ideas, each tied to the valves that
	 * demonstrate it.
	 */
	import { CONCEPTS, LESSONS } from '$lib/content/lessons';
	import { buildValveModel } from '$lib/sim/valves/catalogue';
</script>

<svelte:head>
	<title>Concepts: Instrunyel Valve</title>
</svelte:head>

<div class="page scroll">
	<header class="head">
		<h1>Concepts</h1>
		<p class="muted">
			The ideas that apply across every valve in the catalogue. Each one is demonstrated by the
			valves listed against it, and the simulation behind the lab reproduces the behaviour
			described here rather than merely illustrating it.
		</p>
	</header>

	{#each CONCEPTS as concept (concept.id)}
		<article class="concept panel" id={concept.id}>
			<header>
				<h2>{concept.title}</h2>
				<p class="summary">{concept.summary}</p>
			</header>

			<p class="body">{concept.body}</p>

			<footer>
				<span class="label">Demonstrated by</span>
				<div class="links">
					{#each concept.demonstratedBy as valveId (valveId)}
						<a href="/lab?valve={valveId}">
							{buildValveModel(valveId).spec.name}
							<span class="dim">, {LESSONS[valveId].tagline}</span>
						</a>
					{/each}
				</div>
			</footer>
		</article>
	{/each}
</div>

<style>
	.page {
		padding: 26px 24px 60px;
		max-width: 900px;
		margin: 0 auto;
		width: 100%;
	}

	.head {
		margin-bottom: 26px;
	}

	.head h1 {
		margin-bottom: 9px;
	}

	.head p {
		max-width: 70ch;
		font-size: 14px;
	}

	.concept {
		padding: 17px 19px;
		box-shadow: var(--shadow-panel);
	}

	.concept + .concept {
		margin-top: 13px;
	}

	.concept h2 {
		font-size: 15px;
		margin-bottom: 3px;
	}

	.summary {
		font-size: 12.5px;
		color: var(--accent);
	}

	.body {
		margin-top: 11px;
		font-size: 13.5px;
		line-height: 1.72;
		color: var(--text-2);
	}

	footer {
		margin-top: 15px;
		padding-top: 13px;
		border-top: 1px solid var(--line-1);
	}

	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 7px 16px;
		margin-top: 6px;
	}

	.links a {
		font-size: 12.5px;
	}

	.dim {
		font-size: 11.5px;
	}
</style>
