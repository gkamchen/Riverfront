import { newCampaignProgress, parseCampaignProgress, recordMission, type CampaignProgress, type MissionRecord } from '@riverfront/core';
import type { Auth, PublicProfile } from '@riverfront/protocol';

/** O mínimo de `localStorage` que usamos; permite trocar por memória em testes. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEYS = {
  /** Antigo: uma credencial só, sem dizer de qual servidor. Migrada no construtor. */
  legacyAuth: 'riverfront.auth',
  /** Credencial por servidor: `riverfront.auth:<host[:porta]>`. */
  authPrefix: 'riverfront.auth:',
  profile: 'riverfront.profile',
  server: 'riverfront.server',
  muted: 'riverfront.mutedEmotes',
  campaign: 'riverfront.campaign',
} as const;

/** `host[:porta]` do servidor, em minúsculas; null se a URL não for válida. */
export function serverKey(server: string): string | null {
  try {
    return new URL(server).host.toLowerCase() || null;
  } catch {
    return null;
  }
}

export class MemoryKeyValueStore implements KeyValueStore {
  readonly #data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.#data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.#data.set(key, value);
  }
  removeItem(key: string): void {
    this.#data.delete(key);
  }
}

function browserStorage(): KeyValueStore {
  try {
    const ls = (globalThis as { localStorage?: KeyValueStore }).localStorage;
    if (ls) {
      ls.setItem('riverfront.test', '1');
      ls.removeItem('riverfront.test');
      return ls;
    }
  } catch {
    // modo privado ou armazenamento bloqueado
  }
  return new MemoryKeyValueStore();
}

/**
 * Credenciais e preferências do jogador online. O token é a única "senha" da
 * conta anônima: perdê-lo (limpar dados do navegador) cria uma conta nova.
 */
export class ProfileStorage {
  readonly #kv: KeyValueStore;

  constructor(kv: KeyValueStore = browserStorage()) {
    this.#kv = kv;
    this.#migrateLegacyAuth();
  }

  /** O armazenamento por baixo (o mesmo para a campanha). */
  get keyValue(): KeyValueStore {
    return this.#kv;
  }

  #read<T>(key: string): T | null {
    try {
      const raw = this.#kv.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  #write(key: string, value: unknown): void {
    try {
      if (value === null) this.#kv.removeItem(key);
      else this.#kv.setItem(key, JSON.stringify(value));
    } catch {
      // sem espaço ou bloqueado: segue só em memória
    }
  }

  /**
   * Credencial da conta no servidor `server` (URL ws/wss). Cada servidor tem a
   * sua: um link com outro `#servidor=` nunca recebe o token deste.
   */
  authFor(server: string): Auth | null {
    const key = serverKey(server);
    if (!key) return null;
    const auth = this.#read<Auth>(KEYS.authPrefix + key);
    return auth && typeof auth.userId === 'string' && typeof auth.token === 'string' ? auth : null;
  }

  setAuthFor(server: string, value: Auth | null): void {
    const key = serverKey(server);
    if (key) this.#write(KEYS.authPrefix + key, value);
  }

  /**
   * A credencial antiga (sem servidor) pertence ao último servidor usado; sem
   * ele não dá para saber de quem é, então é descartada.
   */
  #migrateLegacyAuth(): void {
    const legacy = this.#read<Auth>(KEYS.legacyAuth);
    if (!legacy) return;
    const last = this.serverUrl;
    if (last && !this.authFor(last)) this.setAuthFor(last, legacy);
    this.#write(KEYS.legacyAuth, null);
  }

  /** Último perfil recebido do servidor (para mostrar algo antes de conectar). */
  get profile(): PublicProfile | null {
    return this.#read<PublicProfile>(KEYS.profile);
  }

  set profile(value: PublicProfile | null) {
    this.#write(KEYS.profile, value);
  }

  get serverUrl(): string | null {
    const value = this.#read<string>(KEYS.server);
    return typeof value === 'string' ? value : null;
  }

  set serverUrl(value: string | null) {
    this.#write(KEYS.server, value);
  }

  get mutedEmotes(): boolean {
    return this.#read<boolean>(KEYS.muted) === true;
  }

  set mutedEmotes(value: boolean) {
    this.#write(KEYS.muted, value);
  }

  /** Esquece a conta deste aparelho naquele servidor (depois de excluir a conta, por exemplo). */
  forget(server: string): void {
    this.setAuthFor(server, null);
    this.profile = null;
  }
}

/**
 * Progresso da campanha neste aparelho. É o padrão: nada vai para o servidor
 * a menos que o jogador sincronize (`OnlineSession.syncCampaign`).
 */
export class CampaignStore {
  readonly #kv: KeyValueStore;

  constructor(kv: KeyValueStore = browserStorage()) {
    this.#kv = kv;
  }

  get progress(): CampaignProgress {
    try {
      const raw = this.#kv.getItem(KEYS.campaign);
      return raw ? parseCampaignProgress(JSON.parse(raw)) : newCampaignProgress();
    } catch {
      return newCampaignProgress();
    }
  }

  set progress(value: CampaignProgress) {
    try {
      this.#kv.setItem(KEYS.campaign, JSON.stringify(value));
    } catch {
      // sem espaço: segue sem salvar
    }
  }

  /** Registra uma missão jogada localmente (mesma regra do core). */
  record(mission: string, result: { readonly won: boolean; readonly shots: number }): ReturnType<typeof recordMission> {
    const r = recordMission(this.progress, mission, result);
    if (r.ok) this.progress = r.progress;
    return r;
  }

  /** Junta com um progresso vindo da conta: fica o melhor de cada missão. */
  merge(other: CampaignProgress): CampaignProgress {
    const missions: Record<string, MissionRecord> = { ...this.progress.missions };
    for (const [id, b] of Object.entries(parseCampaignProgress(other).missions)) {
      const a = missions[id];
      const best = [a?.bestShots ?? null, b.bestShots].filter((x): x is number => x !== null);
      missions[id] = a
        ? {
            won: a.won || b.won,
            stars: Math.max(a.stars, b.stars) as 0 | 1 | 2 | 3,
            bestShots: best.length > 0 ? Math.min(...best) : null,
            attempts: Math.max(a.attempts, b.attempts),
          }
        : b;
    }
    const merged: CampaignProgress = { version: 1, missions };
    this.progress = merged;
    return merged;
  }

  clear(): void {
    try {
      this.#kv.removeItem(KEYS.campaign);
    } catch {
      // nada a fazer
    }
  }
}
