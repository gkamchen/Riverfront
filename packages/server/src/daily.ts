import {
  addDailyResult,
  dailyChallenge,
  dailyMatchOptions,
  dailyRank,
  dailyResultFromMatch,
  emptyDailyBoard,
  type DailyBoard,
  type DailyChallenge,
  type DailyEntry,
  type LogEntry,
} from '@riverfront/core';
import { opponentLayoutSeed, type ErrorCode } from '@riverfront/protocol';
import { replayLocalMatch } from './replay.ts';
import type { Account, Store } from './store/types.ts';

/** Dias de tabela guardados (hoje incluso). */
export const DAILY_RETENTION_DAYS = 14;
/** Envios por conta e por dia (o melhor resultado é o que fica). */
export const DAILY_SUBMITS_PER_DAY = 20;

const DAY = 24 * 60 * 60_000;

export function dayId(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export type DailyOutcome =
  | { readonly ok: true; readonly entry: DailyEntry; readonly rank: number | null }
  | { readonly ok: false; readonly code: ErrorCode; readonly detail: string };

/**
 * Desafio diário no servidor: a configuração do dia vem do core (igual para
 * todos), o resultado só entra na tabela depois de a partida ser refeita.
 */
export class DailyService {
  readonly #store: Store;
  readonly #now: () => number;

  constructor(store: Store, now: () => number) {
    this.#store = store;
    this.#now = now;
  }

  /** Dias aceitos: de hoje até `DAILY_RETENTION_DAYS - 1` dias atrás. */
  #known(date: string): boolean {
    const t = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(t) || dayId(t) !== date) return false;
    const today = Date.parse(`${dayId(this.#now())}T00:00:00Z`);
    return t <= today && today - t < DAILY_RETENTION_DAYS * DAY;
  }

  async get(date: string | undefined, name: string | null): Promise<{ challenge: DailyChallenge; board: DailyBoard; rank: number | null } | null> {
    const id = date ?? dayId(this.#now());
    if (!this.#known(id)) return null;
    const board = (await this.#store.getDailyBoard(id)) ?? emptyDailyBoard(id);
    return { challenge: dailyChallenge(id), board, rank: name ? dailyRank(board, name) : null };
  }

  async submit(account: Account, date: string, log: readonly LogEntry[]): Promise<DailyOutcome> {
    // Hoje, ou ontem para quem terminou depois da meia-noite (UTC).
    const today = dayId(this.#now());
    const yesterday = dayId(this.#now() - DAY);
    if (date !== today && date !== yesterday) return { ok: false, code: 'wrong-state', detail: 'dia encerrado' };
    const used = account.dailySubmits?.[date] ?? 0;
    if (used >= DAILY_SUBMITS_PER_DAY) return { ok: false, code: 'rate-limited', detail: 'envios do dia' };
    account.dailySubmits = Object.fromEntries([...Object.entries(account.dailySubmits ?? {}).filter(([d]) => d === today || d === yesterday), [date, used + 1]]);
    await this.#store.saveAccount(account);

    const challenge = dailyChallenge(date);
    const replay = replayLocalMatch(dailyMatchOptions(challenge, 0), log, 'blue', opponentLayoutSeed(challenge.seed));
    if (!replay.ok) return { ok: false, code: 'replay-rejected', detail: replay.reason };
    const name = `${account.name}#${account.tag}`;
    const result = dailyResultFromMatch(replay.match, name, replay.durationMs, 'blue');
    const board = addDailyResult((await this.#store.getDailyBoard(date)) ?? emptyDailyBoard(date), result);
    await this.#store.saveDailyBoard(board);
    await this.prune();
    const entry = board.entries.find((e) => e.name === name) ?? { ...result, score: 0 };
    return { ok: true, entry, rank: dailyRank(board, name) };
  }

  /** Tira do armazenamento as tabelas com mais de `DAILY_RETENTION_DAYS` dias. */
  async prune(): Promise<void> {
    const keep = new Set<string>();
    for (let d = 0; d < DAILY_RETENTION_DAYS; d++) keep.add(dayId(this.#now() - d * DAY));
    await this.#store.pruneDailyBoards(keep);
  }
}
