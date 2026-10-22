// Demo estática do cliente para o GitHub Pages: release/demo, com caminhos
// relativos (funciona em https://gkamchen.github.io/Riverfront/ ou em qualquer
// subpasta). Não leva nada do servidor: para jogar online, a página recebe o
// endereço por ?servidor= ou #servidor= (veja docs/hospedagem.md).
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'release', 'demo');
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');

// avisos de terceiros atualizados (vão para a raiz da demo pelo public/ do cliente)
spawnSync(process.execPath, [join(root, 'scripts', 'third-party-notices.mjs')], { stdio: 'inherit' });

const r = spawnSync(process.execPath, [vite, 'build', '--base', './', '--outDir', out, '--emptyOutDir'], {
  cwd: join(root, 'packages', 'client'),
  stdio: 'inherit',
  env: { ...process.env, RIVERFRONT_STATIC: '1' },
});
if (r.status !== 0) process.exit(r.status ?? 1);
if (!existsSync(join(out, 'index.html'))) {
  console.error('Build da demo não gerou index.html.');
  process.exit(1);
}
// O GitHub Pages não precisa processar nada com Jekyll.
writeFileSync(join(out, '.nojekyll'), '');
console.log(`demo estática em ${out}`);
