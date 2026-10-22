// Empacota o servidor (core + protocolo + ws) num único arquivo CommonJS.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/riverfront-server.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  // dependências opcionais do ws, que funciona sem elas
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: `#!/usr/bin/env node\n// Riverfront server ${pkg.version}` },
  logLevel: 'warning',
  define: { __RIVERFRONT_VERSION__: JSON.stringify(pkg.version) },
});

console.log(`servidor empacotado em dist/riverfront-server.cjs (${pkg.version})`);
