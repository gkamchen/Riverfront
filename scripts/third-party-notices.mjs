// Gera THIRD_PARTY_NOTICES.txt a partir do package-lock.json e de node_modules:
// todas as dependências que vão junto com o jogo (cliente, servidor e app de
// desktop), com licença, versão e o texto de licença de cada uma.
// Uso: node scripts/third-party-notices.mjs   (roda sozinho no build)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const entries = lock.packages ?? {};

/** Pacotes do monorepo que vão para quem joga (o resto é ferramenta de build/teste). */
const SHIPPED = ['packages/core', 'packages/ai', 'packages/protocol', 'packages/client', 'packages/server'];
/** Fora das dependências de produção, mas embutido no instalador. */
const RUNTIME_EXTRA = ['electron'];

function entryFor(name) {
  return entries[`node_modules/${name}`] ?? null;
}

const seen = new Map();
function visit(name) {
  if (seen.has(name) || name.startsWith('@riverfront/')) return;
  const entry = entryFor(name);
  if (!entry) return;
  seen.set(name, entry);
  for (const dep of Object.keys(entry.dependencies ?? {})) visit(dep);
}

for (const ws of SHIPPED) for (const dep of Object.keys(entries[ws]?.dependencies ?? {})) visit(dep);
// O electron baixa o runtime na instalação; as dependências de instalação dele não vão no app.
for (const name of RUNTIME_EXTRA) if (entryFor(name)) seen.set(name, entryFor(name));

function licenseText(name) {
  const dir = join(root, 'node_modules', name);
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null;
}

const lines = [
  'Riverfront - avisos de terceiros',
  '================================',
  '',
  'O Riverfront inclui os componentes abaixo, cada um sob a própria licença.',
  'O código do Riverfront em si está sob a PolyForm Noncommercial 1.0.0 (arquivo LICENSE).',
  '',
  'O app de desktop também inclui o Electron e o Chromium; os avisos completos do',
  'Chromium e de suas dependências vêm no arquivo LICENSES.chromium.html, ao lado',
  'do executável instalado.',
  '',
];
const names = [...seen.keys()].sort();
for (const name of names) {
  const entry = seen.get(name);
  const pkgPath = join(root, 'node_modules', name, 'package.json');
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : {};
  lines.push('-'.repeat(78), `${name} ${entry.version ?? pkg.version ?? ''}`.trim(), `Licença: ${entry.license ?? pkg.license ?? 'não informada'}`);
  if (pkg.homepage || pkg.repository) lines.push(`Fonte: ${pkg.homepage ?? (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url)}`);
  lines.push('');
  lines.push(licenseText(name) ?? '(o pacote não traz arquivo de licença; vale a licença informada acima)');
  lines.push('');
}
const text = `${lines.join('\n')}\n`;

const targets = [join(root, 'THIRD_PARTY_NOTICES.txt'), join(root, 'packages', 'client', 'public', 'THIRD_PARTY_NOTICES.txt')];
for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}
console.log(`avisos de terceiros: ${names.join(', ')}`);
