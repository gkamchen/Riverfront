import { afterEach, describe, expect, it } from 'vitest';
import {
  CAMPAIGN,
  dailyChallenge,
  dailyMatchOptions,
  emptyDailyBoard,
  Match,
  missionMatchOptions,
  type LogEntry,
  type MatchOptions,
} from '@riverfront/core';
import { opponentLayoutSeed, type ServerMessage } from '@riverfront/protocol';
import { MemoryStore, type RunningServer } from '../src/index.ts';
import { TestClient, testServer } from './helpers.ts';

let server: RunningServer | null = null;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate();
  await server?.close();
  server = null;
});

/**
 * Joga uma partida local completa como o cliente faria: os dois lados com
 * layout automático, cada um atirando na primeira célula desconhecida, um
 * segundo de "pensamento" por jogada (bem dentro do prazo do turno).
 */
function localGame(options: MatchOptions, stepMs = 1_000, blueSkip = 0): LogEntry[] {
  const m = new Match({ ...options, startTime: 0 });
  let now = 0;
  const shot = { blue: new Set<number>(), red: new Set<number>() };
  for (const p of ['blue', 'red'] as const) {
    now += stepMs;
    m.tick(now);
    // o adversário fica onde o servidor espera (semente fixa)
    if (p === 'red') m.autoPlace(p, opponentLayoutSeed(options.seed));
    else m.autoPlace(p);
    m.confirm(p);
  }
  // `blueSkip`: o azul atira de trás para a frente (perde mais tiros), para variar a pontuação
  for (let i = 0; i < 2_000 && m.phase === 'playing'; i++) {
    now += stepMs;
    m.tick(now);
    if (m.phase !== 'playing') break;
    const p = m.turn;
    // nunca repete alvo (com neblina um erro antigo volta a parecer oculto) e pula o que a maré cobre
    let cells = m.viewFor(p).enemy.cells.filter((c) => (c.state === 'hidden' || c.state === 'spotted') && !shot[p].has(c.row * 100 + c.col));
    if (p === 'blue' && blueSkip) cells = cells.reverse();
    const hit = cells.find((c) => m.attack(p, { col: c.col, row: c.row }).ok);
    if (!hit) break;
    shot[p].add(hit.row * 100 + hit.col);
  }
  return [...m.log];
}

/**
 * Relógio fixo num dia conhecido (meio-dia UTC) que anda normalmente a partir
 * daí: os testes não dependem do dia em que rodam nem do desafio desse dia.
 */
const FIXED_DAY = '2026-10-21';
function fixedNow(): () => number {
  const base = Date.UTC(2026, 9, 21, 12);
  const t0 = Date.now();
  return () => base + (Date.now() - t0);
}

/** Partida em que o azul desiste logo depois de posicionar: pontuação 0, sempre. */
function surrenderGame(options: MatchOptions): LogEntry[] {
  const m = new Match({ ...options, startTime: 0 });
  m.tick(1_000);
  for (const p of ['blue', 'red'] as const) {
    if (p === 'red') m.autoPlace(p, opponentLayoutSeed(options.seed));
    else m.autoPlace(p);
    m.confirm(p);
  }
  m.tick(2_000);
  m.surrender('blue');
  return [...m.log];
}

async function player(s: RunningServer, name: string): Promise<TestClient> {
  const c = await TestClient.connect(s, { name });
  clients.push(c);
  return c;
}

describe('desafio diário', () => {
  it('aceita uma partida válida, calcula a pontuação no servidor e monta a tabela', async () => {
    server = await testServer({ now: fixedNow() });
    const today = FIXED_DAY;
    const a = await player(server, 'Lia');
    const got = a.waitFor<Extract<ServerMessage, { t: 'daily' }>>((m) => m.t === 'daily');
    await a.ok({ t: 'daily.get' });
    const daily = await got;
    expect(daily.challenge).toEqual(dailyChallenge(today));
    expect(daily.board).toEqual([]);

    const log = localGame(dailyMatchOptions(daily.challenge, 0));
    const result = a.waitFor<Extract<ServerMessage, { t: 'daily.result' }>>((m) => m.t === 'daily.result');
    await a.ok({ t: 'daily.submit', date: today, log });
    const r = await result;
    expect(r.rank).toBe(1);
    expect(r.entry.score).toBeGreaterThan(0);
    expect(r.entry.name).toMatch(/^Lia#\d{4}$/);
    const shots = log.filter((e) => e.player === 'blue' && (e.type === 'attack' || e.type === 'special')).length;
    expect(r.entry.shots).toBe(shots);
    expect(r.entry.timeMs).toBe(log.at(-1)?.at);

    // outra pessoa desiste logo (pontuação 0): fica em 2º; a tabela também sai por HTTP
    const b = await player(server, 'Rui');
    const rui = b.waitFor<Extract<ServerMessage, { t: 'daily.result' }>>((m) => m.t === 'daily.result');
    await b.ok({ t: 'daily.submit', date: today, log: surrenderGame(dailyMatchOptions(daily.challenge, 0)) });
    expect((await rui).entry).toMatchObject({ won: false, score: 0 });
    const http = (await (await fetch(`http://127.0.0.1:${server.port}/api/daily`)).json()) as { board: { name: string }[] };
    expect(http.board.map((e) => e.name)).toEqual([r.entry.name, expect.stringMatching(/^Rui#/)]);
  });

  it('recusa logs adulterados', async () => {
    server = await testServer({ now: fixedNow() });
    const today = FIXED_DAY;
    const a = await player(server, 'Teo');
    const log = localGame(dailyMatchOptions(dailyChallenge(today), 0));
    const reject = async (bad: LogEntry[], reason: RegExp) => {
      const r = await a.request({ t: 'daily.submit', date: today, log: bad });
      expect(r).toMatchObject({ t: 'error', code: 'replay-rejected' });
      if (r.t === 'error') expect(r.detail).toMatch(reason);
    };

    // tiro repetido numa célula já revelada
    const attacks = log.flatMap((e, i) => (e.type === 'attack' && e.player === 'blue' ? [i] : []));
    const [i1, i2] = attacks as [number, number];
    const repeated = log.map((e, i) => (i === i2 ? { ...e, target: (log[i1] as Extract<LogEntry, { type: 'attack' }>).target } : e));
    await reject(repeated, /recusada/);
    // o bot "desistiu"
    await reject([...log.slice(0, 10), { type: 'surrender', player: 'red', at: (log[9] as LogEntry).at }], /adversário/);
    // jogada muito depois do prazo do turno, sem o estouro registrado
    const late = log.map((e, i) => (i >= i2 ? { ...e, at: e.at + 600_000 } : e));
    await reject(late, /prazo/);
    // estouro de tempo inventado
    await reject([...log.slice(0, i2), { type: 'timeout', player: 'blue', at: (log[i2] as LogEntry).at }, ...log.slice(i2)], /estouro/);
    // adversário posicionado pelo cliente (outra semente, ou layout escolhido)
    const redAuto = log.findIndex((e) => e.type === 'auto' && e.player === 'red');
    await reject(log.map((e, i) => (i === redAuto ? { ...e, seed: 12345 } : e)), /adversário/);
    const redLayout = new Match({ ...dailyMatchOptions(dailyChallenge(today), 0) }).autoPlace('red', 999);
    if (redLayout.ok) {
      const swapped = log.map((e, i) => (i === redAuto ? { type: 'layout' as const, player: 'red' as const, placements: redLayout.placements, at: e.at } : e));
      await reject(swapped, /adversário/);
    }
    // partida pela metade
    await reject(log.slice(0, Math.floor(log.length / 2)), /não terminou/);
    // tempo voltando
    await reject(log.map((e, i) => (i === 5 ? { ...e, at: 0 } : e)), /ordem/);

    // dia futuro e dia antigo
    const tomorrow = '2026-10-22';
    expect(await a.request({ t: 'daily.submit', date: tomorrow, log })).toMatchObject({ code: 'wrong-state' });
    expect(await a.request({ t: 'daily.get', date: '2020-01-01' })).toMatchObject({ code: 'wrong-state' });
    // nada entrou na tabela
    const got = a.waitFor<Extract<ServerMessage, { t: 'daily' }>>((m) => m.t === 'daily');
    await a.ok({ t: 'daily.get' });
    expect((await got).board).toEqual([]);
  });

  it('guarda só os últimos dias e limita envios por dia', async () => {
    const store = new MemoryStore();
    server = await testServer({ store, now: fixedNow() });
    await store.saveDailyBoard(emptyDailyBoard('2020-01-01'));
    const today = FIXED_DAY;
    const a = await player(server, 'Ivo');
    const log = localGame(dailyMatchOptions(dailyChallenge(today), 0));
    await a.ok({ t: 'daily.submit', date: today, log });
    expect(await store.getDailyBoard('2020-01-01')).toBeNull();
    expect(await store.getDailyBoard(today)).not.toBeNull();
    for (let i = 1; i < 20; i++) await a.ok({ t: 'daily.submit', date: today, log });
    expect(await a.request({ t: 'daily.submit', date: today, log })).toMatchObject({ code: 'rate-limited' });
  });
});

describe('campanha', () => {
  const arc = CAMPAIGN.find((a) => a.wave === 1);
  if (!arc) throw new Error('sem arco da onda 1');
  const [m1, m2] = arc.missions;

  it('sincroniza progresso válido e recusa progresso impossível', async () => {
    server = await testServer();
    const a = await player(server, 'Nara');
    const empty = a.waitFor<Extract<ServerMessage, { t: 'campaign' }>>((m) => m.t === 'campaign');
    await a.ok({ t: 'campaign.get' });
    expect((await empty).campaign).toBeNull();

    const ok = { version: 1 as const, missions: { [m1!.id]: { won: true, stars: 1 as const, bestShots: 999, attempts: 2 } } };
    const synced = a.waitFor<Extract<ServerMessage, { t: 'campaign' }>>((m) => m.t === 'campaign');
    await a.ok({ t: 'campaign.sync', progress: ok });
    expect((await synced).campaign?.progress.missions[m1!.id]).toMatchObject({ won: true, attempts: 2 });

    // segunda missão vencida sem a primeira, ou estrelas que os tiros não permitem
    const skip = { version: 1 as const, missions: { [m2!.id]: { won: true, stars: 1 as const, bestShots: 50, attempts: 1 } } };
    const b = await player(server, 'Otto');
    expect(await b.request({ t: 'campaign.sync', progress: skip })).toMatchObject({ code: 'campaign-invalid' });
    const stars = { version: 1 as const, missions: { [m1!.id]: { won: true, stars: 3 as const, bestShots: 999, attempts: 1 } } };
    expect(await b.request({ t: 'campaign.sync', progress: stars })).toMatchObject({ code: 'campaign-invalid' });
  });

  it('missão com log é refeita no servidor e marcada como verificada', async () => {
    server = await testServer();
    const a = await player(server, 'Pia');
    const options = missionMatchOptions(m1!.id, 0);
    if (!options) throw new Error('sem missão');
    // joga até o azul vencer (variando a semente do layout não dá; o resultado é o que for)
    const log = localGame(options);
    const done = a.waitFor<Extract<ServerMessage, { t: 'campaign' }>>((m) => m.t === 'campaign');
    await a.ok({ t: 'campaign.result', mission: m1!.id, log });
    const campaign = (await done).campaign;
    expect(campaign?.progress.missions[m1!.id]?.attempts).toBe(1);
    const won = campaign?.progress.missions[m1!.id]?.won;
    expect(campaign?.verified.includes(m1!.id)).toBe(won);
    // missão bloqueada
    const options2 = missionMatchOptions(m2!.id, 0);
    if (!won && options2) {
      expect(await a.request({ t: 'campaign.result', mission: m2!.id, log: localGame(options2) })).toMatchObject({ code: 'campaign-invalid' });
    }
    expect(await a.request({ t: 'campaign.result', mission: m1!.id, log: log.slice(0, 5) })).toMatchObject({ code: 'replay-rejected' });
  });
});
