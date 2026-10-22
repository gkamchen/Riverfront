import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MemoryStore } from './memory.ts';
import type { DailyBoard } from '@riverfront/core';
import type { Account, Report, StoredMatch } from './types.ts';

const ACCOUNTS = 'accounts.json';
const MATCHES = 'matches.ndjson';
const REPORTS = 'reports.ndjson';
const DAILY = 'daily.json';
const JOURNAL = 'accounts.journal.ndjson';

/** Grava num arquivo temporário e renomeia: quem lê nunca vê um JSON pela metade. */
export async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, data, 'utf8');
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, path);
      return;
    } catch (error) {
      // No Windows o rename pode falhar por um instante se o antivírus estiver lendo o arquivo.
      if (attempt >= 5) {
        await rm(tmp, { force: true });
        throw error;
      }
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
}

async function readNdjson<T>(path: string): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const out: T[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // linha cortada por queda de energia: ignora
    }
  }
  return out;
}

/**
 * Armazenamento em arquivos numa pasta, sem módulos nativos.
 *
 * Contas: `accounts.json` é uma foto completa e `accounts.journal.ndjson` só
 * as mudanças depois dela (uma linha por conta alterada ou apagada, gravadas
 * juntas com meio segundo de atraso). Ao abrir, a foto e o diário são juntados;
 * quando o diário cresce, vira uma foto nova (gravação atômica) e recomeça.
 * Assim criar ou atualizar uma conta não regrava todas as outras.
 *
 * Partidas e denúncias são anexadas linha a linha; tabelas do diário ficam em
 * `daily.json`.
 */
export class FileStore extends MemoryStore {
  readonly #dir: string;
  readonly #delayMs: number;
  readonly #compactAfter: number;
  #timer: NodeJS.Timeout | null = null;
  #writing: Promise<void> = Promise.resolve();
  #dirty = new Set<'matches' | 'reports' | 'daily'>();
  #dirtyAccounts = new Set<string>();
  #journalLines = 0;
  #appends: Promise<void> = Promise.resolve();
  /** Contas apagadas desde a última gravação: as partidas delas saem do arquivo inteiro. */
  #erased = new Set<string>();

  constructor(dir: string, options: { delayMs?: number; compactAfter?: number } = {}) {
    super();
    this.#dir = dir;
    this.#delayMs = options.delayMs ?? 500;
    this.#compactAfter = options.compactAfter ?? 2_000;
  }

  override async init(): Promise<void> {
    await mkdir(this.#dir, { recursive: true });
    try {
      const raw = JSON.parse(await readFile(join(this.#dir, ACCOUNTS), 'utf8')) as { accounts?: Account[] };
      for (const account of raw.accounts ?? []) this.index(account);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Não foi possível ler ${ACCOUNTS}: ${String(error)}`);
    }
    const journal = await readNdjson<{ put?: Account; del?: string }>(join(this.#dir, JOURNAL));
    for (const entry of journal) {
      if (entry.put) this.index(entry.put);
      else if (entry.del) this.accounts.delete(entry.del);
    }
    this.#journalLines = journal.length;
    this.matches = (await readNdjson<StoredMatch>(join(this.#dir, MATCHES))).slice(-5_000);
    this.reports = await readNdjson<Report>(join(this.#dir, REPORTS));
    try {
      const raw = JSON.parse(await readFile(join(this.#dir, DAILY), 'utf8')) as { boards?: DailyBoard[] };
      for (const board of raw.boards ?? []) this.daily.set(board.challengeId, board);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Não foi possível ler ${DAILY}: ${String(error)}`);
    }
  }

  override async deleteAccount(id: string): Promise<void> {
    this.#erased.add(id);
    await super.deleteAccount(id);
  }

  #schedule(): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#writeDirty();
    }, this.#delayMs);
    this.#timer.unref?.();
  }

  protected override changed(what: 'matches' | 'reports' | 'daily'): void {
    this.#dirty.add(what);
    this.#schedule();
  }

  protected override accountChanged(id: string): void {
    this.#dirtyAccounts.add(id);
    this.#schedule();
  }

  protected override appended(what: 'matches' | 'reports', item: StoredMatch | Report): void {
    const file = join(this.#dir, what === 'matches' ? MATCHES : REPORTS);
    this.#appends = this.#appends.then(() => appendFile(file, `${JSON.stringify(item)}
`, 'utf8')).catch(() => {});
  }

  /** Quantas linhas o diário de contas tem agora (testes e manutenção). */
  get journalLines(): number {
    return this.#journalLines;
  }

  #writeDirty(compact = false): Promise<void> {
    const dirty = [...this.#dirty];
    this.#dirty.clear();
    const ids = [...this.#dirtyAccounts];
    this.#dirtyAccounts.clear();
    this.#writing = this.#writing.then(async () => {
      await this.#appends;
      if (ids.length > 0) {
        const lines = ids.map((id) => {
          const account = this.accounts.get(id);
          return `${JSON.stringify(account ? { put: account } : { del: id })}
`;
        });
        await appendFile(join(this.#dir, JOURNAL), lines.join(''), 'utf8');
        this.#journalLines += lines.length;
      }
      if (this.#journalLines > 0 && (compact || this.#journalLines >= this.#compactAfter)) {
        await writeAtomic(join(this.#dir, ACCOUNTS), JSON.stringify({ version: 1, accounts: [...this.accounts.values()] }));
        await writeAtomic(join(this.#dir, JOURNAL), '');
        this.#journalLines = 0;
      }
      for (const what of dirty) {
        if (what === 'daily') {
          await writeAtomic(join(this.#dir, DAILY), JSON.stringify({ version: 1, boards: [...this.daily.values()] }));
        } else if (what === 'matches') {
          const erased = new Set(this.#erased);
          this.#erased.clear();
          const all = await readNdjson<StoredMatch>(join(this.#dir, MATCHES));
          const kept = all.filter((m) => !Object.values(m.players).some((id) => erased.has(id)));
          // o arquivo pode ter mais partidas que a memória; o prazo de retenção vale para os dois
          await writeAtomic(join(this.#dir, MATCHES), kept.filter((m) => m.endedAt >= this.retainedSince).map((x) => `${JSON.stringify(x)}
`).join(''));
        } else {
          await writeAtomic(join(this.#dir, REPORTS), this.reports.map((x) => `${JSON.stringify(x)}
`).join(''));
        }
      }
    });
    return this.#writing;
  }

  /** Partidas com fim antes disto já saíram pela retenção (0 = nenhum corte ainda). */
  retainedSince = 0;

  override async pruneHistory(reportsBefore: number, matchesBefore: number): Promise<void> {
    this.retainedSince = matchesBefore;
    await super.pruneHistory(reportsBefore, matchesBefore);
    this.#dirty.add('matches');
    this.#schedule();
  }

  override async flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    await this.#appends;
    await this.#writeDirty();
  }

  override async close(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    await this.#appends;
    // ao fechar, o diário vira foto: a próxima abertura lê um arquivo só
    await this.#writeDirty(true);
  }
}
