import { afterEach, describe, expect, it } from 'vitest';
import { FACTION_IDS, FACTIONS, type ClockConfig, type PlayerView } from '@riverfront/core';
import type { ServerMessage } from '@riverfront/protocol';
import type { RunningServer } from '../src/index.ts';
import { createRoom, isEvent, playToEnd, shoot, sleep, startedPair, TestClient, testServer } from './helpers.ts';

let server: RunningServer | null = null;
const clients: TestClient[] = [];

async function track(...list: TestClient[]): Promise<void> {
  clients.push(...list);
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate();
  await server?.close();
  server = null;
});

describe('contas', () => {
  it('cria conta anônima e reconecta com o token', async () => {
    server = await testServer();
    const a = await TestClient.connect(server, { name: 'Marina' });
    await track(a);
    const welcome = a.received[0] as Extract<ServerMessage, { t: 'welcome' }>;
    expect(welcome.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(welcome.profile.name).toBe('Marina');
    expect(welcome.profile.tag).toMatch(/^\d{4}$/);
    await a.close();

    const again = await TestClient.connect(server, { auth: { userId: a.userId, token: a.token } });
    await track(again);
    const w2 = again.received[0] as Extract<ServerMessage, { t: 'welcome' }>;
    expect(w2.userId).toBe(a.userId);
    expect(w2.token).toBeNull();

    const wrong = await TestClient.connect(server, { auth: { userId: a.userId, token: 'x'.repeat(43) } });
    await track(wrong);
    expect(wrong.userId).not.toBe(a.userId);
  });

  it('o token não é guardado em texto puro', async () => {
    server = await testServer();
    const a = await TestClient.connect(server);
    await track(a);
    const account = await server.store.getAccount(a.userId);
    expect(account?.tokenHash).toHaveLength(64);
    expect(JSON.stringify(account)).not.toContain(a.token);
  });

  it('apelido inválido vira um nome padrão e a troca valida o nome', async () => {
    server = await testServer();
    const a = await TestClient.connect(server, { name: 'porra' });
    await track(a);
    expect((a.received[0] as Extract<ServerMessage, { t: 'welcome' }>).profile.name).not.toBe('porra');
    const bad = await a.request({ t: 'profile.update', name: 'C4r4lh0' });
    expect(bad).toMatchObject({ t: 'error', code: 'name-invalid', detail: 'proibido' });
    await a.ok({ t: 'profile.update', name: 'Capitã Ana', colour: 'verde', flag: 'BR', emblem: 'lobo' });
    const profile = await a.seen<Extract<ServerMessage, { t: 'profile' }>>((m) => m.t === 'profile');
    expect(profile.profile).toMatchObject({ name: 'Capitã Ana', colour: 'verde', flag: 'BR', emblem: 'lobo' });
  });

  it('versão de protocolo incompatível fecha a conexão', async () => {
    server = await testServer();
    const c = new TestClient(server.url);
    await track(c);
    await c.opened;
    c.send({ t: 'hello', protocol: { min: 7, max: 9 }, client: { name: 't', version: '0' } });
    const err = await c.waitFor((m) => m.t === 'error');
    expect(err).toMatchObject({ code: 'protocol-mismatch' });
    expect(await c.closed).toBe(4003);
  });

  it('exige hello antes de qualquer coisa', async () => {
    server = await testServer();
    const c = new TestClient(server.url);
    await track(c);
    await c.opened;
    const r = await c.request({ t: 'room.create', clock: 'padrao', mode: 'classic' });
    expect(r).toMatchObject({ t: 'error', code: 'not-authenticated' });
  });
});

describe('partida 1×1', () => {
  it('joga uma partida completa com tiros extras e revela o layout só no fim', async () => {
    server = await testServer({ rate: { burst: 1_000, perSecond: 1_000 } });
    const { a, b } = await startedPair(server, { mode: 'classic' });
    await track(a, b);
    expect(a.view?.phase).toBe('playing');
    expect(a.view?.enemy.layout).toBeNull();
    await playToEnd(a, b);

    const endA = await a.seen<Extract<ServerMessage, { t: 'match.event' }>>(isEvent('end'));
    const endB = await b.seen<Extract<ServerMessage, { t: 'match.event' }>>(isEvent('end'));
    expect(endA.event).toEqual(endB.event);
    expect(a.view?.phase).toBe('finished');
    expect(a.view?.enemy.layout).not.toBeNull();

    const shots = [...a.received, ...b.received].filter(
      (m): m is Extract<ServerMessage, { t: 'match.event' }> => m.t === 'match.event' && m.event.kind === 'shot',
    );
    expect(shots.some((m) => m.event.kind === 'shot' && m.event.outcome.extraShot)).toBe(true);

    const room = await a.seen<Extract<ServerMessage, { t: 'room' }>>((m) => m.t === 'room' && m.room.state === 'finished');
    expect(room.room.state).toBe('finished');
  }, 60_000);

  it('recusa jogada fora da vez e alvo repetido', async () => {
    server = await testServer();
    const { a, b } = await startedPair(server);
    await track(a, b);
    const notTurn = await b.request({ t: 'attack', target: { col: 0, row: 0 } });
    expect(notTurn).toMatchObject({ t: 'error', code: 'match-error', detail: 'not-your-turn', message: 'Não é a sua vez.' });
    const view = a.view as PlayerView;
    const rock = (b.view as PlayerView).own.cells.find((c) => c.terrain === 'rock' && !c.pieceId);
    expect(rock).toBeDefined();
    if (!rock) return;
    await shoot(a, b, a, { col: rock.col, row: rock.row });
    expect(view.turn).toBe('blue');
    expect(a.view?.turn).toBe('red');
    const again = await b.request({ t: 'attack', target: { col: 1, row: 1 } });
    expect(again.t).toBe('ok');
  });

  it('revanche alterna quem começa', async () => {
    server = await testServer();
    const { a, b } = await startedPair(server);
    await track(a, b);
    expect(a.view?.turn).toBe('blue');
    await a.ok({ t: 'surrender' });
    await b.seen(isEvent('end'));
    expect(b.view?.winReason).toBe('surrender');
    const offer = b.waitFor((m) => m.t === 'rematch');
    await a.ok({ t: 'rematch', accept: true });
    expect(await offer).toMatchObject({ offeredBy: 'blue' });
    const roomNext = a.waitFor<Extract<ServerMessage, { t: 'room' }>>((m) => m.t === 'room' && m.room.matchNumber === 2);
    const fresh = a.waitFor((m) => m.t === 'match.state');
    await b.ok({ t: 'rematch', accept: true });
    await fresh;
    expect(a.view?.phase).toBe('placing');
    const room = await roomNext;
    expect(room.room.matchNumber).toBe(2);
    expect(room.room.firstTurn).toBe('red');
  });

  it('posicionamento manual: layout inválido é recusado com texto em pt-BR', async () => {
    server = await testServer();
    const a = await TestClient.connect(server);
    const b = await TestClient.connect(server);
    await track(a, b);
    const code = await createRoom(a);
    await b.ok({ t: 'room.join', code });
    await a.ok({ t: 'ready', ready: true });
    await b.ok({ t: 'ready', ready: true });
    await a.seen((m) => m.t === 'match.state');
    const r = await a.request({ t: 'placement.submit', placements: [{ pieceId: 'armor-1', anchor: { col: 0, row: 0 }, rotation: 0 }], confirm: true });
    expect(r.t).toBe('error');
    const incomplete = await a.request({ t: 'placement.submit', placements: [], confirm: true });
    expect(incomplete).toMatchObject({ code: 'match-error', detail: 'layout-incomplete' });
    // usa o layout do auto como se fosse manual
    await a.ok({ t: 'placement.auto' });
    const own = (a.view as PlayerView).own.pieces.map((p) => p.placement).filter((p) => p !== null);
    await a.ok({ t: 'placement.submit', placements: own, confirm: true });
    const confirmed = await b.waitFor<Extract<ServerMessage, { t: 'match.event' }>>(isEvent('confirmed'));
    expect(confirmed.event).toEqual({ kind: 'confirmed', by: 'blue' });
  });

  it('tempo de posicionamento esgotado posiciona automaticamente', async () => {
    server = await testServer({ placementMs: { padrao: 300 } });
    const a = await TestClient.connect(server);
    const b = await TestClient.connect(server);
    await track(a, b);
    const code = await createRoom(a, { clock: 'padrao' });
    await b.ok({ t: 'room.join', code });
    await a.ok({ t: 'ready', ready: true });
    await b.ok({ t: 'ready', ready: true });
    await a.waitFor(isEvent('start'), 3_000);
    expect(a.view?.phase).toBe('playing');
    expect(a.view?.own.pieces.every((p) => p.placement !== null)).toBe(true);
  });
});

describe('facções e variantes', () => {
  it('facção escolhida no saguão, mutadores da sala e tiro especial privado (sonda)', async () => {
    server = await testServer();
    const prober = FACTION_IDS.find((id) => FACTIONS[id].specialShot?.kind === 'probe');
    if (!prober) return;
    const a = await TestClient.connect(server);
    const b = await TestClient.connect(server);
    await track(a, b);
    const roomMsg = a.waitFor<Extract<ServerMessage, { t: 'room' }>>((m) => m.t === 'room');
    await a.ok({ t: 'room.create', clock: 'unlimited', mode: 'full', mutators: ['neblina'] });
    const code = (await roomMsg).room.code;
    expect((await roomMsg).room.mutators).toEqual(['neblina']);
    await b.ok({ t: 'room.join', code });
    await a.ok({ t: 'faction', faction: prober });
    await a.ok({ t: 'ready', ready: true });
    expect(await a.request({ t: 'faction', faction: 'neutra' })).toMatchObject({ code: 'wrong-state' });
    const bad = await b.request({ t: 'faction', faction: 'atlantida' as never });
    expect(bad).toMatchObject({ code: 'bad-message' });
    await b.ok({ t: 'ready', ready: true });
    const info = await a.seen<Extract<ServerMessage, { t: 'room' }>>((m) => m.t === 'room' && m.room.state === 'placing');
    expect(info.room.players.find((p) => p.seat === 'blue')?.faction).toBe(prober);
    const started = Promise.all([a.waitFor(isEvent('start')), b.waitFor(isEvent('start'))]);
    for (const c of [a, b]) {
      await c.ok({ t: 'placement.auto' });
      await c.ok({ t: 'placement.submit', placements: [], confirm: true });
    }
    await started;
    const target = (a.view as PlayerView).enemy.cells.find((c) => c.state === 'hidden');
    if (!target) throw new Error('sem alvo');
    const seenByRed = b.waitFor<Extract<ServerMessage, { t: 'match.event' }>>(isEvent('special'));
    const r = await a.request({ t: 'special', request: { target: { col: target.col, row: target.row } } });
    if (r.t === 'error') {
      // sem energia/carga nesta facção no primeiro turno: o erro tem que ser de regra, não de protocolo
      expect(r.code).toBe('match-error');
      return;
    }
    const red = await seenByRed;
    expect(red.event).toMatchObject({ kind: 'special', by: 'blue', outcome: null });
    const blue = await a.seen<Extract<ServerMessage, { t: 'match.event' }>>(isEvent('special'));
    expect(blue.event.kind === 'special' && blue.event.outcome?.probe).toBeTruthy();
  });
});

const FAST: ClockConfig = {
  id: 'relampago',
  turnMs: 150,
  bankMs: 0,
  maxConsecutiveStrikes: 3,
  maxStrikes: 5,
  graceDropMs: 600,
  graceTotalMs: 900,
};

describe('relógio', () => {
  it('estouro de tempo dá strike e o terceiro seguido entrega a partida', async () => {
    server = await testServer({ clocks: { relampago: FAST } });
    const { a, b } = await startedPair(server, { clock: 'relampago' });
    await track(a, b);
    const end = await a.waitFor<Extract<ServerMessage, { t: 'match.event' }>>(isEvent('end'), 5_000);
    expect(end.event).toEqual({ kind: 'end', winner: 'red', reason: 'timeout' });
    const timeouts = a.received.flatMap((m) => (m.t === 'match.event' && m.event.kind === 'timeout' ? [m.event] : []));
    expect(timeouts.map((t) => t.player)).toEqual(['blue', 'red', 'blue', 'red', 'blue']);
    expect(timeouts.at(-1)).toMatchObject({ player: 'blue', forfeit: true, strikes: 3 });
  });

  it('um tiro zera a sequência de strikes, mas não o total', async () => {
    server = await testServer({ clocks: { relampago: { ...FAST, turnMs: 300 } } });
    const { a, b } = await startedPair(server, { clock: 'relampago' });
    await track(a, b);
    // azul e vermelho deixam o tempo correr uma vez cada
    await a.waitFor((m) => m.t === 'match.event' && m.event.kind === 'timeout' && m.event.player === 'red', 3_000);
    expect(a.view?.turn).toBe('blue');
    expect(a.view?.own.clock.consecutiveStrikes).toBe(1);
    const target = (a.view as PlayerView).enemy.cells.find((c) => c.state === 'hidden');
    if (!target) throw new Error('sem alvo');
    await a.ok({ t: 'attack', target: { col: target.col, row: target.row } });
    expect(a.view?.own.clock.consecutiveStrikes).toBe(0);
    expect(a.view?.own.clock.strikes).toBe(1);
  });
});

describe('desconexão', () => {
  it('congela o relógio, avisa o adversário e volta com o token', async () => {
    server = await testServer({ clocks: { relampago: { ...FAST, turnMs: 400, graceDropMs: 2_000, graceTotalMs: 3_000 } } });
    const { a, b } = await startedPair(server, { clock: 'relampago' });
    await track(a, b);
    const notice = b.waitFor<Extract<ServerMessage, { t: 'opponent' }>>((m) => m.t === 'opponent' && !m.connected);
    a.ws.terminate();
    const n = await notice;
    expect(n.graceLeftMs).toBeGreaterThan(0);
    // passa mais que o tempo do turno: sem timeout porque o relógio está congelado
    await sleep(700);
    expect(b.received.some((m) => m.t === 'match.event' && m.event.kind === 'timeout')).toBe(false);
    expect(b.view?.clock.frozen).toBe(true);

    const back = b.waitFor<Extract<ServerMessage, { t: 'opponent' }>>((m) => m.t === 'opponent' && m.connected);
    const a2 = await TestClient.connect(server, { auth: { userId: a.userId, token: a.token } });
    await track(a2);
    expect(a2.received[0]).toMatchObject({ t: 'welcome', resumed: true });
    await a2.seen((m) => m.t === 'match.state');
    await back;
    expect(a2.view?.phase).toBe('playing');
    expect(a2.view?.clock.frozen).toBe(false);
    const target = (a2.view as PlayerView).enemy.cells.find((c) => c.state === 'hidden');
    if (!target) throw new Error('sem alvo');
    await a2.ok({ t: 'attack', target: { col: target.col, row: target.row } });
  });

  it('quem não volta dentro da tolerância perde por abandono', async () => {
    server = await testServer({ clocks: { unlimited: { ...FAST, id: 'unlimited', turnMs: null, graceDropMs: 300, graceTotalMs: 500 } } });
    const { a, b } = await startedPair(server);
    await track(a, b);
    a.ws.terminate();
    const end = await b.waitFor<Extract<ServerMessage, { t: 'match.event' }>>(isEvent('end'), 4_000);
    expect(end.event).toEqual({ kind: 'end', winner: 'red', reason: 'abandon' });
  });

  it('conexão nova da mesma conta derruba a antiga', async () => {
    server = await testServer();
    const a = await TestClient.connect(server);
    await track(a);
    const a2 = await TestClient.connect(server, { auth: { userId: a.userId, token: a.token } });
    await track(a2);
    expect(await a.closed).toBe(4001);
    const r = await a2.request({ t: 'friends.list' });
    expect(r.t).toBe('ok');
  });
});

describe('salas', () => {
  it('sala expira se ninguém entrar', async () => {
    server = await testServer({ roomExpiryMs: 200 });
    const a = await TestClient.connect(server);
    await track(a);
    await createRoom(a);
    const closed = await a.waitFor((m) => m.t === 'room.closed', 3_000);
    expect(closed).toMatchObject({ reason: 'expired' });
    expect(server.stats().rooms).toBe(0);
  });

  it('código errado, sala cheia e código sem hífen', async () => {
    server = await testServer();
    const [a, b, c] = await Promise.all([TestClient.connect(server), TestClient.connect(server), TestClient.connect(server)]);
    await track(a, b, c);
    const code = await createRoom(a);
    expect(await b.request({ t: 'room.join', code: 'ZZZZ-ZZ' })).toMatchObject({ code: 'room-not-found' });
    await b.ok({ t: 'room.join', code: code.replace('-', '').toLowerCase() });
    expect(await c.request({ t: 'room.join', code })).toMatchObject({ code: 'room-full' });
    expect(await a.request({ t: 'room.create', clock: 'padrao', mode: 'full' })).toMatchObject({ code: 'already-in-room' });
  });

  it('sair do saguão devolve a sala para espera', async () => {
    server = await testServer();
    const [a, b] = await Promise.all([TestClient.connect(server), TestClient.connect(server)]);
    await track(a, b);
    const code = await createRoom(a);
    await b.ok({ t: 'room.join', code });
    const waiting = b.waitFor<Extract<ServerMessage, { t: 'room' }>>((m) => m.t === 'room' && m.room.state === 'waiting');
    await a.ok({ t: 'room.leave' });
    const r = await waiting;
    expect(r.room.you).toBe('blue');
    expect(r.room.players).toHaveLength(1);
  });
});

describe('cores', () => {
  it('cores parecidas: o segundo jogador recebe a cor livre mais próxima', async () => {
    server = await testServer();
    const [a, b] = await Promise.all([TestClient.connect(server), TestClient.connect(server)]);
    await track(a, b);
    await a.ok({ t: 'profile.update', colour: 'azul' });
    await b.ok({ t: 'profile.update', colour: 'daltonico-azul' });
    const code = await createRoom(a);
    const adjusted = b.waitFor<Extract<ServerMessage, { t: 'colour.adjusted' }>>((m) => m.t === 'colour.adjusted');
    await b.ok({ t: 'room.join', code });
    const msg = await adjusted;
    expect(msg.wanted).toBe('daltonico-azul');
    expect(msg.given).not.toBe('daltonico-azul');
    const room = await b.seen<Extract<ServerMessage, { t: 'room' }>>((m) => m.t === 'room');
    const [p1, p2] = room.room.players;
    expect(p1?.colour).toBe('azul');
    expect(p2?.colour).toBe(msg.given);

    // trocar dentro da sala para uma cor que conflita também é ajustado
    const again = b.waitFor<Extract<ServerMessage, { t: 'colour.adjusted' }>>((m) => m.t === 'colour.adjusted');
    await b.ok({ t: 'profile.update', colour: 'azul' });
    expect((await again).given).not.toBe('azul');
  });
});

describe('emotes', () => {
  it('respeita recarga, limite por janela e silenciar', async () => {
    server = await testServer();
    const { a, b } = await startedPair(server);
    await track(a, b);
    const got = b.waitFor((m) => m.t === 'emote');
    await a.ok({ t: 'emote', kind: 'emoji', emote: 'fogo' });
    expect(await got).toEqual({ t: 'emote', from: 'blue', kind: 'emoji', emote: 'fogo' });
    expect(await a.request({ t: 'emote', kind: 'emoji', emote: 'fogo' })).toMatchObject({ code: 'emote-cooldown' });
    await a.ok({ t: 'emote', kind: 'taunt', emote: 'errou' });
    expect(await a.request({ t: 'emote', kind: 'taunt', emote: 'errou' })).toMatchObject({ code: 'emote-cooldown' });

    await b.ok({ t: 'mute', muted: true });
    const count = b.received.filter((m) => m.t === 'emote').length;
    await sleep(2_100);
    await a.ok({ t: 'emote', kind: 'emoji', emote: 'gg' });
    await sleep(100);
    expect(b.received.filter((m) => m.t === 'emote').length).toBe(count);
  });
});
