import { afterEach, describe, expect, it } from 'vitest';
import { seatForTurn, type ClockConfig, type SeatId, type TeamView } from '@riverfront/core';
import type { PackedView, ServerMessage } from '@riverfront/protocol';
import type { RunningServer, ServerOptions } from '../src/index.ts';
import { isEvent, sleep, TestClient, testServer } from './helpers.ts';

let server: RunningServer | null = null;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate();
  await server?.close();
  server = null;
});

type Table = Record<SeatId, TestClient>;
const ORDER: readonly SeatId[] = ['blue-1', 'red-1', 'blue-2', 'red-2'];
const view = (c: TestClient) => c.view as TeamView;
const events = (c: TestClient) => c.received.filter((m) => m.t === 'match.event').length;

/** Quatro jogadores numa sala de duplas: entram na ordem azul-1, vermelho-1, azul-2, vermelho-2. */
async function table(s: RunningServer, opts: { clock?: 'relampago' | 'unlimited'; mode?: 'classic' | 'full'; mutators?: ('mare' | 'neblina')[] } = {}): Promise<{ t: Table; code: string }> {
  const players: TestClient[] = [];
  for (const name of ['Ana', 'Bia', 'Caio', 'Davi']) {
    const c = await TestClient.connect(s, { name });
    players.push(c);
    clients.push(c);
  }
  const [a, b, c, d] = players as [TestClient, TestClient, TestClient, TestClient];
  const room = a.waitFor<Extract<ServerMessage, { t: 'room' }>>((m) => m.t === 'room');
  await a.ok({ t: 'room.create', clock: opts.clock ?? 'unlimited', mode: opts.mode ?? 'classic', format: 'doubles', mutators: opts.mutators ?? [] });
  const code = (await room).room.code;
  for (const p of [b, c, d]) await p.ok({ t: 'room.join', code });
  return { t: { 'blue-1': a, 'red-1': b, 'blue-2': c, 'red-2': d }, code };
}

async function startAll(t: Table, autos: Partial<Record<SeatId, number>> = {}): Promise<void> {
  for (const s of ORDER) await t[s].ok({ t: 'ready', ready: true });
  for (const s of ORDER) await t[s].seen((m) => m.t === 'match.state');
  const started = Promise.all(ORDER.map((s) => t[s].waitFor(isEvent('start'))));
  for (const s of ['blue-1', 'blue-2', 'red-1', 'red-2'] as const) {
    for (let i = 0; i < (autos[s] ?? 1); i++) await t[s].ok({ t: 'placement.auto' });
  }
  for (const s of ORDER) await t[s].ok({ t: 'placement.submit', placements: [], confirm: true });
  await started;
}

/** Quem está na vez joga `target`; espera os quatro receberem o evento. */
async function play(t: Table, target: (shooter: SeatId) => { col: number; row: number } | null): Promise<boolean> {
  const v = view(t['blue-1']);
  if (v.phase !== 'playing') return false;
  const seat = v.doubles.seatOnTurn as SeatId;
  const cell = target(seat);
  if (!cell) throw new Error('sem alvo');
  const before = ORDER.map((s) => events(t[s]));
  await t[seat].ok({ t: 'attack', target: cell });
  for (const [i, s] of ORDER.entries()) if (events(t[s]) <= (before[i] as number)) await t[s].waitFor((m) => m.t === 'match.event');
  return true;
}

const firstHidden = (t: Table) => (seat: SeatId) => {
  const c = view(t[seat]).enemy.cells.find((x) => x.state === 'hidden' || x.state === 'spotted');
  return c ? { col: c.col, row: c.row } : null;
};

/** Nada do campo inimigo além do que já foi revelado, e nada de peças dos lugares inimigos. */
function assertNoEnemySecrets(raw: string): void {
  const msg = JSON.parse(raw) as ServerMessage;
  if (msg.t !== 'match.state' && msg.t !== 'match.event') {
    expect(raw).not.toMatch(/"(cells|placements|layout|terrain|pieceOwners)"/);
    return;
  }
  const v = msg.view as PackedView & { doubles?: TeamView['doubles'] };
  if (v.phase === 'finished') return;
  expect(v.enemy.layout).toBeNull();
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) return value.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (!value || typeof value !== 'object') return;
    const keys = Object.keys(value);
    expect(keys.includes('col') && keys.includes('row'), `coordenada em ${path}`).toBe(false);
    for (const key of keys) {
      expect(['placement', 'placements', 'pieces', 'terrain', 'anchor', 'occupant', 'pieceOwners'], `campo ${path}.${key}`).not.toContain(key);
      walk((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
  };
  const { cells: _c, destroyed: _d, layout: _l, ...rest } = v.enemy;
  walk(rest, 'enemy');
  walk(v.doubles?.enemy, 'doubles.enemy');
  for (const index of Object.keys(v.enemy.cells.roles)) expect(v.enemy.cells.state[Number(index)]).toBe('x');
  // dono de cada peça só do próprio time
  for (const owner of Object.values(v.doubles?.pieceOwners ?? {})) expect(owner.startsWith(v.player)).toBe(true);
}

describe('duplas', () => {
  it('partida completa: lugares, ordem A1 B1 A2 B2, parceiro vê o campo do time e o sigilo se mantém', async () => {
    server = await testServer({ rate: { burst: 2_000, perSecond: 2_000 } });
    const { t } = await table(server);
    const info = await t['red-2'].seen<Extract<ServerMessage, { t: 'room' }>>((m) => m.t === 'room' && m.room.players.length === 4);
    expect(info.room).toMatchObject({ format: 'doubles', you: 'red-2', state: 'lobby' });
    expect(await t['blue-1'].request({ t: 'seat.choose', seat: 'red-1' })).toMatchObject({ code: 'seat-taken' });

    await startAll(t);
    const blue1 = view(t['blue-1']);
    const blue2 = view(t['blue-2']);
    expect(blue1.doubles.seat).toBe('blue-1');
    expect(blue2.doubles.partner).toBe('blue-1');
    // o campo é do time: os dois parceiros veem as mesmas peças
    expect(blue2.own.pieces.map((p) => p.cells)).toEqual(blue1.own.pieces.map((p) => p.cells));
    expect(Object.values(blue1.doubles.pieceOwners)).toContain('blue-2');

    for (let i = 0; i < 4000 && (await play(t, firstHidden(t))); i++);
    expect(view(t['red-1']).phase).toBe('finished');
    // cada tiro foi dado pelo lugar da vez: A1, B1, A2, B2, A1...
    const shots = t['blue-1'].received.flatMap((m) => (m.t === 'match.event' && m.event.kind === 'shot' ? [m.event] : []));
    expect(shots.length).toBeGreaterThan(20);
    for (const e of shots) if (e.kind === 'shot') expect(e.seat).toBe(seatForTurn(e.outcome.turnNumber, 'blue'));
    expect(new Set(shots.map((e) => (e.kind === 'shot' ? e.seat : null)))).toEqual(new Set(ORDER));

    const ends = ORDER.map((s) => t[s].received.find(isEvent('end')));
    expect(new Set(ends.map((e) => JSON.stringify(e && e.t === 'match.event' ? e.event : null))).size).toBe(1);
    expect(view(t['blue-2']).enemy.layout).not.toBeNull();
    for (const s of ORDER) for (const raw of t[s].raw) assertNoEnemySecrets(raw);
  }, 120_000);

  it('cada lugar só posiciona as próprias peças', async () => {
    server = await testServer();
    const { t } = await table(server);
    for (const s of ORDER) await t[s].ok({ t: 'ready', ready: true });
    await t['blue-1'].seen((m) => m.t === 'match.state');
    await t['blue-2'].seen((m) => m.t === 'match.state');
    const partnerPiece = Object.entries(view(t['blue-1']).doubles.pieceOwners).find(([, owner]) => owner === 'blue-2')?.[0];
    if (!partnerPiece) throw new Error('sem peça do parceiro');
    const r = await t['blue-1'].request({ t: 'placement.submit', placements: [{ pieceId: partnerPiece, anchor: { col: 3, row: 3 }, rotation: 0 }], confirm: false });
    expect(r).toMatchObject({ code: 'match-error', detail: 'not-your-piece', message: 'Essa peça é do seu parceiro.' });
    // o parceiro recebe o campo atualizado quando o outro posiciona
    const update = t['blue-2'].waitFor((m) => m.t === 'match.state');
    await t['blue-1'].ok({ t: 'placement.auto' });
    await update;
    expect(view(t['blue-2']).own.pieces.some((p) => p.placement && view(t['blue-2']).doubles.pieceOwners[p.id] === 'blue-1')).toBe(true);
  });

  it('o que o time azul recebe é idêntico com dois layouts do time vermelho (layouts gêmeos)', async () => {
    const strip = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(strip);
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
          if (['serverTime', 'now', 'turnStartedAt', 'deadline', 'userId', 'tag', 'code', 'expiresAt', 'placementDeadline'].includes(k)) continue;
          out[k] = strip(v);
        }
        return out;
      }
      return value;
    };
    const run = async (redAutos: number) => {
      const s = await testServer({ matchSeed: () => 4242, rate: { burst: 2_000, perSecond: 2_000 } });
      try {
        const { t } = await table(s);
        await startAll(t, { 'red-1': redAutos });
        const redRocks = view(t['red-1']).own.cells.filter((c) => c.terrain === 'rock');
        const blueEarth = view(t['blue-1']).own.cells.filter((c) => c.terrain === 'earth' && !c.pieceId);
        let rock = 0;
        let earth = 0;
        for (let turn = 0; turn < 12; turn++) {
          await play(t, (seat) => {
            const list = seat.startsWith('blue') ? redRocks[rock++] : blueEarth[earth++];
            return list ? { col: list.col, row: list.row } : null;
          });
        }
        const saw = (seat: SeatId) => t[seat].raw.map((r) => JSON.parse(r) as ServerMessage).filter((m) => m.t === 'match.state' || m.t === 'match.event');
        return { blue1: strip(saw('blue-1')), blue2: strip(saw('blue-2')), red: view(t['red-1']).own.pieces.map((p) => p.cells) };
      } finally {
        for (const c of clients.splice(0)) c.ws.terminate();
        await s.close();
      }
    };
    const one = await run(1);
    const two = await run(2);
    expect(two.red).not.toEqual(one.red);
    expect(two.blue1).toEqual(one.blue1);
    expect(two.blue2).toEqual(one.blue2);
  }, 60_000);

  it('relógio por lugar: estouros na ordem dos lugares e o 3º seguido entrega a partida', async () => {
    const fast: ClockConfig = { id: 'relampago', turnMs: 120, bankMs: 0, maxConsecutiveStrikes: 3, maxStrikes: 5, graceDropMs: 45_000, graceTotalMs: 90_000 };
    server = await testServer({ clocks: { relampago: fast } as ServerOptions['clocks'] });
    const { t } = await table(server, { clock: 'relampago' });
    await startAll(t);
    const end = await t['red-2'].waitFor<Extract<ServerMessage, { t: 'match.event' }>>(isEvent('end'), 8_000);
    expect(end.event).toEqual({ kind: 'end', winner: 'red', reason: 'timeout' });
    const timeouts = t['red-2'].received.flatMap((m) => (m.t === 'match.event' && m.event.kind === 'timeout' ? [m.event] : []));
    expect(timeouts.map((e) => (e.kind === 'timeout' ? e.seat : null))).toEqual([...ORDER, ...ORDER, 'blue-1']);
    expect(timeouts.at(-1)).toMatchObject({ seat: 'blue-1', player: 'blue', forfeit: true, strikes: 3 });
  });

  it('queda e volta de um lugar; sem voltar, o time perde por abandono', async () => {
    const clock: ClockConfig = { id: 'unlimited', turnMs: null, bankMs: 0, maxConsecutiveStrikes: 3, maxStrikes: 5, graceDropMs: 500, graceTotalMs: 800 };
    server = await testServer({ clocks: { unlimited: clock } as ServerOptions['clocks'] });
    const { t } = await table(server);
    await startAll(t);
    const gone = t['blue-1'].waitFor<Extract<ServerMessage, { t: 'opponent' }>>((m) => m.t === 'opponent' && !m.connected);
    const c = t['blue-2'];
    c.ws.terminate();
    expect(await gone).toMatchObject({ seat: 'blue-2', connected: false });
    const back = await TestClient.connect(server, { auth: { userId: c.userId, token: c.token } });
    clients.push(back);
    expect(back.received[0]).toMatchObject({ t: 'welcome', resumed: true });
    await back.seen((m) => m.t === 'match.state');
    expect(view(back).doubles.seat).toBe('blue-2');
    const end = t['red-1'].waitFor<Extract<ServerMessage, { t: 'match.event' }>>(isEvent('end'), 5_000);
    back.ws.terminate();
    expect((await end).event).toEqual({ kind: 'end', winner: 'red', reason: 'abandon' });
  });

  it('emotes: só para o parceiro, para a mesa, e parceiro silenciado', async () => {
    server = await testServer();
    const { t } = await table(server);
    await t['blue-1'].ok({ t: 'emote', kind: 'emoji', emote: 'fogo', to: 'team' });
    await sleep(100);
    expect(t['blue-2'].received.filter((m) => m.t === 'emote')).toEqual([{ t: 'emote', from: 'blue-1', kind: 'emoji', emote: 'fogo', to: 'team' }]);
    expect(t['red-1'].received.some((m) => m.t === 'emote')).toBe(false);
    await t['blue-2'].ok({ t: 'mute', muted: true, who: 'partner' });
    await t['blue-1'].ok({ t: 'emote', kind: 'taunt', emote: 'errou', to: 'all' });
    await sleep(100);
    expect(t['red-1'].received.filter((m) => m.t === 'emote')).toHaveLength(1);
    expect(t['red-2'].received.filter((m) => m.t === 'emote')).toHaveLength(1);
    expect(t['blue-2'].received.filter((m) => m.t === 'emote')).toHaveLength(1);
    expect(await t['blue-1'].request({ t: 'emote', kind: 'taunt', emote: 'errou' })).toMatchObject({ code: 'emote-cooldown' });
  });

  it('trocar de lugar no saguão', async () => {
    server = await testServer();
    const { t } = await table(server);
    await t['red-2'].ok({ t: 'room.leave' });
    const moved = t['blue-2'].waitFor<Extract<ServerMessage, { t: 'room' }>>((m) => m.t === 'room' && m.room.you === 'red-2');
    await t['blue-2'].ok({ t: 'seat.choose', seat: 'red-2' });
    expect((await moved).room.players.map((p) => p.seat).sort()).toEqual(['blue-1', 'red-1', 'red-2']);
  });

  it('revanche com os quatro alterna o time que começa', async () => {
    server = await testServer();
    const { t } = await table(server);
    await startAll(t);
    await t['blue-2'].ok({ t: 'surrender' });
    await t['red-1'].seen(isEvent('end'));
    const next = t['blue-1'].waitFor<Extract<ServerMessage, { t: 'room' }>>((m) => m.t === 'room' && m.room.matchNumber === 2);
    for (const s of ORDER) await t[s].ok({ t: 'rematch', accept: true });
    const room = await next;
    expect(room.room.firstTurn).toBe('red');
    expect(room.room.state).toBe('placing');
  });
});
