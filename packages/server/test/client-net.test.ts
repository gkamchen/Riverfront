import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerView } from '@riverfront/core';
// O módulo de rede do cliente roda igual no Node 22 (WebSocket global), então testamos aqui contra o servidor de verdade.
import { OnlineSession } from '../../client/src/net/session.ts';
import { MemoryKeyValueStore, ProfileStorage } from '../../client/src/net/storage.ts';
import type { SocketLike } from '../../client/src/net/connection.ts';
import type { RunningServer } from '../src/index.ts';
import { testServer } from './helpers.ts';

let server: RunningServer | null = null;
const sessions: OnlineSession[] = [];

afterEach(async () => {
  for (const s of sessions.splice(0)) s.dispose();
  await server?.close();
  server = null;
});

function waitFor<T>(subscribe: (resolve: (value: T) => void) => () => void, timeoutMs = 5_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error('tempo esgotado'));
    }, timeoutMs);
    const off = subscribe((value) => {
      clearTimeout(timer);
      off();
      resolve(value);
    });
  });
}

describe('cliente online (net/)', () => {
  it('cria sala, joga, cai, reconecta e continua', async () => {
    server = await testServer();
    const sockets: SocketLike[] = [];
    const createSocket = (url: string) => {
      const ws = new WebSocket(url) as unknown as SocketLike;
      sockets.push(ws);
      return ws;
    };
    const storageA = new ProfileStorage(new MemoryKeyValueStore());
    const a = new OnlineSession(server.url, { storage: storageA, name: 'Clara', createSocket, pingIntervalMs: 200 });
    const b = new OnlineSession(server.url, { storage: new ProfileStorage(new MemoryKeyValueStore()), name: 'Davi' });
    sessions.push(a, b);
    await a.connect();
    await b.connect();
    expect(a.displayTag).toMatch(/^Clara#\d{4}$/);
    expect(storageA.authFor(server.url)?.userId).toBe(a.profile?.userId);

    await waitFor<number>((r) => a.on('rtt', r));
    expect(a.connection.rtt).not.toBeNull();

    const roomA = waitFor<{ code: string }>((r) => a.on('room', r));
    expect((await a.createRoom('unlimited', 'classic')).ok).toBe(true);
    const code = (await roomA).code;
    expect((await b.joinRoom(code.replace('-', ''))).ok).toBe(true);

    const startA = waitFor<{ host: typeof a.host }>((r) => a.on('matchStart', r));
    await a.setReady(true);
    await b.setReady(true);
    const { host } = await startA;

    const started = Promise.all([
      waitFor((r) => a.host.onUpdate((u) => u.kind === 'event' && u.event.kind === 'start' && r(u))),
      waitFor((r) => b.host.onUpdate((u) => u.kind === 'event' && u.event.kind === 'start' && r(u))),
    ]);
    for (const s of [a, b]) {
      expect((await s.host.autoPlace()).ok).toBe(true);
      expect((await s.host.submitPlacement([], true)).ok).toBe(true);
    }
    await started;
    expect(host.seat).toBe('blue');
    expect(host.view()?.phase).toBe('playing');
    expect(host.legacyView()?.enemy.cells.length).toBe(175);

    const target = (host.view() as PlayerView).enemy.cells.find((c) => c.state === 'hidden');
    if (!target) throw new Error('sem alvo');
    const shot = waitFor((r) => b.host.onUpdate((u) => u.kind === 'event' && u.event.kind === 'shot' && r(u)));
    expect((await host.attack(target)).ok).toBe(true);
    await shot;
    const turnBefore = host.view()?.turn;
    const wrong = await b.host.attack({ col: 0, row: 0 });
    if (turnBefore === 'blue') expect(wrong).toMatchObject({ ok: false, code: 'match-error', message: 'Não é a sua vez.' });

    // derruba a conexão do A: a sessão reconecta sozinha e a partida volta
    const opponentGone = waitFor<{ connected: boolean }>((r) => b.on('opponent', (o) => !o.connected && r(o)));
    const backOnline = waitFor<string>((r) => a.on('status', (s) => s === 'online' && r(s)));
    const resumed = waitFor((r) => a.host.onUpdate((u) => u.kind === 'state' && r(u)));
    sockets.at(-1)?.close(3000, 'teste');
    await opponentGone.catch(() => { throw new Error('adversário não foi avisado'); });
    await backOnline.catch(() => { throw new Error('não reconectou'); });
    await resumed.catch(() => { throw new Error('sem estado depois de reconectar'); });
    expect(a.room?.code).toBe(code);
    expect(a.host.view()?.phase).toBe('playing');
    expect(sockets.length).toBe(2);

    expect((await a.leaveRoom()).ok).toBe(true);
    expect(a.room).toBeNull();
  }, 20_000);

  it('amigos e exclusão de conta pela sessão', async () => {
    server = await testServer();
    const storage = new ProfileStorage(new MemoryKeyValueStore());
    const a = new OnlineSession(server.url, { storage, name: 'Elisa' });
    const b = new OnlineSession(server.url, { storage: new ProfileStorage(new MemoryKeyValueStore()), name: 'Fabio' });
    sessions.push(a, b);
    await a.connect();
    await b.connect();
    const request = waitFor((r) => b.on('friendRequest', r));
    expect((await a.addFriend(b.displayTag as string)).ok).toBe(true);
    await request;
    const friends = waitFor<{ friends: readonly unknown[] }>((r) => a.on('friends', (l) => l.friends.length === 1 && r(l)));
    await b.acceptFriend(a.profile?.userId as string);
    await friends;
    expect(a.friends?.friends[0]?.status).toBe('online');

    expect((await a.deleteAccount()).ok).toBe(true);
    expect(storage.authFor((server as RunningServer).url)).toBeNull();
  });
});

describe('cliente online: duplas, desafio e campanha', () => {
  it('sala de duplas pela sessão: lugares e visão do time', async () => {
    server = await testServer();
    const names = ['Gil', 'Hana', 'Iris', 'Joel'];
    const s = names.map((name) => new OnlineSession((server as RunningServer).url, { storage: new ProfileStorage(new MemoryKeyValueStore()), name }));
    sessions.push(...s);
    for (const x of s) await x.connect();
    const [a, b, c, d] = s as [OnlineSession, OnlineSession, OnlineSession, OnlineSession];
    const room = waitFor<{ code: string; format: string }>((r) => a.on('room', r));
    expect((await a.createRoom('unlimited', 'classic', [], undefined, 'doubles')).ok).toBe(true);
    const { code, format } = await room;
    expect(format).toBe('doubles');
    for (const x of [b, c, d]) expect((await x.joinRoom(code)).ok).toBe(true);
    const started = Promise.all(s.map((x) => waitFor((r) => x.host.onUpdate((u) => u.kind === 'event' && u.event.kind === 'start' && r(u)))));
    for (const x of s) await x.setReady(true);
    for (const x of s) if (!x.host.view()) await waitFor((r) => x.host.onUpdate(() => r(true)));
    for (const x of s) expect((await x.host.autoPlace()).ok).toBe(true);
    for (const x of s) expect((await x.host.submitPlacement([], true)).ok).toBe(true);
    await started;
    expect(a.host.seatId).toBe('blue-1');
    expect(c.host.seatId).toBe('blue-2');
    expect(c.host.teamView()?.doubles.partner).toBe('blue-1');
  }, 20_000);

  it('desafio do dia e campanha local pela sessão', async () => {
    server = await testServer();
    const storage = new ProfileStorage(new MemoryKeyValueStore());
    const a = new OnlineSession(server.url, { storage, name: 'Kaio' });
    sessions.push(a);
    await a.connect();
    const daily = waitFor<{ challenge: { id: string } }>((r) => a.on('daily', r));
    expect((await a.getDaily()).ok).toBe(true);
    expect((await daily).challenge.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // campanha fica no aparelho até sincronizar; sincronizar progresso vazio funciona
    expect(a.campaign.progress.missions).toEqual({});
    const synced = waitFor<unknown>((r) => a.on('campaign', r));
    expect((await a.syncCampaign()).ok).toBe(true);
    expect(await synced).toMatchObject({ verified: [] });
  });
});

describe('credencial por servidor', () => {
  it('um #servidor= diferente nunca recebe o token emitido por outro servidor', async () => {
    server = await testServer();
    const other = await testServer();
    try {
      const kv = new MemoryKeyValueStore();
      const first = new OnlineSession(server.url, { storage: new ProfileStorage(kv), name: 'Lara' });
      sessions.push(first);
      await first.connect();
      const firstAuth = new ProfileStorage(kv).authFor(server.url);
      expect(firstAuth?.token).toBeTruthy();

      // mesmo aparelho, link apontando para outro servidor: o hello não leva o token do primeiro
      const sent: string[] = [];
      const createSocket = (url: string) => {
        const ws = new WebSocket(url) as unknown as SocketLike;
        const send = ws.send.bind(ws);
        (ws as { send: (d: string) => void }).send = (d: string) => {
          sent.push(d);
          send(d);
        };
        return ws;
      };
      const second = new OnlineSession(other.url, { storage: new ProfileStorage(kv), name: 'Lara', createSocket });
      sessions.push(second);
      await second.connect();
      const hello = JSON.parse(sent[0] as string) as { t: string; auth?: unknown };
      expect(hello.t).toBe('hello');
      expect(hello.auth).toBeUndefined();
      expect(sent.join('')).not.toContain(firstAuth?.token as string);
      expect(second.profile?.userId).not.toBe(first.profile?.userId);
      // as duas credenciais convivem, cada uma no seu servidor
      expect(new ProfileStorage(kv).authFor(other.url)?.userId).toBe(second.profile?.userId);
      expect(new ProfileStorage(kv).authFor(server.url)?.userId).toBe(firstAuth?.userId);
    } finally {
      await other.close();
    }
  });

  it('a credencial antiga (sem servidor) vai para o último servidor usado e some da chave antiga', () => {
    const kv = new MemoryKeyValueStore();
    kv.setItem('riverfront.server', JSON.stringify('ws://127.0.0.1:8787/ws'));
    kv.setItem('riverfront.auth', JSON.stringify({ userId: 'u'.repeat(22), token: 't'.repeat(43) }));
    const storage = new ProfileStorage(kv);
    expect(storage.authFor('ws://127.0.0.1:8787/ws')?.userId).toBe('u'.repeat(22));
    expect(storage.authFor('wss://outro.exemplo/ws')).toBeNull();
    expect(kv.getItem('riverfront.auth')).toBeNull();
  });
});
