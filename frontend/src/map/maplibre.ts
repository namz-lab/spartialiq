// MapLibre GL, with its web worker located for the bundler. Every `import … from 'maplibre-gl'` in the app resolves here
// (the alias in vite.config.ts), so the worker is set once, before any map is made, wherever MapLibre is first loaded.
//
// Why: from version 5 MapLibre finds its worker as `./maplibre-gl-worker.mjs` beside its own file. Vite's dependency
// pre-bundling (development) and Rollup (production) both move the library, the worker file is left behind, and every
// map stays blank with "Worker failed to load". Importing the worker with `?url` makes it an asset of the build.
import { setWorkerUrl } from 'maplibre-gl/dist/maplibre-gl.mjs'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

setWorkerUrl(workerUrl)

export * from 'maplibre-gl/dist/maplibre-gl.mjs'
