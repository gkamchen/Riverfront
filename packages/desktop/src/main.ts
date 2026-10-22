import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, session, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron';
import { existsSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { localAddresses, startServer, type RunningServer } from '@riverfront/server';

const SCHEME = 'riverfront';
const CLIENT_ORIGIN = `${SCHEME}://app`;
const LAUNCHER_ORIGIN = `${SCHEME}://inicio`;
const DEFAULT_PORT = 8787;

// Página do jogo: Three.js precisa de WebGL, blobs e (em alguns módulos) wasm; nada de scripts externos.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' ws: wss: http: https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
]);

const root = join(__dirname);
const folders: Readonly<Record<string, string>> = {
  app: join(root, 'client'),
  inicio: join(root, 'launcher'),
};

let mainWindow: BrowserWindow | null = null;
let hosted: RunningServer | null = null;
let hostedStarting: Promise<RunningServer> | null = null;

// ------------------------------------------------------------ servidor embutido

interface HostStatus {
  readonly running: boolean;
  readonly port: number | null;
  readonly addresses: readonly string[];
  readonly players: number;
  readonly rooms: number;
}

function hostStatus(): HostStatus {
  if (!hosted) return { running: false, port: null, addresses: localAddresses(), players: 0, rooms: 0 };
  const stats = hosted.stats();
  return { running: true, port: hosted.port, addresses: localAddresses(), players: stats.players, rooms: stats.rooms };
}

/** Porta livre escolhida pelo sistema (para saber a porta antes de montar a lista de origens). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Quem pode abrir o WebSocket do servidor embutido: a página do próprio app e o
 * jogo servido por ele no navegador (localhost e os IPs desta máquina na rede).
 */
export function hostOrigins(port: number, addresses: readonly string[]): string[] {
  return ['riverfront://app', `http://127.0.0.1:${port}`, `http://localhost:${port}`, ...addresses.map((ip) => `http://${ip}:${port}`)];
}

async function startHost(requested: number): Promise<HostStatus> {
  if (hosted) return hostStatus();
  const port = requested === 0 ? await freePort() : requested;
  if (!hostedStarting) {
    hostedStarting = startServer({
      port,
      host: '0.0.0.0',
      allowedOrigins: hostOrigins(port, localAddresses()),
      allowNoOrigin: false,
      dataDir: join(app.getPath('userData'), 'servidor'),
      logDir: join(app.getPath('userData'), 'logs'),
      clientDir: folders.app as string,
      quiet: true,
      // Na rede de casa, várias abas do mesmo computador são comuns.
      maxConnectionsPerIp: 32,
    });
  }
  try {
    hosted = await hostedStarting;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') throw new Error(`A porta ${port} já está em uso. Escolha outra.`);
    if (code === 'EACCES') throw new Error(`Sem permissão para usar a porta ${port}.`);
    throw new Error(`Não foi possível iniciar o servidor: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    hostedStarting = null;
  }
  rebuildMenu();
  return hostStatus();
}

async function stopHost(): Promise<HostStatus> {
  const server = hosted;
  hosted = null;
  if (server) await server.close();
  rebuildMenu();
  return hostStatus();
}

// ------------------------------------------------------------ janelas

interface ClientTarget {
  readonly server?: string;
  readonly room?: string;
}

function clientUrl(target: ClientTarget = {}): string {
  const url = new URL(`${CLIENT_ORIGIN}/index.html`);
  if (target.server) url.searchParams.set('servidor', target.server);
  if (target.room) url.hash = `sala=${target.room}`;
  return url.toString();
}

function openClient(target: ClientTarget = {}): void {
  void mainWindow?.loadURL(clientUrl(target));
}

function openLauncher(mode?: 'hospedar' | 'entrar'): void {
  void mainWindow?.loadURL(`${LAUNCHER_ORIGIN}/index.html${mode ? `#${mode}` : ''}`);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Riverfront',
    backgroundColor: '#1b140d',
    show: false,
    webPreferences: {
      preload: join(root, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const contents = mainWindow.webContents;
  // Só navega dentro do próprio app; links externos abrem no navegador.
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://`)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  openLauncher();
}

function fromApp(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return url.startsWith(`${SCHEME}://`);
}

// ------------------------------------------------------------ menu

function rebuildMenu(): void {
  const running = hosted !== null;
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Jogo',
      submenu: [
        { label: 'Início', accelerator: 'CmdOrCtrl+Shift+H', click: () => openLauncher() },
        { label: 'Jogar', accelerator: 'CmdOrCtrl+J', click: () => openClient() },
        { type: 'separator' },
        { label: 'Hospedar partida…', enabled: !running, click: () => openLauncher('hospedar') },
        {
          label: running ? `Servidor ligado (porta ${hosted?.port})` : 'Servidor desligado',
          enabled: false,
        },
        { label: 'Parar servidor', enabled: running, click: () => void stopHost() },
        { label: 'Entrar em servidor…', click: () => openLauncher('entrar') },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        { role: 'togglefullscreen', label: 'Tela cheia' },
        { role: 'resetZoom', label: 'Tamanho normal' },
        { role: 'zoomIn', label: 'Aumentar' },
        { role: 'zoomOut', label: 'Diminuir' },
        ...(app.isPackaged ? [] : ([{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])),
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        { label: 'Abrir pasta de dados', click: () => void shell.openPath(app.getPath('userData')) },
        {
          label: 'Sobre o Riverfront',
          click: () =>
            void dialog.showMessageBox({
              type: 'info',
              title: 'Riverfront',
              message: `Riverfront ${app.getVersion()}`,
              detail: '© 2026 Gustavo Kamchen. Licença PolyForm Noncommercial 1.0.0: uso livre sem fins comerciais.',
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------ protocolo riverfront://

function serveFile(request: Request): Promise<Response> | Response {
  const url = new URL(request.url);
  const base = folders[url.hostname];
  if (!base) return new Response('não encontrado', { status: 404 });
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return new Response('caminho inválido', { status: 400 });
  }
  if (path === '/' || path === '') path = '/index.html';
  const file = normalize(join(base, path));
  if (!file.startsWith(base + sep) || !existsSync(file)) return new Response('não encontrado', { status: 404 });
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  return net.fetch(pathToFileURL(file).toString()).then(
    (res) =>
      new Response(res.body, {
        status: res.status,
        headers: {
          'Content-Type': MIME[ext] ?? 'application/octet-stream',
          'Content-Security-Policy': CSP,
          'X-Content-Type-Options': 'nosniff',
        },
      }),
  );
}

// ------------------------------------------------------------ IPC

function registerIpc(): void {
  ipcMain.handle('host:start', async (event, port: unknown) => {
    if (!fromApp(event)) throw new Error('origem recusada');
    const p = typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT;
    return startHost(p);
  });
  ipcMain.handle('host:stop', async (event) => {
    if (!fromApp(event)) throw new Error('origem recusada');
    return stopHost();
  });
  ipcMain.handle('host:status', (event) => {
    if (!fromApp(event)) throw new Error('origem recusada');
    return hostStatus();
  });
  ipcMain.handle('app:open-client', (event, target: unknown) => {
    if (!fromApp(event)) throw new Error('origem recusada');
    const t = (typeof target === 'object' && target !== null ? target : {}) as Record<string, unknown>;
    const server = typeof t.server === 'string' && t.server.length <= 200 && /^wss?:\/\/[^\s]+$/.test(t.server) ? t.server : undefined;
    const room = typeof t.room === 'string' && /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{2}$/.test(t.room) ? t.room : undefined;
    openClient({ ...(server ? { server } : {}), ...(room ? { room } : {}) });
  });
  ipcMain.handle('app:open-launcher', (event) => {
    if (!fromApp(event)) throw new Error('origem recusada');
    openLauncher();
  });
  ipcMain.handle('clipboard:write', (event, text: unknown) => {
    if (!fromApp(event) || typeof text !== 'string' || text.length > 2_000) return false;
    clipboard.writeText(text);
    return true;
  });
}

// ------------------------------------------------------------ ciclo de vida

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle(SCHEME, serveFile);
    // Nenhuma permissão do navegador é necessária (câmera, microfone, notificações...).
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
    registerIpc();
    rebuildMenu();
    createWindow();
    if (process.argv.includes('--smoke-test')) runSmokeTest();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting || !hosted) return;
    event.preventDefault();
    quitting = true;
    void stopHost().finally(() => app.quit());
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault());
  });
}

/**
 * `--smoke-test`: abre a tela inicial e o jogo, liga e desliga o servidor
 * embutido e fecha. Usado para conferir um pacote recém-gerado sem clicar.
 */
/** Status HTTP de um pedido de upgrade WebSocket com a origem dada (101 = aceito). */
function upgradeStatus(port: number, origin: string | null): Promise<number> {
  return new Promise((resolve) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      path: '/ws',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        ...(origin ? { Origin: origin } : {}),
      },
    });
    req.on('upgrade', (_res, socket) => {
      socket.destroy();
      resolve(101);
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', () => resolve(0));
    req.end();
  });
}

function runSmokeTest(): void {
  const log = (text: string) => process.stdout.write(`[smoke] ${text}\n`);
  const fail = (text: string) => {
    log(`FALHOU: ${text}`);
    app.exit(1);
  };
  setTimeout(() => fail('tempo esgotado'), 60_000).unref();
  void (async () => {
    const win = mainWindow;
    if (!win) return fail('sem janela');
    await new Promise((r) => win.webContents.once('did-finish-load', () => r(null)));
    const title = await win.webContents.executeJavaScript('document.title');
    log(`tela inicial: ${title}`);
    const bridge = await win.webContents.executeJavaScript('typeof window.riverfront === "object" && typeof require === "undefined"');
    if (!bridge) return fail('ponte do preload ausente ou node exposto');
    const status = await startHost(0);
    log(`servidor embutido na porta ${status.port}; endereços: ${status.addresses.join(', ') || 'nenhum'}`);
    const health = await net.fetch(`http://127.0.0.1:${status.port}/healthz`).then((r) => r.json());
    log(`healthz: ${JSON.stringify(health)}`);
    openClient({ server: `ws://127.0.0.1:${status.port}/ws` });
    await new Promise((r) => win.webContents.once('did-finish-load', () => r(null)));
    await new Promise((r) => setTimeout(r, 1500));
    const canvas = await win.webContents.executeJavaScript('!!document.querySelector("canvas")');
    log(`cliente carregado (canvas: ${canvas})`);
    // A página do jogo consegue falar com o servidor embutido (CSP e origem liberadas)?
    const hello = await win.webContents.executeJavaScript(`new Promise((resolve) => {
      const ws = new WebSocket('ws://127.0.0.1:${status.port}/ws');
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', protocol: { min: 1, max: 1 }, client: { name: 'smoke', version: '0' } }));
      ws.onmessage = (e) => { resolve(JSON.parse(e.data).t + ' via ' + location.origin); ws.close(); };
      ws.onerror = () => resolve('erro');
      setTimeout(() => resolve('sem resposta'), 5000);
    })`);
    log(`websocket do cliente: ${hello}`);
    if (!String(hello).startsWith('welcome')) return fail('cliente não conectou no servidor embutido');
    // Origem desconhecida ou ausente é recusada (403) no servidor embutido.
    for (const origin of [null, 'https://malvado.exemplo']) {
      const code = await upgradeStatus(status.port as number, origin);
      log(`websocket com origem ${origin ?? '(nenhuma)'}: ${code}`);
      if (code !== 403) return fail(`origem ${origin ?? '(nenhuma)'} deveria ser recusada`);
    }
    const lan = status.addresses[0];
    if (lan) {
      const code = await upgradeStatus(status.port as number, `http://${lan}:${status.port}`);
      log(`websocket com origem da rede local: ${code}`);
      if (code !== 101) return fail('origem da rede local deveria ser aceita');
    }
    await stopHost();
    log('ok');
    app.exit(0);
  })().catch((error: unknown) => fail(String(error)));
}
