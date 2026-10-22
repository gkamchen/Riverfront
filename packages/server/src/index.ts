import { networkInterfaces } from 'node:os';
import type { ClockConfig, ClockPresetId } from '@riverfront/core';
import { MAX_CLIENT_MESSAGE_BYTES, MAX_LOG_MESSAGE_BYTES, PLACEMENT_MS, PROTOCOL_MAX, PROTOCOL_MIN, ROOM_EXPIRY_MS } from '@riverfront/protocol';
import { GameServer, type ServerStats } from './game-server.ts';
import { createLogger, type Logger, type LogLevel } from './log.ts';
import { FileStore } from './store/file.ts';
import { MemoryStore } from './store/memory.ts';
import type { Store } from './store/types.ts';
import type { Transport } from './transport.ts';
import { WsTransport, type TrustProxy } from './ws-transport.ts';

// Substituído pelo esbuild na hora de empacotar (veja build.mjs).
declare const __RIVERFRONT_VERSION__: string | undefined;
export const SERVER_VERSION: string = typeof __RIVERFRONT_VERSION__ === 'string' ? __RIVERFRONT_VERSION__ : 'dev';

export interface ServerOptions {
  /** 0 escolhe uma porta livre. Padrão 8787. */
  port?: number;
  /** Padrão 0.0.0.0 (todas as interfaces). Use 127.0.0.1 para só esta máquina. */
  host?: string;
  /** Caminho do WebSocket. Padrão /ws. */
  path?: string;
  store?: Store;
  /** Pasta do armazenamento em arquivo. null ou ausente (sem `store`) = só memória. */
  dataDir?: string | null;
  logger?: Logger;
  logDir?: string | null;
  logLevel?: LogLevel;
  quiet?: boolean;
  /** null = qualquer origem. */
  allowedOrigins?: readonly string[] | null;
  allowNoOrigin?: boolean;
  clientDir?: string | null;
  /** false (padrão), true (último IP do X-Forwarded-For) ou 'cloudflare' (CF-Connecting-IP). */
  trustProxy?: TrustProxy;
  maxConnections?: number;
  maxConnectionsPerIp?: number;
  maxMessageBytes?: number;
  heartbeatMs?: number;
  helloTimeoutMs?: number;
  tickMs?: number;
  rate?: { burst: number; perSecond: number };
  roomExpiryMs?: number;
  placementMs?: Partial<Record<ClockPresetId, number | null>>;
  /** Substitui a configuração de relógio de um preset (testes, eventos). */
  clocks?: Partial<Record<ClockPresetId, ClockConfig>>;
  lobbyGraceMs?: number;
  finishedRoomTtlMs?: number;
  now?: () => number;
  /** Semente fixa para as partidas (testes). Nunca use em produção. */
  matchSeed?: () => number;
  /** Pedidos HTTP por IP (API e arquivos estáticos). Padrão 60 de rajada, 20 por segundo. */
  httpRate?: { burst: number; perSecond: number };
  /** Contas novas por IP e por hora (padrão 20). */
  accountsPerIpPerHour?: number;
  /** Teto de contas guardadas (padrão 200 mil). */
  maxAccounts?: number;
  /** Dias sem acesso até a conta expirar (padrão 365). */
  accountInactiveDays?: number;
  /** Dias que denúncias (padrão 90) e partidas encerradas (padrão 90) ficam guardadas. */
  reportRetentionDays?: number;
  matchRetentionDays?: number;
  /** Dias que os arquivos de log ficam no disco (padrão 30). */
  logRetentionDays?: number;
  /** Outro transporte no lugar do WebSocket padrão. */
  transport?: Transport;
}

export interface RunningServer {
  readonly port: number;
  /** URL do WebSocket na própria máquina (ws://127.0.0.1:porta/ws). */
  readonly url: string;
  readonly game: GameServer;
  readonly store: Store;
  stats(): ServerStats;
  close(): Promise<void>;
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const logger = options.logger ?? createLogger({ level: options.logLevel ?? 'info', dir: options.logDir ?? null, quiet: options.quiet ?? false, fileRetentionDays: options.logRetentionDays ?? 30 });
  const store = options.store ?? (options.dataDir ? new FileStore(options.dataDir) : new MemoryStore());
  await store.init();
  const maxMessageBytes = options.maxMessageBytes ?? MAX_CLIENT_MESSAGE_BYTES;
  const path = options.path ?? '/ws';

  const game = new GameServer({
    store,
    logger,
    now: options.now ?? Date.now,
    version: SERVER_VERSION,
    maxMessageBytes,
    maxSessions: options.maxConnections ?? 2_000,
    helloTimeoutMs: options.helloTimeoutMs ?? 10_000,
    tickMs: options.tickMs ?? 200,
    rate: options.rate ?? { burst: 30, perSecond: 12 },
    accounts: {
      perIpPerHour: options.accountsPerIpPerHour ?? 20,
      max: options.maxAccounts ?? 200_000,
      inactiveDays: options.accountInactiveDays ?? 365,
    },
    retention: { reportsDays: options.reportRetentionDays ?? 90, matchesDays: options.matchRetentionDays ?? 90 },
    room: {
      expiryMs: options.roomExpiryMs ?? ROOM_EXPIRY_MS,
      placementMs: { ...PLACEMENT_MS, ...options.placementMs },
      clocks: options.clocks ?? {},
      lobbyGraceMs: options.lobbyGraceMs ?? 45_000,
      finishedTtlMs: options.finishedRoomTtlMs ?? 5 * 60_000,
      ...(options.matchSeed ? { seed: options.matchSeed } : {}),
    },
  });

  const ws =
    options.transport ??
    new WsTransport({
      port: options.port ?? 8787,
      host: options.host ?? '0.0.0.0',
      path,
      maxPayload: Math.max(maxMessageBytes, MAX_LOG_MESSAGE_BYTES),
      allowedOrigins: options.allowedOrigins ?? null,
      allowNoOrigin: options.allowNoOrigin ?? true,
      maxPerIp: options.maxConnectionsPerIp ?? 20,
      heartbeatMs: options.heartbeatMs ?? 20_000,
      clientDir: options.clientDir ?? null,
      trustProxy: options.trustProxy ?? false,
      httpRate: options.httpRate ?? { burst: 60, perSecond: 20 },
      logger,
      routes: {
        health: () => ({ ok: true, name: 'riverfront', version: SERVER_VERSION, protocol: { min: PROTOCOL_MIN, max: PROTOCOL_MAX }, ...game.stats() }),
        deleteAccount: (userId, token) => game.deleteAccountWithToken(userId, token),
        daily: async (date) => {
          const day = await game.daily.get(date, null);
          return day ? { challenge: day.challenge, board: day.board.entries } : null;
        },
      },
    });

  await ws.start(game);
  game.start();
  const port = ws instanceof WsTransport ? ws.port : (options.port ?? 0);
  logger.info('server.started', { port, path, version: SERVER_VERSION, store: store.constructor.name });

  let closing: Promise<void> | null = null;
  return {
    port,
    url: `ws://127.0.0.1:${port}${path}`,
    game,
    store,
    stats: () => game.stats(),
    close: () => {
      closing ??= (async () => {
        await game.shutdown();
        await ws.stop();
        await store.close();
        logger.info('server.stopped');
        if (!options.logger) logger.close();
      })();
      return closing;
    },
  };
}

/** Endereços IPv4 desta máquina na rede local, para mostrar a quem hospeda. */
export function localAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) out.push(info.address);
    }
  }
  return out;
}

export { GameServer } from './game-server.ts';
export { createLogger, silentLogger, scrubOldIps, type Logger } from './log.ts';
export { FileStore, writeAtomic } from './store/file.ts';
export { MemoryStore } from './store/memory.ts';
export type { Account, Report, Store, StoredMatch } from './store/types.ts';
export type { Connection, Transport, TransportHandlers } from './transport.ts';
export { readEnv, loadDotEnv } from './config.ts';
