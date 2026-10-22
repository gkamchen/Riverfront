import { afterEach, describe, expect, it } from 'vitest';
import { FACTION_IDS, FACTIONS, TIDE, type FactionId, type MutatorId, type PlayerView } from '@riverfront/core';
import type { ServerMessage } from '@riverfront/protocol';
import type { RunningServer } from '../src/index.ts';
import { createRoom, isEvent, settle, shoot, TestClient, testServer } from './helpers.ts';

let server: RunningServer | null = null;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate();
  await server?.close();
  server = null;
});

const factionWith = (test: (id: FactionId) => boolean): FactionId | undefined => FACTION_IDS.find(test);
const TOWER = factionWith((id) => FACTIONS[id].extraPiece?.role === 'tower');
const PROBE = factionWith((id) => FACTIONS[id].specialShot?.kind === 'probe');
const PRECISE = factionWith((id) => FACTIONS[id].specialShot?.kind === 'precise');

const events = (c: TestClient) => c.received.filter((m) => m.t === 'match.event').length;

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!['serverTime', 'now', 'turnStartedAt'].includes(k)) out[k] = strip(v);
    return out;
  }
  return value;
}

interface Scenario {
  readonly red: FactionId;
  readonly mutators: readonly MutatorId[];
  readonly rounds: number;
}

/**
 * O azul só atira em rochas do vermelho (resultado igual com qualquer layout);
 * o vermelho usa os poderes da facção contra o azul e depois erra de propósito
 * em terra. Com dois layouts diferentes do vermelho, tudo o que o azul recebe
 * tem que ser igual.
 */
async function play(s: RunningServer, scenario: Scenario, redAutos: number) {
  const a = await TestClient.connect(s);
  const b = await TestClient.connect(s);
  clients.push(a, b);
  const roomMsg = a.waitFor<Extract<ServerMessage, { t: 'room' }>>((m) => m.t === 'room');
  await a.ok({ t: 'room.create', clock: 'unlimited', mode: 'completo', mutators: scenario.mutators });
  const code = (await roomMsg).room.code;
  await b.ok({ t: 'room.join', code });
  await b.ok({ t: 'faction', faction: scenario.red });
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

  const blueOwn = (a.view as PlayerView).own;
  const cols = (a.view as PlayerView).config.cols;
  const unitCell = blueOwn.cells.find((c) => c.pieceId && c.row > 1 && c.col > 1 && c.col < cols - 2) ?? blueOwn.cells.find((c) => c.pieceId);
  const blueEarth = blueOwn.cells.filter((c) => c.terrain === 'earth' && !c.pieceId && !TIDE.rows.includes(c.row));
  const redRocks = (b.view as PlayerView).own.cells.filter((c) => c.terrain === 'rock' && !TIDE.rows.includes(c.row));
  let earth = 0;
  let radarDone = false;
  const redTry = async (msg: Parameters<TestClient['request']>[0]) => {
    const before: [number, number] = [events(a), events(b)];
    const r = await b.request(msg);
    if (r.t === 'ok') await settle(a, b, before);
  };

  let rocks = 0;
  for (let turn = 0; turn < scenario.rounds * 2; turn++) {
    const view = a.view as PlayerView;
    if (view.phase !== 'playing') break;
    if (view.turn === 'blue') {
      const rock = redRocks[rocks++];
      if (!rock) throw new Error('poucas rochas');
      await shoot(a, b, a, { col: rock.col, row: rock.row });
      continue;
    }
    if (unitCell) {
      const target = { col: unitCell.col, row: unitCell.row };
      if (scenario.red === PRECISE && !radarDone) {
        await redTry({ t: 'ability', request: { ability: 'radar', target } });
        radarDone = true;
      } else {
        await redTry({ t: 'special', request: { target } });
      }
    }
    while ((b.view as PlayerView).turn === 'red' && (b.view as PlayerView).phase === 'playing') {
      const cell = blueEarth[earth++];
      if (!cell) throw new Error('pouca terra');
      const known = (b.view as PlayerView).enemy.cells.find((c) => c.col === cell.col && c.row === cell.row);
      if (known?.state !== 'hidden') continue;
      await shoot(a, b, b, { col: cell.col, row: cell.row });
    }
  }
  const blueSaw = a.raw.map((r) => JSON.parse(r) as ServerMessage).filter((m) => m.t === 'match.state' || m.t === 'match.event');
  return { a, b, blueSaw, redLayout: (b.view as PlayerView).own.pieces.map((p) => p.cells) };
}

async function differential(scenario: Scenario) {
  const runs = [];
  for (const redAutos of [1, 2]) {
    const s = await testServer({ matchSeed: () => 777, rate: { burst: 1_000, perSecond: 1_000 } });
    try {
      runs.push(await play(s, scenario, redAutos));
    } finally {
      await s.close();
    }
  }
  const [one, two] = runs as [Awaited<ReturnType<typeof play>>, Awaited<ReturnType<typeof play>>];
  expect(two.redLayout).not.toEqual(one.redLayout);
  expect(strip(two.blueSaw)).toEqual(strip(one.blueSaw));
  return one;
}

describe('sigilo com as regras novas', () => {
  it.skipIf(!TOWER)('torre automática, maré e neblina: o azul recebe o mesmo com layouts diferentes do vermelho', async () => {
    const run = await differential({ red: TOWER as FactionId, mutators: ['mare', 'neblina'], rounds: 14 });
    const kinds = run.blueSaw.flatMap((m) => (m.t === 'match.event' ? [m.event.kind] : []));
    expect(kinds).toContain('tower');
    expect(kinds).toContain('tide');
    // os dois lados recebem a torre e a maré
    expect(run.b.received.some(isEvent('tower'))).toBe(true);
    expect(run.b.received.some(isEvent('tide'))).toBe(true);
  }, 60_000);

  it.skipIf(!PROBE)('sonda do adversário: resultado só para quem usou, o resto idêntico', async () => {
    const run = await differential({ red: PROBE as FactionId, mutators: [], rounds: 6 });
    const specials = run.blueSaw.flatMap((m) => (m.t === 'match.event' && m.event.kind === 'special' ? [m.event] : []));
    expect(specials.length).toBeGreaterThan(0);
    for (const e of specials) expect(e.kind === 'special' && e.outcome).toBeNull();
    // e nada de sonda no histórico do azul
    const last = run.a.view as PlayerView;
    for (const h of last.history) if (h.kind === 'special' && h.by === 'red') expect(h.outcome).toBeNull();
    expect(last.intel.probes ?? []).toEqual([]);
  }, 60_000);

  it.skipIf(!PRECISE)('tiro certeiro do adversário não depende do layout dele', async () => {
    const run = await differential({ red: PRECISE as FactionId, mutators: [], rounds: 6 });
    expect(run.blueSaw.some((m) => m.t === 'match.event' && m.event.kind === 'ability' && m.event.outcome === null)).toBe(true);
  }, 60_000);
});

describe('neblina', () => {
  it('erros antigos não voltam no histórico enviado', async () => {
    server = await testServer({ rate: { burst: 1_000, perSecond: 1_000 } });
    const run = await play(server, { red: 'neutra', mutators: ['neblina'], rounds: 10 }, 1);
    const view = run.a.view as PlayerView;
    const cols = view.config.cols;
    const fired = run.blueSaw.filter((m) => m.t === 'match.event' && m.event.kind === 'shot' && m.event.outcome.attacker === 'blue').length;
    const ownShots = view.history.filter((h) => h.kind === 'shot' && h.by === 'blue');
    expect(fired).toBeGreaterThan(ownShots.length);
    for (const h of ownShots) {
      if (h.kind !== 'shot') continue;
      expect(view.enemy.cells[h.report.target.row * cols + h.report.target.col]?.state).not.toBe('hidden');
    }
    // o estado completo (reconexão) também vem sem eles
    const state = run.a.waitFor<Extract<ServerMessage, { t: 'match.state' }>>((m) => m.t === 'match.state');
    await run.a.ok({ t: 'sync' });
    expect((await state).view.history.filter((h) => h.kind === 'shot' && h.by === 'blue').length).toBe(ownShots.length);
  }, 60_000);
});

describe('modos e tamanho', () => {
  it('modo rápido 15×5, apelidos em português e tamanho inválido', async () => {
    server = await testServer();
    const a = await TestClient.connect(server);
    const b = await TestClient.connect(server);
    clients.push(a, b);
    expect(await a.request({ t: 'room.create', clock: 'padrao', mode: 'classico', size: { cols: 30, rows: 4 } })).toMatchObject({ code: 'bad-message' });
    expect(await a.request({ t: 'room.create', clock: 'padrao', mode: 'turbo' as never })).toMatchObject({ code: 'bad-message' });
    const code = await createRoom(a, { mode: 'rapido' });
    await b.ok({ t: 'room.join', code });
    await a.ok({ t: 'ready', ready: true });
    await b.ok({ t: 'ready', ready: true });
    await a.seen((m) => m.t === 'match.state');
    expect(a.view?.config.cols).toBe(15);
    expect(a.view?.config.rows).toBe(5);
    expect(a.view?.own.cells).toHaveLength(75);
  });

  it('campo com tamanho personalizado', async () => {
    server = await testServer();
    const a = await TestClient.connect(server);
    const b = await TestClient.connect(server);
    clients.push(a, b);
    const room = a.waitFor<Extract<ServerMessage, { t: 'room' }>>((m) => m.t === 'room');
    await a.ok({ t: 'room.create', clock: 'padrao', mode: 'classic', size: { cols: 20, rows: 6 } });
    const info = (await room).room;
    expect(info.size).toEqual({ cols: 20, rows: 6 });
    await b.ok({ t: 'room.join', code: info.code });
    await a.ok({ t: 'ready', ready: true });
    await b.ok({ t: 'ready', ready: true });
    await a.seen((m) => m.t === 'match.state');
    expect(a.view?.own.cells).toHaveLength(120);
  });
});
