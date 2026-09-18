<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { preloadCode } from '$app/navigation';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	onMount(() => {
		/**
		 * Fetch the lab's code while the browser is idle.
		 *
		 * The lab is by far the heaviest route, and its code is only requested when the
		 * router navigates to it, which puts the whole download between a click and the
		 * first frame. Loading it in the background means that click does not wait, and it
		 * costs nothing on screen because the browser chooses when idle is.
		 */
		const preload = () => void preloadCode('/lab');
		let idleHandle: number | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;

		if (typeof window.requestIdleCallback === 'function') {
			idleHandle = window.requestIdleCallback(preload, { timeout: 3000 });
		} else {
			timer = setTimeout(preload, 2000);
		}

		return () => {
			if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle);
			if (timer !== undefined) clearTimeout(timer);
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Instrunyel Valve: instrumentation and valve lab</title>
	<meta
		name="description"
		content="An interactive 3D lab for learning how valves and process instruments work, built on the engineering equations rather than on animation."
	/>
</svelte:head>

<div class="shell">
	<header class="topbar">
		<a class="brand" href="/">
			<span class="brand-mark" aria-hidden="true"></span>
			<span>
				<strong>Instrunyel Valve</strong>
				<span class="brand-sub">Instrumentation and valve lab</span>
			</span>
		</a>

		<nav>
			<a href="/" data-active={page.url.pathname === '/'}>Catalogue</a>
			<a href="/lab" data-active={page.url.pathname.startsWith('/lab')}>Lab</a>
			<a href="/concepts" data-active={page.url.pathname.startsWith('/concepts')}>Concepts</a>
			<a href="/about" data-active={page.url.pathname.startsWith('/about')}>About</a>
		</nav>
	</header>

	<main>
		{@render children()}
	</main>
</div>

<style>
	.shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		padding: 0 18px;
		height: 52px;
		background: var(--surface-1);
		border-bottom: 1px solid var(--line-1);
		flex: 0 0 auto;
		z-index: 10;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--text-1);
		text-decoration: none;
	}

	.brand:hover {
		text-decoration: none;
	}

	.brand-mark {
		width: 22px;
		height: 22px;
		border-radius: 4px;
		background: linear-gradient(135deg, var(--accent) 0%, var(--measure) 100%);
		position: relative;
	}

	/* A horizontal stroke suggests the flow path through a valve body. */
	.brand-mark::after {
		content: '';
		position: absolute;
		inset: 9px 4px;
		background: var(--surface-1);
		border-radius: 1px;
	}

	.brand strong {
		display: block;
		font-size: 14px;
		line-height: 1.1;
	}

	.brand-sub {
		display: block;
		font-size: 10.5px;
		color: var(--text-3);
		letter-spacing: 0.02em;
	}

	nav {
		display: flex;
		gap: 2px;
	}

	nav a {
		padding: 5px 11px;
		border-radius: var(--radius-sm);
		color: var(--text-2);
		font-size: 13px;
	}

	nav a:hover {
		background: var(--surface-2);
		color: var(--text-1);
		text-decoration: none;
	}

	nav a[data-active='true'] {
		background: var(--surface-3);
		color: var(--text-1);
	}

	main {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
</style>
