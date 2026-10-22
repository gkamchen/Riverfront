import { describe, expect, it } from 'vitest';
import {
  FACTIONS,
  FACTION_IDS,
  FULL_CONFIG,
  LayoutBoard,
  Match,
  TOWER_PERIOD,
  autoPlace,
  buildPieces,
  createRng,
  generateTerrain,
  hashSeed,
  startAutoMatch,
  type FactionId,
  type FieldConfig,
  type LogEntry,
  type MutatorId,
} from '../src/index.ts';
import { miss, piecesOf } from './helpers.ts';
import { playRandom } from './random-play.ts';

const SIZE = { cols: 25, rows: 7 };

describe('auto tower', () => {
  it('fires at the start of every 5th own turn, at a cell not uncovered yet, and both sides see it', () => {
    const match = startAutoMatch({ seed: 2, factions: { blue: 'grecia' } });
    expect(match.viewFor('blue').own.faction?.tower).toEqual({ alive: 1, nextFireIn: TOWER_PERIOD - 1 });
    expect(match.viewFor('red').enemy.faction?.tower).toEqual({ alive: 1, nextFireIn: TOWER_PERIOD - 1 });
    // Blue's turns 1..4 pass; the 5th own turn starts with a tower shot.
    for (let i = 0; i < 2 * (TOWER_PERIOD - 1); i++) miss(match);
    const before = match.log.filter((e) => e.type === 'tower');
    expect(before).toHaveLength(1);
    const shot = before[0] as Extract<LogEntry, { type: 'tower' }>;
    const entries = match.viewFor('red').history.filter((h) => h.kind === 'tower');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'tower', by: 'blue', report: { target: shot.target } });
    expect(match.viewFor('blue').history.filter((h) => h.kind === 'tower')).toEqual(entries);
    expect(match.viewFor('blue').own.faction?.tower?.nextFireIn).toBe(TOWER_PERIOD);
    expect(match.turn).toBe('blue');
  });

  it('a destroyed tower stops firing', () => {
    const match = startAutoMatch({ seed: 2, factions: { red: 'grecia' } });
    const tower = piecesOf(match, 'red', 'tower')[0]!;
    match.attack('blue', tower.cells[0]!);
    while (match.turn === 'blue') miss(match);
    for (let i = 0; i < 4 * TOWER_PERIOD; i++) miss(match);
    expect(match.log.some((e) => e.type === 'tower')).toBe(false);
    expect(match.viewFor('blue').enemy.faction?.tower?.alive).toBe(0);
  });

  it('is deterministic from the seed', () => {
    const run = () => {
      const m = startAutoMatch({ seed: 21, factions: { blue: 'grecia', red: 'grecia' } });
      for (let i = 0; i < 30; i++) miss(m);
      return m.log.filter((e) => e.type === 'tower');
    };
    expect(run()).toEqual(run());
    expect(run().length).toBeGreaterThanOrEqual(5);
  });
});

describe('replay with factions, towers, mutators and special shots', () => {
  const combos: { factions: Partial<Record<'blue' | 'red', FactionId>>; mutators: MutatorId[] }[] = [
    { factions: { blue: 'egito', red: 'grecia' }, mutators: ['mare'] },
    { factions: { blue: 'roma', red: 'egito' }, mutators: ['neblina'] },
    { factions: { blue: 'grecia', red: 'roma' }, mutators: ['tiro-duplo', 'mare'] },
    { factions: { blue: 'chineses', red: 'partos' }, mutators: ['mare', 'neblina'] },
    { factions: { blue: 'hunos', red: 'macedonios' }, mutators: [] },
  ];

  it('rebuilds the exact state from the record (JSON round trip)', () => {
    let towers = 0;
    let specials = 0;
    combos.forEach((combo, i) => {
      for (let seed = 1; seed <= 4; seed++) {
        const live = startAutoMatch({ seed: seed * 7 + i, factions: combo.factions, mutators: combo.mutators });
        playRandom(live, seed * 31 + i);
        expect(live.phase).toBe('finished');
        towers += live.log.filter((e) => e.type === 'tower').length;
        specials += live.log.filter((e) => e.type === 'special').length;
        const record = JSON.parse(JSON.stringify(live.toRecord()));
        const copy = Match.fromRecord(record);
        expect(copy.serverState()).toEqual(live.serverState());
        for (const p of ['blue', 'red'] as const) expect(JSON.stringify(copy.viewFor(p))).toBe(JSON.stringify(live.viewFor(p)));
      }
    });
    expect(towers).toBeGreaterThan(0);
    expect(specials).toBeGreaterThan(0);
  });

  it('a tampered tower entry is caught', () => {
    const live = startAutoMatch({ seed: 2, factions: { blue: 'grecia' } });
    for (let i = 0; i < 12; i++) miss(live);
    const log = live.log.map((e) =>
      e.type === 'tower' ? { ...e, target: { col: (e.target.col + 1) % 25, row: e.target.row } } : e,
    );
    expect(() => Match.fromLog(2, 'full', log, { factions: { blue: 'grecia' } })).toThrow(/tower/);
  });
});

describe('placement property (500 seeds)', () => {
  it('autoPlace always gives a legal layout for every faction army', () => {
    // Distinct armies across the registry: the preset alone, or with the faction's extra pieces.
    const armies = new Map<string, FieldConfig>();
    for (const id of FACTION_IDS) {
      const extra = FACTIONS[id].extraPiece;
      const units = extra ? [...FULL_CONFIG.units, { role: extra.role, count: extra.count }] : FULL_CONFIG.units;
      armies.set(JSON.stringify(units), { ...FULL_CONFIG, units });
    }
    expect(armies.size).toBe(2);
    for (const [, config] of armies) {
      const pieces = buildPieces(config);
      for (let seed = 0; seed < 500; seed++) {
        const terrain = generateTerrain(SIZE, config.rocks, pieces, createRng(hashSeed(seed, 'terrain')));
        const layout = autoPlace(SIZE, terrain, pieces, createRng(seed));
        const board = new LayoutBoard(SIZE, terrain, pieces);
        expect(board.applyLayout(layout)).toBeNull();
        const tower = pieces.findIndex((p) => p.role === 'tower');
        if (tower >= 0) for (const c of board.cellsOf(tower)) expect(Math.floor(c / 25)).toBeGreaterThanOrEqual(5);
      }
    }
  }, 60_000);

  it('every faction match can be auto-placed and confirmed', () => {
    for (const id of FACTION_IDS) {
      for (let seed = 0; seed < 20; seed++) {
        const m = new Match({ seed, factions: { blue: id, red: id } });
        for (const p of ['blue', 'red'] as const) {
          expect(m.autoPlace(p).ok).toBe(true);
          expect(m.confirm(p)).toEqual({ ok: true });
        }
        expect(m.phase).toBe('playing');
      }
    }
  });
});
