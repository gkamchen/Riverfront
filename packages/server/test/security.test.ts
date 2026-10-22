import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerView } from '@riverfront/core';
import { MAX_CLIENT_MESSAGE_BYTES, MAX_LOG_MESSAGE_BYTES, type PackedView, type ServerMessage } from '@riverfront/protocol';
import { MemoryStore } from '../src/index.ts';
import type { RunningServer } from '../src/index.ts';
import { createRoom, isEvent, playToEnd, shoot, sleep, TestClient, testServer } from './helpers.ts';

let server: RunningServer | null = null;
const clients: TestClient[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate();
  await server?.close();
  server = null;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function connect(s: RunningServer, opts: Parameters<typeof TestClient.connect>[1] = {}): Promise<TestClient> {
  const c = await TestClient.connect(s, opts);
  clients.push(c);
  return c;
}

/** Confere uma mensagem enviada a um jogador antes do fim da partida. */
function assertNoEnemySecrets(raw: string): void {
  const msg = JSON.parse(raw) as ServerMessage;
  if (msg.t !== 'match.state' && msg.t !== 'match.event') {
    // nenhuma outra mensagem carrega dados de tabuleiro
    expect(raw).not.toMatch(/"(cells|placements|layout|pieces|terrain)"/);
    return;
  }
  const view: PackedView = msg.view;
  if (view.phase === 'finished') return;
  expect(view.enemy.layout).toBeNull();
  expect(Object.keys(view.enemy.cells).sort()).toEqual(['roles', 'shield', 'state']);
  // Fora das células e das peças já destruídas, nada do lado inimigo pode ter coordenada ou posição.
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (!value || typeof value !== 'object') return;
    const keys = Object.keys(value);
    expect(keys.includes('col') && keys.includes('row'), `coordenada em ${path}`).toBe(false);
    for (const key of keys) {
      expect(['placement', 'placements', 'pieces', 'terrain', 'anchor', 'occupant'], `campo ${path}.${key}`).not.toContain(key);
      walk((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
  };
  const { cells: _cells, destroyed: _destroyed, layout: _layout, ...rest } = view.enemy;
  walk(rest, 'enemy');
  // papel só aparece em célula atingida
  for (const index of Object.keys(view.enemy.cells.roles)) expect(view.enemy.cells.state[Number(index)]).toBe('x');
  for (const index of view.enemy.cells.shield) expect('hsx').toContain(view.enemy.cells.state[index]);
  if (msg.t === 'match.event' && msg.event.kind === 'ability' && msg.event.by !== view.player) {
    if (msg.event.ability !== 'bomb') expect(msg.event.outcome).toBeNull();
  }
}

describe('sigilo', () => {
  it('nenhuma mensagem leva o layout inimigo (partida inteira, modo completo com habilidades)', async () => {
    server = await testServer({ rate: { burst: 1_000, perSecond: 1_000 } });
    const a = await connect(server);
    const b = await connect(server);
    const code = await createRoom(a, { mode: 'full' });
    await b.ok({ t: 'room.join', code });
    await a.ok({ t: 'ready', ready: true });
    await b.ok({ t: 'ready', ready: true });
    await a.seen((m) => m.t === 'match.state');
    await b.seen((m) => m.t === 'match.state');
    const started = Promise.all([a.waitFor(isEvent('start')), b.waitFor(isEvent('start'))]);
    for (const c of [a, b]) {
      await c.ok({ t: 'placement.auto' });
      await c.ok({ t: 'placement.submit', placements: [], confirm: true });
    }
    await started;

    // espião é privado: o vermelho só fica sabendo que foi usado
    const spied = b.waitFor<Extract<ServerMessage, { t: 'match.event' }>>(isEvent('ability'));
    await a.ok({ t: 'ability', request: { ability: 'spy', axis: 'row', index: 1 } });
    const seenByRed = await spied;
    expect(seenByRed.event).toMatchObject({ kind: 'ability', by: 'blue', ability: 'spy', outcome: null });
    const ownSpy = a.received.find((m) => m.t === 'match.event' && m.event.kind === 'ability');
    expect(ownSpy && ownSpy.t === 'match.event' && ownSpy.event.kind === 'ability' && ownSpy.event.outcome).toBeTruthy();
    expect(b.view?.history.some((h) => h.kind === 'ability' && h.outcome === null)).toBe(true);

    await playToEnd(a, b);
    for (const c of [a, b]) {
      expect(c.raw.length).toBeGreaterThan(50);
      for (const raw of c.raw) assertNoEnemySecrets(raw);
    }
  }, 60_000);

  it('o que o azul recebe é idêntico com dois layouts diferentes do vermelho', async () => {
    const strip = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(strip);
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) if (!['serverTime', 'now', 'turnStartedAt'].includes(k)) out[k] = strip(v);
        return out;
      }
      return value;
    };

    const run = async (redAutos: number) => {
      const s = await testServer({ matchSeed: () => 4242 });
      try {
        const a = await connect(s);
        const b = await connect(s);
        const code = await createRoom(a);
        await b.ok({ t: 'room.join', code });
        await a.ok({ t: 'ready', ready: true });
        await b.ok({ t: 'ready', ready: true });
        await a.seen((m) => m.t === 'match.state');
        await b.seen((m) => m.t === 'match.state');
        const started = Promise.all([a.waitFor(isEvent('start')), b.waitFor(isEvent('start'))]);
        await a.ok({ t: 'placement.auto' });
        for (let i = 0; i < redAutos; i++) await b.ok({ t: 'placement.auto' });
        await a.ok({ t: 'placement.submit', placements: [], confirm: true });
        await b.ok({ t: 'placement.submit', placements: [], confirm: true });
        await started;

        const redField = (b.view as PlayerView).own.cells;
        const rocks = redField.filter((c) => c.terrain === 'rock');
        const blueTargets = (b.view as PlayerView).enemy.cells.slice(0, 4);
        for (let round = 0; round < 4; round++) {
          const rock = rocks[round];
          if (!rock) throw new Error('poucas rochas');
          await shoot(a, b, a, { col: rock.col, row: rock.row });
          // o vermelho atira até passar a vez (tiro extra quando acerta)
          for (const cell of blueTargets) {
            if ((b.view as PlayerView).turn !== 'red') break;
            const known = (b.view as PlayerView).enemy.cells.find((c) => c.col === cell.col && c.row === cell.row);
            if (known?.state !== 'hidden') continue;
            await shoot(a, b, b, { col: cell.col, row: cell.row });
          }
          if ((b.view as PlayerView).turn === 'red') {
            const any = (b.view as PlayerView).enemy.cells.find((c) => c.state === 'hidden');
            if (any) await shoot(a, b, b, { col: any.col, row: any.row });
          }
        }
        const blueSaw = a.raw.map((r) => JSON.parse(r) as ServerMessage).filter((m) => m.t === 'match.state' || m.t === 'match.event');
        const redLayout = (b.view as PlayerView).own.pieces.map((p) => p.cells);
        return { blueSaw: strip(blueSaw), redLayout };
      } finally {
        await s.close();
      }
    };

    const one = await run(1);
    const two = await run(2);
    expect(two.redLayout).not.toEqual(one.redLayout);
    expect(two.blueSaw).toEqual(one.blueSaw);
  }, 30_000);
});

describe('abuso', () => {
  it('limita a taxa e derruba quem insiste', async () => {
    server = await testServer();
    const c = await connect(server);
    for (let i = 0; i < 60; i++) c.send({ t: 'ping', ts: i });
    await c.waitFor((m) => m.t === 'error' && m.code === 'rate-limited');
    for (let i = 0; i < 200; i++) c.send({ t: 'ping', ts: i });
    expect(await c.closed).toBe(1008);
  });

  it('mensagem grande demais: recusada, e acima do teto do WebSocket fecha a conexão', async () => {
    server = await testServer();
    const c = await connect(server);
    c.sendRaw(JSON.stringify({ t: 'room.join', id: 3, code: 'x'.repeat(MAX_CLIENT_MESSAGE_BYTES * 2) }));
    expect(await c.waitFor((m) => m.t === 'error')).toMatchObject({ code: 'too-large' });
    c.sendRaw(JSON.stringify({ t: 'room.join', code: 'x'.repeat(MAX_LOG_MESSAGE_BYTES * 2) }));
    expect(await c.closed).toBe(1009);
  });

  it('JSON inválido e campos errados respondem bad-message com o id', async () => {
    server = await testServer();
    const c = await connect(server);
    c.sendRaw('{"t":"attack","id":77,"target":{"col":"a","row":1}}');
    const err = await c.waitFor((m) => m.t === 'error');
    expect(err).toMatchObject({ code: 'bad-message', ref: 77 });
    c.sendRaw('isto não é json');
    expect(await c.waitFor((m) => m.t === 'error')).toMatchObject({ code: 'bad-message', ref: null });
  });

  it('fuzz: o servidor sobrevive a lixo e a mensagens válidas com valores absurdos', async () => {
    server = await testServer({ rate: { burst: 10_000, perSecond: 10_000 } });
    let seed = 987654;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
    const values: unknown[] = [0, -1, 1e308, 'x', '', null, true, [], {}, { col: 1, row: 1 }, 'K7Q2-PX', 'a'.repeat(300), '__proto__', 2 ** 31, 0.5, 'EXCLUIR'];
    const types = ['hello', 'profile.update', 'room.create', 'room.join', 'room.leave', 'ready', 'placement.submit', 'placement.auto', 'attack', 'ability', 'surrender', 'emote', 'mute', 'ping', 'sync', 'rematch', 'friends.list', 'friends.request', 'friends.accept', 'invite', 'report', 'nada'];
    const keys = ['id', 'code', 'clock', 'mode', 'ready', 'placements', 'confirm', 'target', 'request', 'kind', 'emote', 'muted', 'ts', 'accept', 'tag', 'userId', 'reason', 'name', 'colour', 'flag'];
    let internal = 0;
    for (let conn = 0; conn < 12; conn++) {
      const c = await connect(server);
      // metade das conexões entra numa sala para exercitar mais caminhos
      if (conn % 2 === 0) await c.ok({ t: 'room.create', clock: 'padrao', mode: pick(['classic', 'full'] as const) });
      for (let i = 0; i < 35; i++) {
        if (rand() < 0.2) {
          c.sendRaw(String(pick(['{', '[]', '{"t":1}', 'null', '"t"', '{"t":"attack","target":[]}', '\u0000', '{"t":"hello"}'])));
          continue;
        }
        const msg: Record<string, unknown> = { t: pick(types) };
        const n = Math.floor(rand() * 4);
        for (let k = 0; k < n; k++) msg[pick(keys)] = pick(values);
        c.sendRaw(JSON.stringify(msg));
      }
      await sleep(30);
      internal += c.received.filter((m) => m.t === 'error' && m.code === 'internal').length;
    }
    expect(internal).toBe(0);
    // ainda atende normalmente
    const fresh = await connect(server);
    const pong = fresh.waitFor((m) => m.t === 'pong');
    fresh.send({ t: 'ping', ts: 5 });
    expect(await pong).toMatchObject({ ts: 5 });
    await createRoom(fresh);
  }, 30_000);

  it('quem não manda hello é desconectado', async () => {
    server = await testServer({ helloTimeoutMs: 150 });
    const c = new TestClient(server.url);
    clients.push(c);
    await c.opened;
    expect(await c.closed).toBe(4002);
  });

  it('limite de conexões por IP', async () => {
    server = await testServer({ maxConnectionsPerIp: 2 });
    await connect(server);
    await connect(server);
    const third = new TestClient(server.url);
    clients.push(third);
    await expect(third.opened).rejects.toThrow('429');
  });

  it('lista de origens permitidas', async () => {
    server = await testServer({ allowedOrigins: ['https://jogo.exemplo'], allowNoOrigin: false });
    const evil = new TestClient(server.url, { Origin: 'https://malvado.exemplo' });
    const none = new TestClient(server.url);
    const good = new TestClient(server.url, { Origin: 'https://jogo.exemplo' });
    clients.push(evil, none, good);
    await expect(evil.opened).rejects.toThrow('403');
    await expect(none.opened).rejects.toThrow('403');
    await good.opened;
  });
});

describe('persistência e exclusão', () => {
  it('guarda contas em arquivo e reabre com o mesmo token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'riverfront-'));
    dirs.push(dir);
    server = await testServer({ dataDir: dir });
    const a = await connect(server, { name: 'Persistente' });
    await a.ok({ t: 'profile.update', colour: 'roxo' });
    await server.close();

    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, 'accounts.json'), 'utf8')).accounts).toHaveLength(1);

    server = await testServer({ dataDir: dir });
    const again = await connect(server, { auth: { userId: a.userId, token: a.token } });
    const welcome = again.received[0] as Extract<ServerMessage, { t: 'welcome' }>;
    expect(welcome.userId).toBe(a.userId);
    expect(welcome.profile).toMatchObject({ name: 'Persistente', colour: 'roxo' });
  });

  it('DELETE /api/account apaga a conta e derruba a conexão', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'riverfront-'));
    dirs.push(dir);
    server = await testServer({ dataDir: dir });
    const a = await connect(server, { name: 'Apagar' });
    const base = `http://127.0.0.1:${server.port}`;
    const denied = await fetch(`${base}/api/account`, { method: 'DELETE', headers: { Authorization: `Bearer ${a.userId}.${'y'.repeat(43)}` } });
    expect(denied.status).toBe(401);
    const res = await fetch(`${base}/api/account`, { method: 'DELETE', headers: { Authorization: `Bearer ${a.userId}.${a.token}` } });
    expect(res.status).toBe(200);
    expect(await a.closed).toBe(4004);
    expect(a.received.some((m) => m.t === 'account.deleted')).toBe(true);
    // ao fechar, o diário de contas vira a foto nova, já sem a conta
    await server.close();
    server = null;
    expect(readFileSync(join(dir, 'accounts.json'), 'utf8')).not.toContain(a.userId);
    expect(readFileSync(join(dir, 'accounts.journal.ndjson'), 'utf8')).toBe('');
  });

  it('healthz responde', async () => {
    server = await testServer();
    const res = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    expect(await res.json()).toMatchObject({ ok: true, name: 'riverfront' });
  });
});

describe('IP atrás de proxy', () => {
  it('X-Forwarded-For forjado: só o último IP conta e lixo é ignorado', async () => {
    const { clientIp } = await import('../src/ws-transport.ts');
    expect(clientIp({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }, '127.0.0.1', true)).toBe('203.0.113.9');
    expect(clientIp({ 'x-forwarded-for': '203.0.113.9,  ' }, '127.0.0.1', true)).toBe('127.0.0.1');
    expect(clientIp({ 'x-forwarded-for': 'não-é-ip' }, '127.0.0.1', true)).toBe('127.0.0.1');
    expect(clientIp({ 'x-forwarded-for': '203.0.113.9' }, '127.0.0.1', false)).toBe('127.0.0.1');
    expect(clientIp({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '6.6.6.6' }, '127.0.0.1', 'cloudflare')).toBe('198.51.100.7');
    expect(clientIp({ 'cf-connecting-ip': 'x' }, '127.0.0.1', 'cloudflare')).toBe('127.0.0.1');
  });

  it('trocar o primeiro IP do X-Forwarded-For não burla o limite por IP', async () => {
    server = await testServer({ trustProxy: true, maxConnectionsPerIp: 1 });
    const a = new TestClient(server.url, { 'X-Forwarded-For': '1.1.1.1, 203.0.113.50' });
    clients.push(a);
    await a.opened;
    const forged = new TestClient(server.url, { 'X-Forwarded-For': '2.2.2.2, 203.0.113.50' });
    clients.push(forged);
    await expect(forged.opened).rejects.toThrow('429');
    const other = new TestClient(server.url, { 'X-Forwarded-For': '203.0.113.51' });
    clients.push(other);
    await other.opened;
  });
});

describe('contas novas', () => {
  const rawHello = async (s: RunningServer) => {
    const c = new TestClient(s.url);
    clients.push(c);
    await c.opened;
    return c;
  };

  it('conexão que só dá hello não grava conta; a primeira ação de verdade grava', async () => {
    const store = new MemoryStore();
    server = await testServer({ store });
    const c = await rawHello(server);
    await c.hello({ name: 'Passante' });
    expect(await store.accountCount()).toBe(0);
    expect(server.game.pendingAccounts).toBe(1);
    await c.ok({ t: 'daily.get' });
    expect(await store.accountCount()).toBe(0);
    await c.ok({ t: 'profile.update', colour: 'verde' });
    expect(await store.accountCount()).toBe(1);
    expect(server.game.pendingAccounts).toBe(0);
    // quem sai sem fazer nada não deixa rastro
    const d = await rawHello(server);
    await d.hello();
    await d.close();
    for (let i = 0; i < 50 && server.game.pendingAccounts > 0; i++) await sleep(20);
    expect(server.game.pendingAccounts).toBe(0);
    expect(await store.accountCount()).toBe(1);
  });

  it('limite de contas novas por IP numa hora', async () => {
    server = await testServer({ accountsPerIpPerHour: 3 });
    for (let i = 0; i < 3; i++) await (await rawHello(server)).hello();
    const blocked = await rawHello(server);
    blocked.send({ t: 'hello', protocol: { min: 1, max: 1 }, client: { name: 't', version: '0' } });
    expect(await blocked.waitFor((m) => m.t === 'error')).toMatchObject({ code: 'rate-limited', detail: 'contas' });
    expect(await blocked.closed).toBe(1008);
    // quem já tem conta continua entrando normalmente
    const first = clients[0] as TestClient;
    const back = await TestClient.connect(server, { auth: { userId: first.userId, token: first.token } }).catch(() => null);
    expect(back === null || back.userId !== '').toBe(true);
  });

  it('teto de contas guardadas', async () => {
    const store = new MemoryStore();
    server = await testServer({ store, maxAccounts: 1 });
    await TestClient.connect(server).then((c) => clients.push(c));
    const over = await rawHello(server);
    over.send({ t: 'hello', protocol: { min: 1, max: 1 }, client: { name: 't', version: '0' } });
    expect(await over.waitFor((m) => m.t === 'error')).toMatchObject({ code: 'server-full' });
  });

  it('contas paradas expiram e o índice por nome acompanha', async () => {
    const store = new MemoryStore();
    const base = { tokenHash: 'x', colour: 'azul', flag: '', emblem: 'ancora', createdAt: 0, friends: [], incoming: [], outgoing: [], blocked: [], requestTimes: [] };
    await store.saveAccount({ ...base, id: 'a'.repeat(22), name: 'Velho', tag: '1111', lastSeenAt: 0 });
    await store.saveAccount({ ...base, id: 'b'.repeat(22), name: 'Novo', tag: '2222', lastSeenAt: Date.now() });
    expect((await store.findByTag('velho', '1111'))?.id).toBe('a'.repeat(22));
    expect(await store.pruneInactive(Date.now() - 1000)).toBe(1);
    expect(await store.findByTag('Velho', '1111')).toBeNull();
    expect(await store.tagsInUse('Velho')).toEqual(new Set());
    // renomear tira o nome antigo do índice
    await store.saveAccount({ ...base, id: 'b'.repeat(22), name: 'Outro', tag: '2222', lastSeenAt: Date.now() });
    expect(await store.findByTag('Novo', '2222')).toBeNull();
    expect((await store.findByTag('Outro', '2222'))?.id).toBe('b'.repeat(22));
  });

  it('arquivo: cada conta nova vira uma linha no diário, sem regravar as outras', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'riverfront-'));
    dirs.push(dir);
    const { FileStore } = await import('../src/index.ts');
    const store = new FileStore(dir, { delayMs: 5, compactAfter: 1_000 });
    await store.init();
    const base = { tokenHash: 'x', colour: 'azul', flag: '', emblem: 'ancora', createdAt: 0, lastSeenAt: 0, friends: [], incoming: [], outgoing: [], blocked: [], requestTimes: [] };
    for (let i = 0; i < 5; i++) await store.saveAccount({ ...base, id: `${'c'.repeat(20)}${i}${i}`, name: `Conta${i}`, tag: '1234' });
    await store.flush();
    expect(store.journalLines).toBe(5);
    expect(readdirSync(dir)).not.toContain('accounts.json');
    const reopened = new FileStore(dir);
    await reopened.init();
    expect(await reopened.accountCount()).toBe(5);
    await reopened.close();
    expect(JSON.parse(readFileSync(join(dir, 'accounts.json'), 'utf8')).accounts).toHaveLength(5);
  });
});

describe('retenção', () => {
  it('denúncias e partidas antigas saem; arquivos de log velhos são apagados', async () => {
    const store = new MemoryStore();
    const old = { id: 'r1', at: 0, reporter: 'x', target: 'y', reason: 'outro', note: '', match: null, emotes: [] };
    await store.appendReport(old);
    await store.appendReport({ ...old, id: 'r2', at: Date.now() });
    await store.pruneHistory(Date.now() - 1000, Date.now() - 1000);
    expect(store.allReports().map((r) => r.id)).toEqual(['r2']);

    const dir = mkdtempSync(join(tmpdir(), 'riverfront-log-'));
    dirs.push(dir);
    const { removeOldLogs } = await import('../src/log.ts');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'server-2020-01-01.log'), '{}\n');
    writeFileSync(join(dir, `server-${new Date().toISOString().slice(0, 10)}.log`), '{}\n');
    expect(removeOldLogs(dir, 30)).toBe(1);
    expect(readdirSync(dir)).toHaveLength(1);
  });
});

describe('rotas HTTP', () => {
  it('limite de pedidos por IP na API e nos arquivos', async () => {
    server = await testServer({ httpRate: { burst: 5, perSecond: 0.001 } });
    const base = `http://127.0.0.1:${server.port}`;
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await fetch(`${base}/api/daily`)).status);
    expect(codes.slice(0, 5).every((c) => c !== 429)).toBe(true);
    expect(codes.slice(5)).toEqual([429, 429, 429]);
    expect((await fetch(`${base}/api/account`, { method: 'DELETE' })).status).toBe(429);
  });

  it('o cliente servido pelo servidor vai com CSP e cabeçalhos de segurança', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'riverfront-www-'));
    dirs.push(dir);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>');
    server = await testServer({ clientDir: dir });
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('content-security-policy')).toContain('connect-src');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('permissions-policy')).toContain('camera=()');
  });
});
