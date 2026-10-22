import {
  decodeServerMessage,
  encode,
  PROTOCOL_MAX,
  PROTOCOL_MIN,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
} from '@riverfront/protocol';
import { Emitter } from './emitter.ts';
import type { ProfileStorage } from './storage.ts';

/** O que usamos de um WebSocket (o do navegador ou o global do Node 22). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline';

export type NetErrorCode = ErrorCode | 'offline' | 'timeout';

export type NetResult = { readonly ok: true } | { readonly ok: false; readonly code: NetErrorCode; readonly detail: string | null; readonly message: string };

type Outgoing = ClientMessage extends infer M ? (M extends { t: string } ? Omit<M, 'id'> : never) : never;
type Welcome = Extract<ServerMessage, { t: 'welcome' }>;
type ByType = { [M in ServerMessage as M['t']]: M };

export type ConnectionEvents = ByType & {
  status: ConnectionStatus;
  /** Latência medida pelo ping (ms). */
  rtt: number;
  /** A conexão foi encerrada de vez (não vai tentar de novo); o texto explica por quê. */
  fatal: string;
};

export interface ConnectionOptions {
  readonly url: string;
  readonly storage: ProfileStorage;
  readonly clientName?: string;
  readonly clientVersion?: string;
  /** Apelido sugerido quando a conta ainda não existe. */
  readonly name?: string;
  readonly createSocket?: (url: string) => SocketLike;
  readonly pingIntervalMs?: number;
  readonly requestTimeoutMs?: number;
  readonly maxBackoffMs?: number;
}

const OPEN = 1;

const offline = (message: string): NetResult => ({ ok: false, code: 'offline', detail: null, message });

function defaultSocket(url: string): SocketLike {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => SocketLike }).WebSocket;
  if (!Ctor) throw new Error('WebSocket indisponível neste ambiente.');
  return new Ctor(url);
}

/**
 * Conexão com o servidor: faz o hello (com a conta guardada), mede o ping,
 * casa respostas com pedidos e reconecta sozinha com espera crescente.
 * Ao reconectar, o servidor devolve a sala e o estado da partida.
 */
export class Connection extends Emitter<ConnectionEvents> {
  readonly #o: ConnectionOptions;
  #socket: SocketLike | null = null;
  #status: ConnectionStatus = 'idle';
  #nextId = 1;
  #pending = new Map<number, { resolve: (r: NetResult) => void; timer: ReturnType<typeof setTimeout> }>();
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #attempt = 0;
  #wanted = false;
  #rtt: number | null = null;
  #offset = 0;
  #welcome: Welcome | null = null;
  #firstWelcome: { resolve: (w: Welcome) => void; reject: (e: Error) => void } | null = null;

  constructor(options: ConnectionOptions) {
    super();
    this.#o = options;
  }

  get url(): string {
    return this.#o.url;
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  /** Último ping medido (ms), ou null. */
  get rtt(): number | null {
    return this.#rtt;
  }

  get welcome(): Welcome | null {
    return this.#welcome;
  }

  /** Hora do servidor estimada (útil para os prazos do relógio). */
  serverNow(): number {
    return Date.now() + this.#offset;
  }

  /** Conecta e resolve com o primeiro `welcome`. */
  connect(): Promise<Welcome> {
    this.#wanted = true;
    const promise = new Promise<Welcome>((resolve, reject) => {
      this.#firstWelcome = { resolve, reject };
    });
    this.#open();
    return promise;
  }

  close(): void {
    this.#wanted = false;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#stopPing();
    const socket = this.#socket;
    this.#socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close(1000, 'saindo');
    }
    this.#failPending('Desconectado.');
    this.#setStatus('offline');
  }

  send(msg: Outgoing): boolean {
    const socket = this.#socket;
    if (!socket || socket.readyState !== OPEN || this.#status !== 'online') return false;
    socket.send(encode(msg as ClientMessage));
    return true;
  }

  /** Envia e espera `ok`/`error`. Nunca rejeita: falhas viram `{ ok: false }`. */
  request(msg: Outgoing): Promise<NetResult> {
    const socket = this.#socket;
    if (!socket || socket.readyState !== OPEN || this.#status !== 'online') return Promise.resolve(offline('Sem conexão com o servidor.'));
    const id = this.#nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        resolve({ ok: false, code: 'timeout', detail: null, message: 'O servidor demorou para responder.' });
      }, this.#o.requestTimeoutMs ?? 10_000);
      this.#pending.set(id, { resolve, timer });
      socket.send(encode({ ...msg, id } as ClientMessage));
    });
  }

  #setStatus(status: ConnectionStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.emit('status', status);
  }

  #open(): void {
    if (!this.#wanted) return;
    this.#setStatus(this.#attempt === 0 ? 'connecting' : 'reconnecting');
    let socket: SocketLike;
    try {
      socket = (this.#o.createSocket ?? defaultSocket)(this.#o.url);
    } catch (error) {
      this.#fatal(`Endereço inválido: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    this.#socket = socket;
    socket.onopen = () => {
      // Só a credencial emitida por este mesmo servidor (host e porta).
      const auth = this.#o.storage.authFor(this.#o.url);
      socket.send(
        encode({
          t: 'hello',
          protocol: { min: PROTOCOL_MIN, max: PROTOCOL_MAX },
          client: { name: this.#o.clientName ?? 'riverfront-web', version: this.#o.clientVersion ?? '0' },
          ...(auth ? { auth } : {}),
          ...(this.#o.name ? { name: this.#o.name } : {}),
        }),
      );
    };
    socket.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      const msg = decodeServerMessage(ev.data);
      if (msg) this.#receive(msg);
    };
    socket.onerror = () => {
      // o onclose vem logo depois e decide o que fazer
    };
    socket.onclose = (ev) => this.#closed(ev.code);
  }

  #receive(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome': {
        this.#welcome = msg;
        this.#attempt = 0;
        this.#offset = msg.serverTime - Date.now();
        if (msg.token) this.#o.storage.setAuthFor(this.#o.url, { userId: msg.userId, token: msg.token });
        this.#o.storage.profile = msg.profile;
        this.#setStatus('online');
        this.#startPing();
        this.#firstWelcome?.resolve(msg);
        this.#firstWelcome = null;
        break;
      }
      case 'ok':
      case 'error': {
        const ref = msg.ref;
        const pending = ref === null ? undefined : this.#pending.get(ref);
        if (pending && ref !== null) {
          clearTimeout(pending.timer);
          this.#pending.delete(ref);
          pending.resolve(msg.t === 'ok' ? { ok: true } : { ok: false, code: msg.code, detail: msg.detail, message: msg.message });
        }
        if (msg.t === 'error' && msg.code === 'protocol-mismatch') this.#fatal(msg.message);
        break;
      }
      case 'pong': {
        const rtt = Date.now() - msg.ts;
        this.#rtt = this.#rtt === null ? rtt : Math.round(this.#rtt * 0.7 + rtt * 0.3);
        this.#offset = msg.serverTime + rtt / 2 - Date.now();
        this.emit('rtt', this.#rtt);
        break;
      }
      case 'profile':
        this.#o.storage.profile = msg.profile;
        break;
      case 'account.deleted':
        this.#o.storage.forget(this.#o.url);
        break;
      case 'server.shutdown':
        // o servidor vai reiniciar: tenta de novo depois do tempo sugerido
        this.#attempt = Math.max(this.#attempt, 1);
        break;
      default:
        break;
    }
    this.emit(msg.t, msg as never);
  }

  #closed(code: number): void {
    this.#socket = null;
    this.#stopPing();
    this.#failPending('Conexão perdida.');
    if (code === 4001) return this.#fatal('Sua conta foi conectada em outra janela ou aparelho.');
    if (code === 4003) return this.#fatal('Versão do jogo incompatível com o servidor.');
    if (code === 4004) return this.#fatal('Conta excluída.');
    if (code === 1008) return this.#fatal('Conexão encerrada pelo servidor por excesso de mensagens.');
    if (!this.#wanted) {
      this.#setStatus('offline');
      return;
    }
    if (this.#firstWelcome && this.#attempt >= 3) {
      // nunca chegou a conectar: avisa quem chamou connect(), mas continua tentando
      this.#firstWelcome.reject(new Error('Não foi possível conectar ao servidor.'));
      this.#firstWelcome = null;
    }
    this.#attempt++;
    const base = Math.min(this.#o.maxBackoffMs ?? 15_000, 500 * 2 ** Math.min(this.#attempt - 1, 6));
    const delay = base / 2 + Math.random() * (base / 2);
    this.#setStatus('reconnecting');
    this.#retryTimer = setTimeout(() => this.#open(), delay);
  }

  #fatal(reason: string): void {
    this.#wanted = false;
    this.#stopPing();
    this.#failPending(reason);
    this.#firstWelcome?.reject(new Error(reason));
    this.#firstWelcome = null;
    this.#setStatus('offline');
    this.emit('fatal', reason);
  }

  #failPending(reason: string): void {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.resolve(offline(reason));
      this.#pending.delete(id);
    }
  }

  #startPing(): void {
    this.#stopPing();
    const ping = () => this.send({ t: 'ping', ts: Date.now() });
    ping();
    this.#pingTimer = setInterval(ping, this.#o.pingIntervalMs ?? 5_000);
  }

  #stopPing(): void {
    if (this.#pingTimer) clearInterval(this.#pingTimer);
    this.#pingTimer = null;
  }
}
