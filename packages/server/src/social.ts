import { FRIENDS, parseTag, type ErrorCode, type FriendsList, type PresenceStatus } from '@riverfront/protocol';
import { publicProfile } from './accounts.ts';
import type { Account, Store } from './store/types.ts';

export type SocialResult =
  | {
      readonly ok: true;
      /** Contas cuja lista de amigos mudou e deve ser reenviada. */
      readonly touched: readonly string[];
      /** Pedido novo para avisar o destinatário. */
      readonly notify?: { readonly to: string; readonly from: Account };
    }
  | { readonly ok: false; readonly code: ErrorCode };

const fail = (code: ErrorCode): SocialResult => ({ ok: false, code });
const HOUR = 60 * 60_000;

/** Remove pedidos vencidos (30 dias). Devolve true se algo mudou. */
export function expireRequests(account: Account, now: number): boolean {
  const before = account.incoming.length + account.outgoing.length;
  account.incoming = account.incoming.filter((r) => now - r.at < FRIENDS.requestTtlMs);
  account.outgoing = account.outgoing.filter((r) => now - r.at < FRIENDS.requestTtlMs);
  return account.incoming.length + account.outgoing.length !== before;
}

function unlink(a: Account, b: Account): void {
  a.friends = a.friends.filter((id) => id !== b.id);
  b.friends = b.friends.filter((id) => id !== a.id);
  a.incoming = a.incoming.filter((r) => r.userId !== b.id);
  a.outgoing = a.outgoing.filter((r) => r.userId !== b.id);
  b.incoming = b.incoming.filter((r) => r.userId !== a.id);
  b.outgoing = b.outgoing.filter((r) => r.userId !== a.id);
}

function befriend(a: Account, b: Account): void {
  unlink(a, b);
  a.friends.push(b.id);
  b.friends.push(a.id);
}

export function isBlockedEither(a: Account, b: Account): boolean {
  return a.blocked.includes(b.id) || b.blocked.includes(a.id);
}

export async function sendRequest(store: Store, from: Account, tagText: string, now: number): Promise<SocialResult> {
  const parsed = parseTag(tagText);
  if (!parsed) return fail('user-not-found');
  const target = await store.findByTag(parsed.name, parsed.tag);
  if (!target) return fail('user-not-found');
  if (target.id === from.id) return fail('self');
  expireRequests(from, now);
  expireRequests(target, now);
  if (from.friends.includes(target.id)) return fail('already-friends');

  from.requestTimes = from.requestTimes.filter((t) => now - t < HOUR);
  if (from.requestTimes.length >= FRIENDS.requestsPerHour) return fail('request-limit');
  if (from.friends.length >= FRIENDS.maxFriends) return fail('friend-limit');

  // O outro já tinha pedido: vira amizade direto.
  if (from.incoming.some((r) => r.userId === target.id)) {
    if (target.friends.length >= FRIENDS.maxFriends) return fail('unavailable');
    befriend(from, target);
    await store.saveAccount(from);
    await store.saveAccount(target);
    return { ok: true, touched: [from.id, target.id] };
  }
  if (from.outgoing.some((r) => r.userId === target.id)) return { ok: true, touched: [] };
  if (from.outgoing.length >= FRIENDS.maxPending) return fail('pending-limit');

  from.requestTimes.push(now);
  // Bloqueio e caixa cheia do outro lado são silenciosos: quem pede não fica sabendo.
  const silent = isBlockedEither(from, target) || target.incoming.length >= FRIENDS.maxPending;
  if (silent) {
    await store.saveAccount(from);
    return { ok: true, touched: [] };
  }
  from.outgoing.push({ userId: target.id, at: now });
  target.incoming.push({ userId: from.id, at: now });
  await store.saveAccount(from);
  await store.saveAccount(target);
  return { ok: true, touched: [from.id, target.id], notify: { to: target.id, from } };
}

export async function acceptRequest(store: Store, me: Account, otherId: string, now: number): Promise<SocialResult> {
  expireRequests(me, now);
  if (!me.incoming.some((r) => r.userId === otherId)) return fail('user-not-found');
  const other = await store.getAccount(otherId);
  if (!other) {
    me.incoming = me.incoming.filter((r) => r.userId !== otherId);
    await store.saveAccount(me);
    return fail('user-not-found');
  }
  if (me.friends.length >= FRIENDS.maxFriends) return fail('friend-limit');
  if (other.friends.length >= FRIENDS.maxFriends) return fail('unavailable');
  befriend(me, other);
  await store.saveAccount(me);
  await store.saveAccount(other);
  return { ok: true, touched: [me.id, other.id] };
}

/** Recusa silenciosa: o pedido some daqui e o outro lado continua vendo "pendente" até vencer. */
export async function declineRequest(store: Store, me: Account, otherId: string): Promise<SocialResult> {
  me.incoming = me.incoming.filter((r) => r.userId !== otherId);
  await store.saveAccount(me);
  return { ok: true, touched: [me.id] };
}

export async function removeFriend(store: Store, me: Account, otherId: string): Promise<SocialResult> {
  if (!me.friends.includes(otherId)) return fail('not-friends');
  const other = await store.getAccount(otherId);
  me.friends = me.friends.filter((id) => id !== otherId);
  await store.saveAccount(me);
  if (other) {
    other.friends = other.friends.filter((id) => id !== me.id);
    await store.saveAccount(other);
  }
  return { ok: true, touched: other ? [me.id, other.id] : [me.id] };
}

export async function block(store: Store, me: Account, otherId: string): Promise<SocialResult> {
  if (otherId === me.id) return fail('self');
  const other = await store.getAccount(otherId);
  if (!other) return fail('user-not-found');
  unlink(me, other);
  if (!me.blocked.includes(otherId)) me.blocked.push(otherId);
  if (me.blocked.length > 1000) me.blocked.shift();
  await store.saveAccount(me);
  await store.saveAccount(other);
  return { ok: true, touched: [me.id, other.id] };
}

export async function unblock(store: Store, me: Account, otherId: string): Promise<SocialResult> {
  me.blocked = me.blocked.filter((id) => id !== otherId);
  await store.saveAccount(me);
  return { ok: true, touched: [me.id] };
}

export async function buildList(store: Store, me: Account, presence: (userId: string) => PresenceStatus): Promise<FriendsList> {
  const load = async (ids: readonly string[]) => (await Promise.all(ids.map((id) => store.getAccount(id)))).filter((a): a is Account => a !== null);
  const friends = await load(me.friends);
  const incoming = await load(me.incoming.map((r) => r.userId));
  const outgoing = await load(me.outgoing.map((r) => r.userId));
  const blocked = await load(me.blocked);
  const at = (list: readonly { userId: string; at: number }[], id: string) => list.find((r) => r.userId === id)?.at ?? 0;
  return {
    friends: friends.map((a) => ({ profile: publicProfile(a), status: presence(a.id) })),
    incoming: incoming.map((a) => ({ profile: publicProfile(a), at: at(me.incoming, a.id) })),
    outgoing: outgoing.map((a) => ({ profile: publicProfile(a), at: at(me.outgoing, a.id) })),
    blocked: blocked.map(publicProfile),
  };
}
