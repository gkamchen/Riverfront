import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Logger } from './log.ts';
import { TokenBucket } from './rate.ts';
import type { Connection, Transport, TransportHandlers } from './transport.ts';

export interface HttpRoutes {
  health(): unknown;
  deleteAccount(userId: string, token: string): Promise<boolean>;
  /** Desafio e tabela do dia (`undefined` = hoje); null para dias fora do período guardado. */
  daily(date: string | undefined): Promise<unknown>;
}

export type TrustProxy = boolean | 'cloudflare';

/**
 * IP do cliente. Atrás de proxy, só vale o que o NOSSO proxy acrescentou: o
 * último item do X-Forwarded-For (os anteriores vêm do cliente e podem ser
 * forjados) ou o CF-Connecting-IP no túnel da Cloudflare. Valor que não for
 * um IP válido é ignorado e fica o endereço do socket.
 */
export function clientIp(headers: IncomingMessage['headers'], socketIp: string | undefined, trust: TrustProxy): string {
  const fallback = socketIp ?? '?';
  if (!trust) return fallback;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[v.length - 1] : v);
  const raw = trust === 'cloudflare' ? one(headers['cf-connecting-ip']) : one(headers['x-forwarded-for'])?.split(',').pop();
  const ip = raw?.trim() ?? '';
  return isIP(ip) ? ip : fallback;
}

export interface WsTransportOptions {
  readonly port: number;
  readonly host: string;
  readonly path: string;
  readonly maxPayload: number;
  /** null = qualquer origem. */
  readonly allowedOrigins: readonly string[] | null;
  /** Clientes sem cabeçalho Origin (apps nativos, scripts) são aceitos? */
  readonly allowNoOrigin: boolean;
  readonly maxPerIp: number;
  readonly heartbeatMs: number;
  /** Pasta com o cliente web compilado, servida em `/`. */
  readonly clientDir: string | null;
  /** Atrás de um proxy seu: true lê o último IP do X-Forwarded-For; 'cloudflare' lê o CF-Connecting-IP. */
  readonly trustProxy: TrustProxy;
  readonly logger: Logger;
  readonly routes: HttpRoutes;
  /** Pedidos HTTP por IP: rajada e reposição por segundo. */
  readonly httpRate: { readonly burst: number; readonly perSecond: number };
}

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

/** Política para o cliente servido aqui (igual à do app de desktop, mais frame-ancestors, que só vale em cabeçalho). */
export const CLIENT_CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self' ws: wss: http: https:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}

export class WsTransport implements Transport {
  readonly #o: WsTransportOptions;
  readonly #http: Server;
  readonly #wss: WebSocketServer;
  readonly #perIp = new Map<string, number>();
  /** Limite de pedidos HTTP por IP (API e arquivos). */
  readonly #httpBuckets = new Map<string, TokenBucket>();
  readonly #alive = new WeakMap<WebSocket, boolean>();
  #heartbeat: NodeJS.Timeout | null = null;
  #handlers: TransportHandlers | null = null;
  #port = 0;

  constructor(options: WsTransportOptions) {
    this.#o = options;
    this.#http = createServer((req, res) => void this.#request(req, res));
    this.#wss = new WebSocketServer({ noServer: true, maxPayload: options.maxPayload, perMessageDeflate: false });
    this.#http.on('upgrade', (req, socket, head) => this.#upgrade(req, socket, head));
    // Conexões HTTP penduradas não seguram o processo.
    this.#http.headersTimeout = 10_000;
    this.#http.requestTimeout = 15_000;
  }

  get port(): number {
    return this.#port;
  }

  async start(handlers: TransportHandlers): Promise<void> {
    this.#handlers = handlers;
    await new Promise<void>((resolvePromise, reject) => {
      const onError = (error: Error) => reject(error);
      this.#http.once('error', onError);
      this.#http.listen(this.#o.port, this.#o.host, () => {
        this.#http.off('error', onError);
        resolvePromise();
      });
    });
    const address = this.#http.address();
    this.#port = typeof address === 'object' && address ? address.port : this.#o.port;
    this.#heartbeat = setInterval(() => this.#beat(), this.#o.heartbeatMs);
    this.#heartbeat.unref();
  }

  async stop(): Promise<void> {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    for (const ws of this.#wss.clients) ws.close(1001, 'servidor desligando');
    await new Promise<void>((r) => setTimeout(r, 200));
    for (const ws of this.#wss.clients) ws.terminate();
    await new Promise<void>((r) => this.#wss.close(() => r()));
    await new Promise<void>((r) => {
      this.#http.close(() => r());
      this.#http.closeAllConnections?.();
    });
  }

  #ip(req: IncomingMessage): string {
    return clientIp(req.headers, req.socket.remoteAddress, this.#o.trustProxy);
  }

  #originAllowed(origin: string | undefined): boolean {
    if (!origin) return this.#o.allowNoOrigin;
    if (this.#o.allowedOrigins === null) return true;
    return this.#o.allowedOrigins.includes(origin);
  }

  #upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://x');
    const reject = (status: number, text: string) => {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (url.pathname !== this.#o.path) return reject(404, 'Not Found');
    if (!this.#originAllowed(req.headers.origin)) {
      this.#o.logger.warn('origin.denied', { origin: req.headers.origin ?? null, ip: this.#ip(req) });
      return reject(403, 'Forbidden');
    }
    const ip = this.#ip(req);
    const count = this.#perIp.get(ip) ?? 0;
    if (count >= this.#o.maxPerIp) {
      this.#o.logger.warn('ip.limit', { ip });
      return reject(429, 'Too Many Requests');
    }
    this.#wss.handleUpgrade(req, socket, head, (ws) => this.#accept(ws, ip));
  }

  #accept(ws: WebSocket, ip: string): void {
    const handlers = this.#handlers;
    if (!handlers) {
      ws.terminate();
      return;
    }
    this.#perIp.set(ip, (this.#perIp.get(ip) ?? 0) + 1);
    this.#alive.set(ws, true);
    const conn: Connection = {
      id: randomBytes(8).toString('hex'),
      ip,
      send: (text) => {
        if (ws.readyState === ws.OPEN) ws.send(text);
      },
      close: (code, reason) => {
        if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(code, reason);
        // Se o outro lado não responder ao fechamento, corta de vez.
        setTimeout(() => ws.terminate(), 2_000).unref();
      },
      bufferedAmount: () => ws.bufferedAmount,
    };
    ws.on('pong', () => this.#alive.set(ws, true));
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        conn.close(1003, 'só texto');
        return;
      }
      handlers.message(conn, data.toString());
    });
    ws.on('close', () => {
      const left = (this.#perIp.get(ip) ?? 1) - 1;
      if (left <= 0) this.#perIp.delete(ip);
      else this.#perIp.set(ip, left);
      handlers.close(conn);
    });
    ws.on('error', () => {
      // erros de protocolo (ex.: mensagem acima do maxPayload) fecham o socket; o 'close' cuida do resto
    });
    handlers.open(conn);
  }

  #beat(): void {
    for (const ws of this.#wss.clients) {
      if (this.#alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      this.#alive.set(ws, false);
      ws.ping();
    }
  }

  async #request(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ip = this.#ip(req);
    let bucket = this.#httpBuckets.get(ip);
    if (!bucket) {
      if (this.#httpBuckets.size > 10_000) this.#httpBuckets.clear();
      bucket = new TokenBucket(this.#o.httpRate.burst, this.#o.httpRate.perSecond, Date.now());
      this.#httpBuckets.set(ip, bucket);
    }
    if (!bucket.take(Date.now())) {
      res.setHeader('Retry-After', '1');
      return sendJson(res, 429, { erro: 'muitos pedidos' });
    }
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/healthz') return sendJson(res, 200, this.#o.routes.health());
      if (url.pathname === '/api/account') return await this.#accountRoute(req, res);
      if (url.pathname === '/api/daily' && req.method === 'GET') {
        const date = url.searchParams.get('data') ?? undefined;
        if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendJson(res, 400, { erro: 'data inválida' });
        const day = await this.#o.routes.daily(date);
        return day ? sendJson(res, 200, day) : sendJson(res, 404, { erro: 'dia fora do período' });
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && this.#o.clientDir) return await this.#static(url.pathname, req, res);
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
        res.end('Servidor do Riverfront no ar. Conecte o jogo em ws://<este endereço>/ws\n');
        return;
      }
      sendJson(res, 404, { erro: 'não encontrado' });
    } catch (error) {
      this.#o.logger.error('http.failed', { error: String(error) });
      if (!res.headersSent) sendJson(res, 500, { erro: 'erro interno' });
      else res.destroy();
    }
  }

  async #accountRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'DELETE') {
      res.setHeader('Allow', 'DELETE');
      return sendJson(res, 405, { erro: 'use DELETE' });
    }
    const auth = req.headers.authorization ?? '';
    const match = /^Bearer ([A-Za-z0-9_-]{16,32})\.([A-Za-z0-9_-]{32,64})$/.exec(auth);
    if (!match) return sendJson(res, 401, { erro: 'credenciais ausentes' });
    const ok = await this.#o.routes.deleteAccount(match[1] as string, match[2] as string);
    return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 401, { erro: 'credenciais inválidas' });
  }

  async #static(pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const root = resolve(this.#o.clientDir as string);
    let rel: string;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return sendJson(res, 400, { erro: 'caminho inválido' });
    }
    if (rel.includes('\0')) return sendJson(res, 400, { erro: 'caminho inválido' });
    let file = normalize(join(root, rel));
    if (file !== root && !file.startsWith(root + sep)) return sendJson(res, 403, { erro: 'proibido' });
    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = join(file, 'index.html');
      info = await stat(file).catch(() => null);
    }
    if (!info || !info.isFile()) return sendJson(res, 404, { erro: 'não encontrado' });
    const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const immutable = /[\\/]assets[\\/]/.test(file);
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': info.size,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...(type.startsWith('text/html') ? { 'Content-Security-Policy': CLIENT_CSP } : {}),
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      ...SECURITY_HEADERS,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  }
}
