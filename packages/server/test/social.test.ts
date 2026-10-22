import { afterEach, describe, expect, it } from 'vitest';
import type { FriendsList, PublicProfile, ServerMessage } from '@riverfront/protocol';
import { MemoryStore, type RunningServer } from '../src/index.ts';
import { createRoom, isEvent, sleep, startedPair, TestClient, testServer } from './helpers.ts';

let server: RunningServer | null = null;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate();
  await server?.close();
  server = null;
});

async function connect(s: RunningServer, name?: string): Promise<TestClient> {
  const c = await TestClient.connect(s, name ? { name } : {});
  clients.push(c);
  return c;
}

function profileOf(c: TestClient): PublicProfile {
  const w = c.received.find((m) => m.t === 'welcome');
  if (!w || w.t !== 'welcome') throw new Error('sem welcome');
  return w.profile;
}

const tagOf = (c: TestClient) => `${profileOf(c).name}#${profileOf(c).tag}`;

async function listOf(c: TestClient): Promise<FriendsList> {
  const got = c.waitFor<Extract<ServerMessage, { t: 'friends' }>>((m) => m.t === 'friends');
  await c.ok({ t: 'friends.list' });
  return (await got).list;
}

describe('amigos', () => {
  it('pedido, aceite e presença', async () => {
    server = await testServer();
    const a = await connect(server, 'Ana');
    const b = await connect(server, 'Beto');
    const incoming = b.waitFor<Extract<ServerMessage, { t: 'friend.request' }>>((m) => m.t === 'friend.request');
    await a.ok({ t: 'friends.request', tag: tagOf(b) });
    expect((await incoming).from.userId).toBe(a.userId);
    expect((await listOf(a)).outgoing.map((r) => r.profile.userId)).toEqual([b.userId]);
    expect((await listOf(b)).incoming.map((r) => r.profile.userId)).toEqual([a.userId]);

    await b.ok({ t: 'friends.accept', userId: a.userId });
    const listA = await listOf(a);
    expect(listA.friends).toEqual([{ profile: profileOf(b), status: 'online' }]);
    expect(listA.outgoing).toEqual([]);

    const offline = a.waitFor((m) => m.t === 'presence' && m.status === 'offline');
    b.ws.terminate();
    await offline;
    const b2 = await connect(server);
    clients.push(b2);
    const online = a.waitFor((m) => m.t === 'presence' && m.status === 'online');
    const back = await TestClient.connect(server, { auth: { userId: b.userId, token: b.token } });
    clients.push(back);
    await online;

    // em partida
    const inMatch = a.waitFor((m) => m.t === 'presence' && m.status === 'in-match');
    const code = await createRoom(back);
    await b2.ok({ t: 'room.join', code });
    await back.ok({ t: 'ready', ready: true });
    await b2.ok({ t: 'ready', ready: true });
    await inMatch;
  });

  it('pedido mútuo vira amizade direto; erros comuns', async () => {
    server = await testServer();
    const a = await connect(server, 'Caio');
    const b = await connect(server, 'Duda');
    expect(await a.request({ t: 'friends.request', tag: tagOf(a) })).toMatchObject({ code: 'self' });
    expect(await a.request({ t: 'friends.request', tag: 'Ninguem#0000' })).toMatchObject({ code: 'user-not-found' });
    expect(await a.request({ t: 'friends.request', tag: 'sem etiqueta' })).toMatchObject({ code: 'user-not-found' });
    await a.ok({ t: 'friends.request', tag: tagOf(b) });
    await b.ok({ t: 'friends.request', tag: tagOf(a) });
    expect((await listOf(a)).friends).toHaveLength(1);
    expect(await a.request({ t: 'friends.request', tag: tagOf(b) })).toMatchObject({ code: 'already-friends' });
    await a.ok({ t: 'friends.remove', userId: b.userId });
    expect((await listOf(b)).friends).toHaveLength(0);
  });

  it('recusa é silenciosa', async () => {
    server = await testServer();
    const a = await connect(server, 'Edu');
    const c = await connect(server, 'Fabi');
    await c.ok({ t: 'friends.request', tag: tagOf(a) });
    const before = c.received.length;
    await a.ok({ t: 'friends.decline', userId: c.userId });
    await sleep(100);
    expect(c.received.length).toBe(before);
    expect((await listOf(c)).outgoing.map((r) => r.profile.userId)).toEqual([a.userId]);
    expect((await listOf(a)).incoming).toEqual([]);
  });

  it('bloqueio silencia pedidos, convites e entrada na sala', async () => {
    server = await testServer();
    const a = await connect(server, 'Gabi');
    const c = await connect(server, 'Hugo');
    await a.ok({ t: 'friends.block', userId: c.userId });
    const before = a.received.filter((m) => m.t === 'friend.request').length;
    // quem foi bloqueado não percebe nada
    await c.ok({ t: 'friends.request', tag: tagOf(a) });
    await sleep(100);
    expect(a.received.filter((m) => m.t === 'friend.request').length).toBe(before);
    expect((await listOf(a)).blocked.map((p) => p.userId)).toEqual([c.userId]);
    const code = await createRoom(a);
    expect(await c.request({ t: 'room.join', code })).toMatchObject({ code: 'unavailable' });
    await a.ok({ t: 'friends.unblock', userId: c.userId });
    await c.ok({ t: 'room.join', code });
  });

  it('limite de pedidos por hora', async () => {
    server = await testServer();
    const a = await connect(server, 'Iara');
    const others = await Promise.all(Array.from({ length: 11 }, (_, i) => connect(server as RunningServer, `Alvo${i}`)));
    for (let i = 0; i < 10; i++) await a.ok({ t: 'friends.request', tag: tagOf(others[i] as TestClient) });
    expect(await a.request({ t: 'friends.request', tag: tagOf(others[10] as TestClient) })).toMatchObject({ code: 'request-limit' });
  });

  it('convite para a sala', async () => {
    server = await testServer();
    const a = await connect(server, 'Joana');
    const b = await connect(server, 'Kleber');
    const c = await connect(server, 'Lia');
    await a.ok({ t: 'friends.request', tag: tagOf(b) });
    await b.ok({ t: 'friends.accept', userId: a.userId });
    expect(await a.request({ t: 'invite', userId: b.userId })).toMatchObject({ code: 'not-in-room' });
    const code = await createRoom(a);
    const invite = b.waitFor<Extract<ServerMessage, { t: 'invite' }>>((m) => m.t === 'invite');
    await a.ok({ t: 'invite', userId: b.userId });
    expect(await invite).toMatchObject({ code, from: { userId: a.userId } });
    expect(await a.request({ t: 'invite', userId: c.userId })).toMatchObject({ code: 'not-friends' });
    await b.ok({ t: 'room.join', code: (await invite).code });
  });
});

describe('denúncia e exclusão', () => {
  it('denúncia anexa o registro da partida e os emotes', async () => {
    const store = new MemoryStore();
    server = await testServer({ store });
    const { a, b } = await startedPair(server);
    clients.push(a, b);
    await a.ok({ t: 'emote', kind: 'taunt', emote: 'errou' });
    await a.ok({ t: 'surrender' });
    await b.seen(isEvent('end'));
    await b.ok({ t: 'report', userId: a.userId, reason: 'provocacao', note: 'provocou o tempo todo', attachMatch: true });
    const [report] = store.allReports();
    expect(report).toMatchObject({ reporter: b.userId, target: a.userId, reason: 'provocacao' });
    expect(report?.match?.record.log.length).toBeGreaterThan(0);
    expect(report?.emotes).toEqual([expect.objectContaining({ from: a.userId, emote: 'taunt:errou' })]);
    expect(await b.request({ t: 'report', userId: b.userId, reason: 'outro', attachMatch: false })).toMatchObject({ code: 'self' });
  });

  it('excluir a conta apaga tudo e atualiza a lista dos amigos', async () => {
    const store = new MemoryStore();
    server = await testServer({ store });
    const a = await connect(server, 'Mauro');
    const b = await connect(server, 'Nina');
    await a.ok({ t: 'friends.request', tag: tagOf(b) });
    await b.ok({ t: 'friends.accept', userId: a.userId });
    await a.ok({ t: 'report', userId: b.userId, reason: 'outro', attachMatch: false });
    const updated = b.waitFor<Extract<ServerMessage, { t: 'friends' }>>((m) => m.t === 'friends' && m.list.friends.length === 0);
    a.send({ t: 'account.delete', confirm: 'EXCLUIR' });
    expect(await a.closed).toBe(4004);
    await updated;
    expect(await store.getAccount(a.userId)).toBeNull();
    expect((await store.getAccount(b.userId))?.friends).toEqual([]);
    expect(store.allReports()).toEqual([]);
    // o token antigo não serve mais
    const again = await TestClient.connect(server, { auth: { userId: a.userId, token: a.token } });
    clients.push(again);
    expect(again.userId).not.toBe(a.userId);
  });
});
