// Gera o pacote do servidor dedicado: release/server/riverfront-server-<versão>.zip
// Conteúdo: servidor num arquivo só, cliente web (public/), scripts de início,
// Dockerfile, docker-compose.yml e LEIA-ME. Rode depois de "npm run build".
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'packages', 'server', 'package.json'), 'utf8')).version;
const name = `riverfront-server-${version}`;
const outRoot = join(root, 'release', 'server');
const stage = join(outRoot, name);

const bundle = join(root, 'packages', 'server', 'dist', 'riverfront-server.cjs');
const client = join(root, 'packages', 'client', 'dist');
for (const [path, hint] of [
  [bundle, 'servidor não empacotado'],
  [join(client, 'index.html'), 'cliente web não compilado'],
]) {
  if (!existsSync(path)) {
    console.error(`${hint}: rode "npm run build" na raiz antes.`);
    process.exit(1);
  }
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(bundle, join(stage, 'riverfront-server.cjs'));
cpSync(client, join(stage, 'public'), { recursive: true });
cpSync(join(root, 'packages', 'server', '.env.example'), join(stage, '.env.example'));
cpSync(join(root, 'LICENSE'), join(stage, 'LICENSE.txt'));
cpSync(join(root, 'THIRD_PARTY_NOTICES.txt'), join(stage, 'THIRD_PARTY_NOTICES.txt'));

const files = {
  'iniciar-servidor.bat': [
    '@echo off',
    'chcp 65001 >nul',
    'cd /d "%~dp0"',
    'where node >nul 2>nul',
    'if errorlevel 1 (',
    '  echo Node.js 20 ou mais recente nao foi encontrado. Instale em https://nodejs.org e rode de novo.',
    '  pause',
    '  exit /b 1',
    ')',
    'if not exist .env copy .env.example .env >nul',
    'node riverfront-server.cjs',
    'pause',
    '',
  ].join('\r\n'),
  'iniciar-servidor.sh': [
    '#!/bin/sh',
    'cd "$(dirname "$0")" || exit 1',
    'if ! command -v node >/dev/null 2>&1; then',
    '  echo "Node.js 20 ou mais recente não foi encontrado. Instale em https://nodejs.org e rode de novo."',
    '  exit 1',
    'fi',
    '[ -f .env ] || cp .env.example .env',
    'exec node riverfront-server.cjs',
    '',
  ].join('\n'),
  Dockerfile: [
    '# Servidor do Riverfront. Build: docker build -t riverfront-server .',
    'FROM node:22.20.0-alpine',
    'WORKDIR /app',
    'COPY riverfront-server.cjs ./',
    'COPY public ./public',
    'RUN mkdir -p /data && chown node:node /data',
    'ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 DATA_DIR=/data CLIENT_DIR=/app/public LOG_DIR=/data/logs',
    'VOLUME ["/data"]',
    'EXPOSE 8787',
    'USER node',
    'HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/healthz >/dev/null || exit 1',
    'CMD ["node", "riverfront-server.cjs"]',
    '',
  ].join('\n'),
  'docker-compose.yml': [
    'services:',
    '  riverfront:',
    '    build: .',
    '    image: riverfront-server:' + version,
    '    restart: unless-stopped',
    '    ports:',
    '      - "8787:8787"',
    '    env_file:',
    '      - path: .env',
    '        required: false',
    '    environment:',
    '      DATA_DIR: /data',
    '      CLIENT_DIR: /app/public',
    '      LOG_DIR: /data/logs',
    '    volumes:',
    '      - dados:/data',
    'volumes:',
    '  dados:',
    '',
  ].join('\n'),
  'LEIA-ME.txt': [
    `Riverfront - servidor dedicado ${version}`,
    '========================================',
    '',
    'Requisitos: Node.js 20 ou mais recente (https://nodejs.org), ou Docker.',
    '',
    'Windows: dê dois cliques em iniciar-servidor.bat',
    'Linux/macOS: ./iniciar-servidor.sh',
    'Docker: docker compose up -d',
    '',
    'Na primeira execução o arquivo .env é criado a partir do .env.example.',
    'Ajuste a porta (PORT) e, se o servidor ficar exposto na internet,',
    'preencha ALLOWED_ORIGINS com o endereço onde o jogo é aberto.',
    '',
    'Com o servidor ligado:',
    '  - o jogo abre no navegador em http://<endereço>:8787/',
    '  - o app de desktop conecta em <endereço>:8787 (botão "Entrar")',
    '  - convites têm o formato http://<endereço>:8787/#sala=K7Q2-PX',
    '',
    'Dados (contas, partidas, denúncias) ficam na pasta "dados"; logs em "logs".',
    'Os endereços IP saem dos logs depois de 7 dias.',
    '',
    'Para expor na internet, use um proxy com HTTPS (Caddy, nginx) na frente',
    'e TRUST_PROXY=true. Detalhes em docs/online.md no código do projeto.',
    '',
    '© 2026 Gustavo Kamchen. Licença PolyForm Noncommercial 1.0.0 (uso sem fins comerciais; veja LICENSE.txt).',
    '',
  ].join('\r\n'),
};
for (const [file, text] of Object.entries(files)) writeFileSync(join(stage, file), text);

// ------------------------------------------------------------ zip (deflate, sem dependências)

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out.sort();
}

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const locals = [];
const centrals = [];
let offset = 0;
const now = dosTime(new Date());
for (const file of walk(stage)) {
  const entryName = `${name}/${relative(stage, file).split(sep).join('/')}`;
  const nameBuf = Buffer.from(entryName, 'utf8');
  const data = readFileSync(file);
  const packed = deflateRawSync(data, { level: 9 });
  const useDeflate = packed.length < data.length;
  const body = useDeflate ? packed : data;
  const crc = crc32(data);
  const executable = entryName.endsWith('.sh') || entryName.endsWith('.cjs');

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
  local.writeUInt16LE(useDeflate ? 8 : 0, 8);
  local.writeUInt16LE(now.time, 10);
  local.writeUInt16LE(now.day, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  locals.push(local, nameBuf, body);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE((3 << 8) | 20, 4); // feito em "Unix", para guardar permissões
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(useDeflate ? 8 : 0, 10);
  central.writeUInt16LE(now.time, 12);
  central.writeUInt16LE(now.day, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(((executable ? 0o100755 : 0o100644) << 16) >>> 0, 38);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);
  offset += local.length + nameBuf.length + body.length;
}
const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(centrals.length / 2, 8);
end.writeUInt16LE(centrals.length / 2, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

const zipPath = join(outRoot, `${name}.zip`);
writeFileSync(zipPath, Buffer.concat([...locals, ...centrals, end]));
console.log(`pacote do servidor: ${relative(root, zipPath)} (${(statSync(zipPath).size / 1024 / 1024).toFixed(1)} MiB, ${centrals.length / 2} arquivos)`);
