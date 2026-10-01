/** Standalone host and browser bundle outputs. */
import type { UserConfig } from 'tsdown'

/** Modules the DSH web client provides at runtime (shared React instance). */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
]

const host: UserConfig = {
  name: '@copylee/dsh-image-gen',
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  // DSH host libraries are inlined on purpose (the plugin must not depend on
  // the exact rc the host ships); undici/socks stay external as dependencies.
  deps: { onlyBundle: false },
}

const client: UserConfig = {
  name: '@copylee/dsh-image-gen/client',
  entry: { client: 'lib/types/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: CLIENT_EXTERNALS,
    // Everything else (lucide-react, shared helpers) ships inside the bundle.
    alwaysBundle: (id: string) => CLIENT_EXTERNALS.includes(id) ? undefined : true,
    onlyBundle: false,
  },
  // The host webview has no `process` global; bake NODE_ENV at build time.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  alias: {
    'lucide-react': 'lucide-react/dist/esm/lucide-react.mjs',
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "@copylee/dsh-image-gen", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [host, client]
