import { build } from 'esbuild'

await build({
  bundle: true,
  entryPoints: ['src/extension.ts'],
  // unzipper optionally supports reading from S3, but we only ever read
  // local files (Open.file) — the AWS SDK is never actually required at
  // runtime, so it's safe to exclude from the bundle.
  external: ['vscode', '@aws-sdk/client-s3'],
  format: 'cjs',
  logLevel: 'info',
  outfile: 'dist/extension.js',
  platform: 'node',
  sourcemap: true,
  target: 'node18',
})
