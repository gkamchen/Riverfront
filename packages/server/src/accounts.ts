import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  checkName,
  colourById,
  DEFAULT_COLOURS,
  EMBLEMS,
  FLAG_PATTERN,
  type ErrorCode,
  type ProfilePatch,
  type PublicProfile,
} from '@riverfront/protocol';
import type { Account, Store } from './store/types.ts';

const DEFAULT_NAMES = ['Recruta', 'Capitão', 'Sentinela', 'Batedor', 'Ribeirinho', 'Pescador', 'Barqueiro'];

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function tokenMatches(account: Account, token: string): boolean {
  const a = Buffer.from(account.tokenHash, 'hex');
  const b = Buffer.from(hashToken(token), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function publicProfile(account: Account): PublicProfile {
  return {
    userId: account.id,
    name: account.name,
    tag: account.tag,
    colour: account.colour,
    flag: account.flag,
    emblem: account.emblem,
  };
}

async function freeTag(store: Store, name: string, keep?: string): Promise<string | null> {
  const used = await store.tagsInUse(name);
  if (keep && !used.has(keep)) return keep;
  if (used.size >= 9_000) return null;
  for (;;) {
    const tag = String(randomInt(1000, 10_000));
    if (!used.has(tag)) return tag;
  }
}

/**
 * Cria uma conta nova. Com `persist: false` ela só vive em memória até o
 * servidor decidir gravá-la (ver `persistAccount`): conexões que entram e saem
 * sem fazer nada não enchem o armazenamento.
 */
export async function createAccount(store: Store, now: number, wantedName?: string, persist = true): Promise<{ account: Account; token: string }> {
  const checked = wantedName ? checkName(wantedName) : null;
  let name = checked?.ok ? checked.name : (DEFAULT_NAMES[randomInt(DEFAULT_NAMES.length)] as string);
  let tag = await freeTag(store, name);
  if (!tag) {
    name = DEFAULT_NAMES[randomInt(DEFAULT_NAMES.length)] as string;
    tag = (await freeTag(store, name)) ?? String(randomInt(1000, 10_000));
  }
  const token = randomBytes(32).toString('base64url');
  const account: Account = {
    id: randomBytes(16).toString('base64url'),
    tokenHash: hashToken(token),
    name,
    tag,
    colour: DEFAULT_COLOURS[0],
    flag: '',
    emblem: EMBLEMS[0],
    createdAt: now,
    lastSeenAt: now,
    friends: [],
    incoming: [],
    outgoing: [],
    blocked: [],
    requestTimes: [],
  };
  if (persist) await store.saveAccount(account);
  return { account, token };
}

/**
 * Grava uma conta que estava só em memória. Se a etiqueta foi tomada nesse
 * meio-tempo, troca por outra livre e devolve true (o perfil mudou).
 */
export async function persistAccount(store: Store, account: Account): Promise<boolean> {
  const used = await store.tagsInUse(account.name);
  let changed = false;
  if (used.has(account.tag)) {
    account.tag = (await freeTag(store, account.name)) ?? String(randomInt(1000, 10_000));
    changed = true;
  }
  await store.saveAccount(account);
  return changed;
}

export type PatchResult = { ok: true; account: Account } | { ok: false; code: ErrorCode; detail: string };

export async function applyProfilePatch(store: Store, account: Account, patch: ProfilePatch): Promise<PatchResult> {
  const next: Account = { ...account };
  if (patch.name !== undefined) {
    const checked = checkName(patch.name);
    if (!checked.ok) return { ok: false, code: 'name-invalid', detail: checked.problem };
    if (checked.name !== account.name) {
      const tag = await freeTag(store, checked.name, account.tag);
      if (!tag) return { ok: false, code: 'name-invalid', detail: 'lotado' };
      next.name = checked.name;
      next.tag = tag;
    }
  }
  if (patch.colour !== undefined) {
    if (!colourById(patch.colour)) return { ok: false, code: 'profile-invalid', detail: 'colour' };
    next.colour = patch.colour;
  }
  if (patch.flag !== undefined) {
    if (!FLAG_PATTERN.test(patch.flag)) return { ok: false, code: 'profile-invalid', detail: 'flag' };
    next.flag = patch.flag;
  }
  if (patch.emblem !== undefined) {
    if (!(EMBLEMS as readonly string[]).includes(patch.emblem)) return { ok: false, code: 'profile-invalid', detail: 'emblem' };
    next.emblem = patch.emblem;
  }
  await store.saveAccount(next);
  return { ok: true, account: next };
}
