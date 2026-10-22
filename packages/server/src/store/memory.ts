import type { DailyBoard } from '@riverfront/core';
import { nameKey, type Account, type Report, type Store, type StoredMatch } from './types.ts';

const MAX_MATCHES_IN_MEMORY = 5_000;

const clone = <T>(value: T): T => structuredClone(value);

/** Tudo em memória. Usado nos testes e como base do armazenamento em arquivo. */
export class MemoryStore implements Store {
  protected readonly accounts = new Map<string, Account>();
  /** nome normalizado -> etiqueta -> id. Evita varrer todas as contas a cada busca. */
  readonly #byName = new Map<string, Map<string, string>>();
  protected matches: StoredMatch[] = [];
  protected reports: Report[] = [];
  protected readonly daily = new Map<string, DailyBoard>();

  async init(): Promise<void> {}

  /** Coloca a conta no mapa e no índice (usado também ao carregar do disco). */
  protected index(account: Account): void {
    const old = this.accounts.get(account.id);
    if (old) this.#unindex(old);
    this.accounts.set(account.id, account);
    const key = nameKey(account.name);
    let tags = this.#byName.get(key);
    if (!tags) {
      tags = new Map();
      this.#byName.set(key, tags);
    }
    tags.set(account.tag, account.id);
  }

  #unindex(account: Account): void {
    const key = nameKey(account.name);
    const tags = this.#byName.get(key);
    if (tags?.get(account.tag) === account.id) tags.delete(account.tag);
    if (tags && tags.size === 0) this.#byName.delete(key);
  }

  async getAccount(id: string): Promise<Account | null> {
    const account = this.accounts.get(id);
    return account ? clone(account) : null;
  }

  async findByTag(name: string, tag: string): Promise<Account | null> {
    const id = this.#byName.get(nameKey(name))?.get(tag);
    const account = id ? this.accounts.get(id) : undefined;
    return account ? clone(account) : null;
  }

  async tagsInUse(name: string): Promise<Set<string>> {
    return new Set(this.#byName.get(nameKey(name))?.keys() ?? []);
  }

  async accountCount(): Promise<number> {
    return this.accounts.size;
  }

  async saveAccount(account: Account): Promise<void> {
    this.index(clone(account));
    this.accountChanged(account.id);
  }

  async deleteAccount(id: string): Promise<void> {
    const gone = this.accounts.get(id);
    if (gone) this.#unindex(gone);
    this.accounts.delete(id);
    this.accountChanged(id);
    if (gone) {
      const name = `${gone.name}#${gone.tag}`;
      for (const [day, board] of this.daily) {
        if (board.entries.some((e) => e.name === name)) this.daily.set(day, { ...board, entries: board.entries.filter((e) => e.name !== name) });
      }
      this.changed('daily');
    }
    for (const other of this.accounts.values()) {
      const before = other.friends.length + other.incoming.length + other.outgoing.length + other.blocked.length;
      other.friends = other.friends.filter((f) => f !== id);
      other.incoming = other.incoming.filter((r) => r.userId !== id);
      other.outgoing = other.outgoing.filter((r) => r.userId !== id);
      other.blocked = other.blocked.filter((b) => b !== id);
      if (other.friends.length + other.incoming.length + other.outgoing.length + other.blocked.length !== before) this.accountChanged(other.id);
    }
    this.matches = this.matches.filter((m) => !Object.values(m.players).includes(id));
    this.reports = this.reports
      .filter((r) => r.reporter !== id)
      .map((r) => (r.target === id ? { ...r, target: 'conta-excluida', match: null, emotes: [] } : r));
    this.changed('matches');
    this.changed('reports');
  }

  /** Apaga contas sem acesso desde `before` (menos as de `keep`). Devolve quantas. */
  async pruneInactive(before: number, keep: ReadonlySet<string> = new Set()): Promise<number> {
    const stale = [...this.accounts.values()].filter((a) => a.lastSeenAt < before && !keep.has(a.id)).map((a) => a.id);
    for (const id of stale) await this.deleteAccount(id);
    return stale.length;
  }

  /** Tira denúncias e partidas guardadas mais antigas que os prazos. */
  async pruneHistory(reportsBefore: number, matchesBefore: number): Promise<void> {
    const reports = this.reports.length;
    this.reports = this.reports.filter((r) => r.at >= reportsBefore);
    if (this.reports.length !== reports) this.changed('reports');
    const matches = this.matches.length;
    this.matches = this.matches.filter((m) => m.endedAt >= matchesBefore);
    if (this.matches.length !== matches) this.changed('matches');
  }

  async appendMatch(match: StoredMatch): Promise<void> {
    this.matches.push(clone(match));
    if (this.matches.length > MAX_MATCHES_IN_MEMORY) this.matches.splice(0, this.matches.length - MAX_MATCHES_IN_MEMORY);
    this.appended('matches', match);
  }

  async lastMatchBetween(a: string, b: string): Promise<StoredMatch | null> {
    for (let i = this.matches.length - 1; i >= 0; i--) {
      const m = this.matches[i] as StoredMatch;
      const ids = Object.values(m.players);
      if (ids.includes(a) && ids.includes(b)) return clone(m);
    }
    return null;
  }

  async appendReport(report: Report): Promise<void> {
    this.reports.push(clone(report));
    this.appended('reports', report);
  }

  async getDailyBoard(id: string): Promise<DailyBoard | null> {
    const board = this.daily.get(id);
    return board ? clone(board) : null;
  }

  async saveDailyBoard(board: DailyBoard): Promise<void> {
    this.daily.set(board.challengeId, clone(board));
    this.changed('daily');
  }

  async pruneDailyBoards(keep: ReadonlySet<string>): Promise<void> {
    let removed = false;
    for (const id of [...this.daily.keys()]) {
      if (!keep.has(id)) {
        this.daily.delete(id);
        removed = true;
      }
    }
    if (removed) this.changed('daily');
  }

  /** Só para testes e manutenção. */
  allReports(): readonly Report[] {
    return this.reports;
  }

  async flush(): Promise<void> {}

  async close(): Promise<void> {}

  /** Ganchos para quem persiste. */
  protected changed(_what: 'matches' | 'reports' | 'daily'): void {}

  /** Uma conta mudou (ou foi apagada): quem persiste grava só ela. */
  protected accountChanged(_id: string): void {}

  protected appended(_what: 'matches' | 'reports', _item: StoredMatch | Report): void {}
}
