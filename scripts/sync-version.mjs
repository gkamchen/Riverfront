// Ajusta a versão dos pacotes publicados a partir de uma tag (v1.2.3) ou argumento.
// Uso: node scripts/sync-version.mjs 1.2.3   (ou com GITHUB_REF_NAME=v1.2.3 no CI)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? '';
const version = raw.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Versão inválida: "${raw}". Use algo como 1.2.3 ou v1.2.3.`);
  process.exit(1);
}

for (const file of ['package.json', 'packages/protocol/package.json', 'packages/server/package.json', 'packages/desktop/package.json']) {
  const path = join(root, file);
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  pkg.version = version;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`${file}: ${version}`);
}
