// Hospeda uma partida pela internet a partir deste PC, sem abrir porta no roteador.
//
//   npm run host:tunnel                  Cloudflare Tunnel rápido (cloudflared)
//   npm run host:tunnel -- --tailscale   Tailscale Funnel
//   opções: --porta 8787  --com-app (aceita também o app de desktop)  --teste (não abre túnel; usa um endereço fictício)
//
// O script só confere se a ferramenta está instalada: não instala nada nem cria
// contas. Detalhes em docs/hospedagem.md.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const PAGES_ORIGIN = 'https://gkamchen.github.io';
const PAGES_URL = `${PAGES_ORIGIN}/Riverfront/`;
const port = Number(option('--porta', process.env.PORT ?? '8787'));
const mode = flag('--tailscale') ? 'tailscale' : 'cloudflare';
const dryRun = flag('--teste');

const bundle = join(root, 'packages', 'server', 'dist', 'riverfront-server.cjs');
if (!existsSync(bundle)) {
  console.error('Servidor não compilado. Rode "npm run build" antes.');
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('Porta inválida (use entre 1024 e 65535).');
  process.exit(1);
}

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children.reverse()) if (child.exitCode === null) child.kill('SIGINT');
  if (mode === 'tailscale' && !dryRun) spawnSync('tailscale', ['funnel', '--https=443', 'off'], { stdio: 'ignore' });
  setTimeout(() => process.exit(code), 1500).unref();
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

function installed(command, versionArgs) {
  const r = spawnSync(command, versionArgs, { encoding: 'utf8', shell: process.platform === 'win32' });
  return r.status === 0;
}

function startServer(publicOrigin) {
  const origins = [PAGES_ORIGIN, publicOrigin];
  if (flag('--com-app')) origins.push('riverfront://app');
  const clientDir = join(root, 'packages', 'client', 'dist');
  const env = {
    ...process.env,
    PORT: String(port),
    // O túnel conecta pela própria máquina: nada fica exposto direto na rede.
    HOST: '127.0.0.1',
    ALLOWED_ORIGINS: origins.join(','),
    ALLOW_NO_ORIGIN: 'false',
    // cloudflared manda o IP do visitante em CF-Connecting-IP; o Funnel acrescenta no fim do X-Forwarded-For
    TRUST_PROXY: mode === 'cloudflare' && !dryRun ? 'cloudflare' : 'true',
    DATA_DIR: process.env.DATA_DIR ?? join(root, 'packages', 'server', 'dados'),
    ...(existsSync(join(clientDir, 'index.html')) ? { CLIENT_DIR: clientDir } : {}),
  };
  const server = spawn(process.execPath, [bundle], { env, stdio: ['ignore', 'ignore', 'inherit'] });
  children.push(server);
  server.on('exit', (code) => {
    if (!stopping) {
      console.error(`O servidor parou (código ${code}).`);
      stop(1);
    }
  });
  return origins;
}

function printLinks(publicUrl, origins) {
  const wss = `${publicUrl.replace(/^https:/, 'wss:').replace(/\/$/, '')}/ws`;
  const lines = [
    '',
    'Servidor no ar pela internet.',
    `  Endereço do servidor: ${wss}`,
    `  Origens aceitas: ${origins.join(', ')}`,
    '',
    'Abra o jogo com este link, crie a sala e use "Copiar link" para chamar os amigos:',
    `  ${PAGES_URL}#servidor=${wss}`,
    '',
    'O link de convite sai neste formato:',
    `  ${PAGES_URL}#sala=XXXX-XX&servidor=${wss}`,
    '',
    'Ctrl+C encerra o servidor e o túnel.',
  ];
  console.log(lines.join('\n'));
}

async function cloudflare() {
  if (!installed('cloudflared', ['--version'])) {
    console.error(
      [
        'cloudflared não encontrado.',
        'Instale pelo site da Cloudflare (Downloads do "cloudflared") e rode de novo.',
        'O túnel rápido não precisa de conta. Veja docs/hospedagem.md.',
      ].join('\n'),
    );
    process.exit(1);
  }
  console.log('Abrindo o túnel da Cloudflare...');
  const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], {
    // sem shell: assim o Ctrl+C encerra o próprio cloudflared, não só um cmd intermediário
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(tunnel);
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('o túnel não informou o endereço em 60 s')), 60_000);
    const scan = (chunk) => {
      const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(chunk));
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    };
    tunnel.stdout.on('data', scan);
    tunnel.stderr.on('data', scan);
    tunnel.on('exit', (code) => reject(new Error(`cloudflared saiu (código ${code})`)));
  });
  printLinks(url, startServer(url));
}

async function tailscale() {
  if (!installed('tailscale', ['version'])) {
    console.error(['tailscale não encontrado.', 'Instale o Tailscale, entre na sua conta e ative o Funnel (veja docs/hospedagem.md).'].join('\n'));
    process.exit(1);
  }
  const status = spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' });
  let dns = '';
  try {
    dns = String(JSON.parse(status.stdout).Self?.DNSName ?? '').replace(/\.$/, '');
  } catch {
    // trata abaixo
  }
  if (status.status !== 0 || !dns) {
    console.error('O Tailscale não está conectado. Entre na sua conta (tailscale up) e tente de novo.');
    process.exit(1);
  }
  const url = `https://${dns}`;
  const origins = startServer(url);
  const funnel = spawn('tailscale', ['funnel', String(port)], { stdio: ['ignore', 'inherit', 'inherit'] });
  children.push(funnel);
  funnel.on('exit', (code) => {
    if (!stopping) {
      console.error(`O Funnel parou (código ${code}). Ele precisa estar liberado na sua conta do Tailscale.`);
      stop(1);
    }
  });
  printLinks(url, origins);
}

async function main() {
  if (dryRun) {
    const url = 'https://exemplo-de-teste.trycloudflare.com';
    printLinks(url, startServer(url));
    return;
  }
  if (mode === 'tailscale') await tailscale();
  else await cloudflare();
}

main().catch((error) => {
  console.error(`Não deu para hospedar: ${error instanceof Error ? error.message : String(error)}`);
  stop(1);
});
