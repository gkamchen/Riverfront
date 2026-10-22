import { readFileSync } from 'node:fs';
import type { LogLevel } from './log.ts';
import type { TrustProxy } from './ws-transport.ts';

/** Opções lidas do ambiente. Os nomes das variáveis estão em `.env.example`. */
export interface EnvConfig {
  port: number;
  host: string;
  dataDir: string | null;
  logDir: string | null;
  logLevel: LogLevel;
  allowedOrigins: string[] | null;
  allowNoOrigin: boolean;
  clientDir: string | null;
  maxConnections: number;
  maxConnectionsPerIp: number;
  accountsPerIpPerHour: number;
  maxAccounts: number;
  accountInactiveDays: number;
  reportRetentionDays: number;
  matchRetentionDays: number;
  logRetentionDays: number;
  trustProxy: TrustProxy;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|sim|yes|on)$/i.test(value);
}

function int(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Valor inválido em ${name}: ${value}`);
  return n;
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const origins = (env.ALLOWED_ORIGINS ?? '').trim();
  const level = (env.LOG_LEVEL ?? 'info') as LogLevel;
  if (!['debug', 'info', 'warn', 'error'].includes(level)) throw new Error(`LOG_LEVEL inválido: ${level}`);
  return {
    port: int(env.PORT, 8787, 'PORT'),
    host: env.HOST || '0.0.0.0',
    dataDir: env.DATA_DIR === 'memoria' ? null : env.DATA_DIR || './dados',
    logDir: env.LOG_DIR || null,
    logLevel: level,
    allowedOrigins: origins === '' || origins === '*' ? null : origins.split(',').map((o) => o.trim()).filter(Boolean),
    allowNoOrigin: bool(env.ALLOW_NO_ORIGIN, true),
    clientDir: env.CLIENT_DIR || null,
    maxConnections: int(env.MAX_CONNECTIONS, 2_000, 'MAX_CONNECTIONS'),
    maxConnectionsPerIp: int(env.MAX_CONNECTIONS_PER_IP, 20, 'MAX_CONNECTIONS_PER_IP'),
    accountsPerIpPerHour: int(env.ACCOUNTS_PER_IP_HOUR, 20, 'ACCOUNTS_PER_IP_HOUR'),
    maxAccounts: int(env.MAX_ACCOUNTS, 200_000, 'MAX_ACCOUNTS'),
    accountInactiveDays: int(env.ACCOUNT_INACTIVE_DAYS, 365, 'ACCOUNT_INACTIVE_DAYS'),
    reportRetentionDays: int(env.REPORT_RETENTION_DAYS, 90, 'REPORT_RETENTION_DAYS'),
    matchRetentionDays: int(env.MATCH_RETENTION_DAYS, 90, 'MATCH_RETENTION_DAYS'),
    logRetentionDays: int(env.LOG_RETENTION_DAYS, 30, 'LOG_RETENTION_DAYS'),
    trustProxy: env.TRUST_PROXY === 'cloudflare' ? 'cloudflare' : bool(env.TRUST_PROXY, false),
  };
}

/**
 * Lê um arquivo `.env` simples (CHAVE=valor, # comentários) para o ambiente,
 * sem sobrescrever o que já estiver definido.
 */
export function loadDotEnv(path: string, env: NodeJS.ProcessEnv = process.env): boolean {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return false;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (env[key] === undefined) env[key] = value;
  }
  return true;
}
