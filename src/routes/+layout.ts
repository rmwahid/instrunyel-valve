/**
 * The whole application is client rendered.
 *
 * WebGL and WebAssembly both need a browser, and prerendering a page whose main
 * content is a canvas would produce an empty shell that then has to hydrate and
 * draw anyway. Disabling server side rendering keeps the build a single static
 * bundle with no server requirement.
 */
export const prerender = true;
export const ssr = false;
