<script lang="ts">
	/**
	 * About: what the lab models, what it deliberately does not, and why.
	 *
	 * The limitations are listed as prominently as the features. A learning tool that
	 * hides its assumptions teaches the assumptions along with the physics, and the
	 * assumptions here are the ones an engineer most needs to be able to question.
	 */
	interface ModelNote {
		heading: string;
		body: string;
	}

	const modelled: ModelNote[] = [
		{
			heading: 'Liquid and compressible flow',
			body: 'The flow equations follow the structure of IEC 60534-2-1. Liquid sizing uses the Kv definition, the specific gravity correction and the pressure recovery factor that sets where the flow chokes. Compressible flow adds the expansion factor and the terminal pressure drop ratio, so gas and steam stop gaining flow at the point where they reach sonic velocity at the throat.'
		},
		{
			heading: 'Cavitation and flashing',
			body: 'The vena contracta pressure is computed from the upstream pressure, the vapour pressure and the recovery factor. Below vapour pressure the liquid cavitates, and if the outlet pressure stays below it the liquid flashes. The vapour pressure comes from a steam table rather than from a fitted curve, because a fit is least accurate exactly where cavitation starts.'
		},
		{
			heading: 'Actuator mechanics',
			body: 'The actuator is a force balance: diaphragm force against spring force, with the fluid reaction on the plug and the packing friction resolved every step. The diaphragm case is a real volume of air fed through a restriction, so the actuator takes time to stroke and the air itself damps the motion. That is where the stroke time comes from rather than from a tuned delay.'
		},
		{
			heading: 'Valve positioner',
			body: 'A positioner is modelled as a proportional plus integral device acting on the position error, bounded by the instrument air supply. That is what lets a control valve seat against a fluid force and hold position against friction, and it is why fitting a positioner transforms the accuracy of the same valve body.'
		},
		{
			heading: 'Stem friction',
			body: 'Packing is modelled with separate breakaway and sliding forces, which produces stick-slip behaviour, deadband on reversal, and hysteresis. None of those are imposed separately: they all fall out of the friction model, which is why the lab can show that a positioner does not remove stiction so much as overpower it.'
		},
		{
			heading: 'Instrument signals and control',
			body: 'The 4-20 mA loop carries transmitter damping, noise and quantisation, with NAMUR NE43 fault classification. The controller is a PID with derivative on measurement, a filtered derivative, setpoint weighting and integral clamping, so the behaviour matches what a distributed control system actually does rather than the textbook block diagram.'
		}
	];

	const notModelled: ModelNote[] = [
		{
			heading: 'Noise and vibration',
			body: 'Aerodynamic noise, cavitation noise and pipe vibration are not computed. The lab reports a body velocity, which is the number an engineer uses to judge whether noise will be a problem, but the acoustic calculation itself is a separate discipline.'
		},
		{
			heading: 'Thermal effects',
			body: 'Temperature is an input, not a state. The lab does not warm the fluid as it passes through the valve, does not model flashing liquid cooling itself, and does not compute heat transfer through the body. For a lesson about flow and control those effects are second order, and adding them would obscure the mechanism being taught.'
		},
		{
			heading: 'Mechanical stress and wear',
			body: 'The model computes the forces on the stem but not the stress in it, and it does not accumulate erosion from cavitation or flashing. The lessons describe those consequences qualitatively because they are real, but the simulation does not predict a service life.'
		},
		{
			heading: 'Multiphase flow',
			body: 'Two phase flow is detected and reported but not solved. A flashing liquid produces a mixture whose density and behaviour need a two phase model, and the lab flags the condition rather than pretending to size the downstream piping for it.'
		},
		{
			heading: 'Plant scale',
			body: 'The processes are single loops with lumped volumes. There is no pipe network solver, no pump curve beyond a simple parabola, and no interaction between loops. That is enough to teach what a control valve does and not enough to design a plant.'
		}
	];

	const stack = [
		{ name: 'Bun', role: 'Runtime, package manager and test runner.' },
		{ name: 'SvelteKit', role: 'Application framework, built as a static single page bundle.' },
		{ name: 'Three.js', role: '3D rendering. Every valve is generated from primitives, so there are no model files to load.' },
		{ name: 'Rapier', role: 'Rigid body physics for the loose hardware and the interactive parts. The process physics is computed separately, in TypeScript.' },
		{ name: 'TypeScript', role: 'The simulation core is plain TypeScript with no DOM or renderer dependency, which is what lets it be tested headlessly.' }
	];
</script>

<svelte:head>
	<title>About: Instrunyel Valve</title>
</svelte:head>

<div class="page scroll">
	<header class="head">
		<h1>About this lab</h1>
		<p class="muted">
			Instrunyel Valve is a learning tool for instrumentation engineering. Every valve is a working
			model built from the equations a sizing engineer would use, placed in a process, and driven
			by a signal chain that behaves the way real instruments behave. The aim is that a student
			can see why a valve behaves as it does, and then change something and watch the reason
			reveal itself in the numbers.
		</p>
	</header>

	<section>
		<h2>How it is built</h2>
		<p class="intro">
			The process physics and the rendering are deliberately kept apart. Everything below the
			3D view is plain TypeScript that can run without a browser, which is why the flow
			equations, the force balance and the controller are covered by unit tests rather than
			checked by eye.
		</p>
		<ul class="stack">
			{#each stack as item (item.name)}
				<li>
					<strong>{item.name}</strong>
					<span class="muted">{item.role}</span>
				</li>
			{/each}
		</ul>
	</section>

	<section>
		<h2>What the model covers</h2>
		<div class="notes">
			{#each modelled as note (note.heading)}
				<article class="panel note">
					<h3>{note.heading}</h3>
					<p>{note.body}</p>
				</article>
			{/each}
		</div>
	</section>

	<section>
		<h2>What it deliberately does not cover</h2>
		<p class="intro">
			Knowing where a model stops being trustworthy is part of using it well, so the boundaries
			are stated as plainly as the capabilities.
		</p>
		<div class="notes">
			{#each notModelled as note (note.heading)}
				<article class="panel note limitation">
					<h3>{note.heading}</h3>
					<p>{note.body}</p>
				</article>
			{/each}
		</div>
	</section>

	<section>
		<h2>Standards referenced</h2>
		<ul class="standards">
			<li>
				<strong>IEC 60534-2-1</strong>
				<span class="muted"
					>, the sizing equations for control valves: flow coefficients, the liquid pressure
					recovery factor and the compressible flow expansion factor.</span
				>
			</li>
			<li>
				<strong>IEC 60534-2-3</strong>
				<span class="muted"
					>, the piping geometry factor that corrects for reducers and fittings. Exposed as an
					input rather than derived, because it needs the piping layout.</span
				>
			</li>
			<li>
				<strong>NAMUR NE43</strong>
				<span class="muted"
					>, the current loop fault classification: below 3.6 mA is downscale, above 21.0 mA is
					upscale, and the bands just inside are saturation.</span
				>
			</li>
			<li>
				<strong>API 520 and API 526</strong>
				<span class="muted"
					>, the relief valve orifice equation and the standard orifice letter designations.</span
				>
			</li>
			<li>
				<strong>ASME BPVC Section VIII</strong>
				<span class="muted"
					>, the 10 percent overpressure allowance and the blowdown requirement that set a
					relief valve's three characteristic pressures.</span
				>
			</li>
		</ul>
		<p class="disclaimer">
			This project is an educational tool. It is not a substitute for a sizing calculation
			carried out against the current edition of the relevant standard, for a manufacturer's
			software, or for the judgement of a qualified engineer.
		</p>
	</section>
</div>

<style>
	.page {
		padding: 26px 24px 60px;
		max-width: 900px;
		margin: 0 auto;
		width: 100%;
	}

	.head {
		margin-bottom: 30px;
	}

	.head h1 {
		margin-bottom: 9px;
	}

	.head p {
		font-size: 14px;
		line-height: 1.7;
	}

	section + section {
		margin-top: 34px;
	}

	h2 {
		font-size: 17px;
		margin-bottom: 8px;
	}

	.intro {
		font-size: 13.5px;
		line-height: 1.7;
		color: var(--text-2);
		max-width: 74ch;
		margin-bottom: 15px;
	}

	.stack {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 9px;
	}

	.stack li {
		font-size: 13.5px;
		line-height: 1.6;
	}

	.stack strong {
		color: var(--accent);
		margin-right: 4px;
	}

	.notes {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
		gap: 11px;
	}

	.note {
		padding: 14px 16px;
	}

	.note h3 {
		font-size: 13.5px;
		margin-bottom: 6px;
	}

	.note p {
		font-size: 12.5px;
		line-height: 1.62;
		color: var(--text-2);
	}

	.limitation h3 {
		color: var(--warn);
	}

	.standards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.standards li {
		font-size: 13.5px;
		line-height: 1.6;
	}

	.standards strong {
		color: var(--text-1);
	}

	.disclaimer {
		margin-top: 20px;
		padding: 13px 15px;
		border-left: 2px solid var(--warn);
		background: var(--surface-1);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		font-size: 12.5px;
		line-height: 1.6;
		color: var(--text-2);
	}
</style>
