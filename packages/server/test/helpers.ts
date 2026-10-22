import WebSocket from 'ws';
import { unpackView, type ClientMessage, type GameMode, type ServerMessage } from '@riverfront/protocol';
import type { HistoryEntry, PlayerView } from '@riverfront/core';
import { silentLogger, startServer, type RunningServer, type ServerOptions } from '../src/index.ts';

type Outgoing = ClientMessage extends infer M ? (M extends { t: string } ? Omit<M, 'id'> : never) : never;

export async function testServer(options: ServerOptions = {}): Promise<RunningServer> {
  return startServer({ port: 0, host: '127.0.0.1', logger: silentLogger, tickMs: 20, ...options });
}

/** Cliente de teste: guarda tudo o que recebe e reconstrói a visão da partida. */
export class TestClient {
  readonly ws: WebSocket;
  readonly received: ServerMessage[] = [];
  readonly raw: string[] = [];
  view: PlayerView | null = null;
  userId = '';
  token = '';
  closeCode: number | null = null;
  #nextId = 1;
  #waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  #history: readonly HistoryEntry[] = [];
  readonly opened: Promise<void>;
  readonly closed: Promise<number>;

  constructor(url: string, headers: Record<string, string> = {}) {
    this.ws = new WebSocket(url, { headers });
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
      this.ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
    this.closed = new Promise((resolve) => {
      this.ws.on('close', (code) => {
        this.closeCode = code;
        resolve(code);
      });
    });
    this.ws.on('error', () => {});
    this.ws.on('message', (data) => {
      const text = data.toString();
      this.raw.push(text);
      const msg = JSON.parse(text) as ServerMessage;
      if (msg.t === 'match.state' || msg.t === 'match.event') {
        const view = unpackView(msg.view, msg.t === 'match.state' ? [] : this.#history);
        this.#history = view.history;
        this.view = view;
      }
      if (msg.t === 'welcome') {
        this.userId = msg.userId;
        if (msg.token) this.token = msg.token;
      }
      this.received.push(msg);
      for (const w of [...this.#waiters]) {
        if (w.pred(msg)) {
          this.#waiters.splice(this.#waiters.indexOf(w), 1);
          w.resolve(msg);
        }
      }
    });
  }

  static async connect(server: RunningServer, opts: { auth?: { userId: string; token: string }; name?: string } = {}): Promise<TestClient> {
    const client = new TestClient(server.url);
    await client.opened;
    await client.hello(opts);
    // como o cliente de verdade: pede a lista de amigos logo ao entrar (isso grava a conta nova)
    await client.ok({ t: 'friends.list' });
    return client;
  }

  async hello(opts: { auth?: { userId: string; token: string }; name?: string } = {}): Promise<Extract<ServerMessage, { t: 'welcome' }>> {
    const welcome = this.waitFor((m) => m.t === 'welcome');
    this.send({ t: 'hello', protocol: { min: 1, max: 1 }, client: { name: 'teste', version: '0' }, ...opts } as Outgoing);
    return (await welcome) as Extract<ServerMessage, { t: 'welcome' }>;
  }

  send(msg: Outgoing, id?: number): void {
    this.ws.send(JSON.stringify(id === undefined ? msg : { ...msg, id }));
  }

  sendRaw(text: string): void {
    this.ws.send(text);
  }

  /** Envia e espera `ok` ou `error` com o mesmo id. */
  async request(msg: Outgoing): Promise<Extract<ServerMessage, { t: 'ok' | 'error' }>> {
    const id = this.#nextId++;
    const reply = this.waitFor((m) => (m.t === 'ok' || m.t === 'error') && m.ref === id);
    this.send(msg, id);
    return (await reply) as Extract<ServerMessage, { t: 'ok' | 'error' }>;
  }

  async ok(msg: Outgoing): Promise<void> {
    const reply = await this.request(msg);
    if (reply.t === 'error') throw new Error(`${msg.t}: ${reply.code} ${reply.detail ?? ''}`);
  }

  waitFor<T extends ServerMessage = ServerMessage>(pred: (m: ServerMessage) => boolean, timeoutMs = 5_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
        reject(new Error(`tempo esgotado esperando mensagem (últimas: ${this.received.slice(-3).map((m) => m.t).join(', ')})`));
      }, timeoutMs);
      const waiter = {
        pred,
        resolve: (m: ServerMessage) => {
          clearTimeout(timer);
          resolve(m as T);
        },
      };
      this.#waiters.push(waiter);
    });
  }

  /** Procura primeiro no que já chegou, depois espera. */
  async seen<T extends ServerMessage = ServerMessage>(pred: (m: ServerMessage) => boolean, timeoutMs = 5_000): Promise<T> {
    const found = this.received.find(pred);
    return found ? (found as T) : this.waitFor<T>(pred, timeoutMs);
  }

  close(): Promise<number> {
    this.ws.close();
    return this.closed;
  }
}

export function isEvent(kind: string) {
  return (m: ServerMessage) => m.t === 'match.event' && m.event.kind === kind;
}

/** Dois jogadores numa sala, prontos, com layout automático confirmado. */
export async function startedPair(
  server: RunningServer,
  opts: { clock?: 'relampago' | 'padrao' | 'tranquilo' | 'unlimited'; mode?: GameMode } = {},
): Promise<{ a: TestClient; b: TestClient; code: string }> {
  const a = await TestClient.connect(server, { name: 'Alice' });
  const b = await TestClient.connect(server, { name: 'Bruno' });
  const code = await createRoom(a, opts);
  await b.ok({ t: 'room.join', code });
  await a.ok({ t: 'ready', ready: true });
  const placingA = a.seen((m) => m.t === 'match.state');
  await b.ok({ t: 'ready', ready: true });
  await placingA;
  const started = Promise.all([a.waitFor(isEvent('start')), b.waitFor(isEvent('start'))]);
  for (const c of [a, b]) {
    await c.ok({ t: 'placement.auto' });
    await c.ok({ t: 'placement.submit', placements: [], confirm: true });
  }
  await started;
  return { a, b, code };
}

export async function createRoom(client: TestClient, opts: { clock?: 'relampago' | 'padrao' | 'tranquilo' | 'unlimited'; mode?: GameMode } = {}): Promise<string> {
  const room = client.waitFor<Extract<ServerMessage, { t: 'room' }>>((m) => m.t === 'room');
  await client.ok({ t: 'room.create', clock: opts.clock ?? 'unlimited', mode: opts.mode ?? 'classic' });
  return (await room).room.code;
}

const events = (c: TestClient) => c.received.filter((m) => m.t === 'match.event').length;

/** Espera os dois clientes receberem pelo menos um evento novo. */
export async function settle(a: TestClient, b: TestClient, before: [number, number]): Promise<void> {
  for (const [c, n] of [[a, before[0]], [b, before[1]]] as const) {
    if (events(c) <= n) await c.waitFor((m) => m.t === 'match.event');
  }
}

export async function shoot(a: TestClient, b: TestClient, shooter: TestClient, target: { col: number; row: number }): Promise<void> {
  const before: [number, number] = [events(a), events(b)];
  await shooter.ok({ t: 'attack', target });
  await settle(a, b, before);
}

/** Joga até o fim: quem está na vez atira na primeira célula ainda desconhecida. */
export async function playToEnd(a: TestClient, b: TestClient, maxActions = 2_000): Promise<void> {
  for (let i = 0; i < maxActions; i++) {
    const view = a.view as PlayerView;
    if (view.phase === 'finished') return;
    const shooter = view.turn === view.player ? a : b;
    const target = (shooter.view as PlayerView).enemy.cells.find((c) => c.state === 'hidden' || c.state === 'spotted');
    if (!target) throw new Error('sem alvo');
    await shoot(a, b, shooter, { col: target.col, row: target.row });
  }
  throw new Error('partida não terminou');
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
