import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  close(): void;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  /** Pasta para arquivos diários (`server-AAAA-MM-DD.log`). Sem ela, só o console. */
  readonly dir?: string | null;
  /** Desliga a saída no console (testes). */
  readonly quiet?: boolean;
  /** Dias que o IP pode ficar nos arquivos. Depois disso ele é apagado das linhas. */
  readonly ipRetentionDays?: number;
  /** Dias até o arquivo de log ser apagado de vez. */
  readonly fileRetentionDays?: number;
}

const DAY = 24 * 60 * 60_000;

/**
 * Logs estruturados, uma linha JSON por evento. O campo `ip` só vai para os
 * arquivos (nunca para o console) e some dos arquivos com mais de 7 dias.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const min = LEVELS[options.level ?? 'info'];
  const dir = options.dir ?? null;
  const retention = options.ipRetentionDays ?? 7;
  let scrubTimer: NodeJS.Timeout | null = null;

  if (dir) {
    mkdirSync(dir, { recursive: true });
    const keep = options.fileRetentionDays ?? 30;
    const clean = () => {
      scrubOldIps(dir, retention);
      removeOldLogs(dir, keep);
    };
    clean();
    scrubTimer = setInterval(clean, 60 * 60_000);
    scrubTimer.unref();
  }

  const write = (level: LogLevel, event: string, fields: Record<string, unknown> = {}) => {
    if (LEVELS[level] < min) return;
    const at = new Date();
    const entry = { at: at.toISOString(), level, event, ...fields };
    if (!options.quiet) {
      const { ip: _ip, ...safe } = entry as Record<string, unknown>;
      const line = JSON.stringify(safe);
      if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
      else process.stdout.write(`${line}\n`);
    }
    if (dir) {
      try {
        appendFileSync(join(dir, `server-${at.toISOString().slice(0, 10)}.log`), `${JSON.stringify(entry)}\n`);
      } catch {
        // disco cheio ou sem permissão: o console continua valendo
      }
    }
  };

  return {
    debug: (e, f) => write('debug', e, f),
    info: (e, f) => write('info', e, f),
    warn: (e, f) => write('warn', e, f),
    error: (e, f) => write('error', e, f),
    close: () => {
      if (scrubTimer) clearInterval(scrubTimer);
    },
  };
}

/** Reescreve os arquivos de log antigos sem o campo `ip`. */
export function scrubOldIps(dir: string, retentionDays: number, now = Date.now()): number {
  let scrubbed = 0;
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => /^server-\d{4}-\d{2}-\d{2}\.log$/.test(f));
  } catch {
    return 0;
  }
  for (const file of files) {
    const day = Date.parse(`${file.slice(7, 17)}T00:00:00Z`);
    if (!Number.isFinite(day) || now - day < retentionDays * DAY) continue;
    const path = join(dir, file);
    try {
      if (statSync(path).size === 0) continue;
      const text = readFileSync(path, 'utf8');
      if (!text.includes('"ip"')) continue;
      const out = text
        .split('\n')
        .map((line) => {
          if (!line.includes('"ip"')) return line;
          try {
            const { ip: _ip, ...rest } = JSON.parse(line) as Record<string, unknown>;
            return JSON.stringify(rest);
          } catch {
            return '';
          }
        })
        .join('\n');
      writeFileSync(path, out);
      scrubbed++;
    } catch {
      // tenta de novo na próxima rodada
    }
  }
  return scrubbed;
}

/** Apaga arquivos de log com mais de `days` dias. */
export function removeOldLogs(dir: string, days: number, now = Date.now()): number {
  let removed = 0;
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => /^server-\d{4}-\d{2}-\d{2}\.log$/.test(f));
  } catch {
    return 0;
  }
  for (const file of files) {
    const day = Date.parse(`${file.slice(7, 17)}T00:00:00Z`);
    if (!Number.isFinite(day) || now - day < days * DAY) continue;
    try {
      rmSync(join(dir, file));
      removed++;
    } catch {
      // tenta de novo na próxima rodada
    }
  }
  return removed;
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {}, close() {} };
