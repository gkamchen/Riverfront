// Monta packages/desktop/dist: processo principal e preload empacotados com
// esbuild (o servidor vai junto), tela inicial e o cliente web já compilado.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const clientDist = join(here, '..', 'client', 'dist');
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));

if (!existsSync(join(clientDist, 'index.html'))) {
  console.error('Cliente web não compilado. Rode "npm run build" na raiz antes.');
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron', 'bufferutil', 'utf-8-validate'],
  legalComments: 'none',
  logLevel: 'warning',
  define: { __RIVERFRONT_VERSION__: JSON.stringify(pkg.version) },
};

await build({ ...common, entryPoints: [join(here, 'src', 'main.ts')], outfile: join(dist, 'main.cjs') });
await build({ ...common, entryPoints: [join(here, 'src', 'preload.ts')], outfile: join(dist, 'preload.cjs') });

cpSync(join(here, 'static'), join(dist, 'launcher'), { recursive: true });
cpSync(clientDist, join(dist, 'client'), { recursive: true });

if (!existsSync(join(here, 'build', 'icon.ico'))) {
  execFileSync(process.execPath, [join(here, '..', '..', 'scripts', 'make-icons.mjs')], { stdio: 'inherit' });
}

console.log(`desktop ${pkg.version} pronto em ${dist}`);
