import { build } from 'esbuild'

await build({
  bundle: true,
  entryPoints: ['src/extension.ts'],
  external: ['vscode'],
  format: 'cjs',
  logLevel: 'info',
  outfile: 'dist/extension.js',
  platform: 'node',
  sourcemap: true,
  target: 'node18',
})
