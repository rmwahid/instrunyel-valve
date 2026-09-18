import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	server: {
		watch: {
			// The build output and the generated kit files are written by the tooling
			// itself. Watching them makes the dev server reload every time a build
			// runs, which is noise while working and actively confusing when the
			// build is being checked from another terminal.
			ignored: ['**/build/**', '**/.svelte-kit/**']
		}
	},

	build: {
		rollupOptions: {
			output: {
				/**
				 * Three.js and Rapier are large and change far less often than the application
				 * code, so each gets a chunk of its own. The browser downloads them in
				 * parallel with the rest and keeps them cached across application deploys,
				 * instead of re-downloading a single bundle that contains everything.
				 */
				manualChunks(id: string) {
					if (id.includes('/node_modules/@dimforge/')) return 'rapier';
					if (id.includes('/node_modules/three/')) return 'three';
					return undefined;
				}
			}
		}
	},

	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// The 3D lab is a client only application: WebGL, Rapier and the fixed step
			// simulation loop all need a browser. Prerendering produces a page per
			// route, and the fallback covers any route that was not prerendered.
			//
			// The fallback is named 200.html rather than index.html because SvelteKit
			// already writes index.html for the root route, and overwriting it would
			// replace the prerendered catalogue with a blank shell.
			adapter: adapter({ fallback: '200.html' })
		})
	]
});
