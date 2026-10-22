import { describe, expect, it } from 'vitest';
import {
  FACTIONS,
  SHOT_KIND_IDS,
  coordOf,
  indexOf,
  neighbors4,
  shotCells,
  type FactionDef,
  type ShotKind,
} from '../src/index.ts';
import { cellsOf, miss, ready, sameCoord, skipTurns, terrainCells, unitCells } from './helpers.ts';

const SIZE = { cols: 25, rows: 7 };

/** A test faction that only carries one special shot of `kind` (free and unlimited). */
function tester(kind: ShotKind): FactionDef {
  return {
    ...FACTIONS.neutra,
    id: `teste-${kind}`,
    specialShot: { id: kind, name: kind, kind, energy: 0, cooldown: 0, charges: null, rechargeEnergy: null, description: '' },
  };
}

describe('shot patterns', () => {
  it('covers the documented cells and refuses shapes that leave the board', () => {
    const t = { col: 5, row: 3 };
    expect(shotCells(SIZE, 'single', { target: t })).toEqual([indexOf(SIZE, t)]);
    expect(shotCells(SIZE, 'line3', { target: t })).toEqual([80, 81, 82]);
    expect(shotCells(SIZE, 'line3', { target: t, axis: 'col' })).toEqual([80, 105, 130]);
    expect(shotCells(SIZE, 'line3', { target: { col: 23, row: 0 } })).toBeNull();
    expect(shotCells(SIZE, 'line3', { target: { col: 0, row: 5 }, axis: 'col' })).toBeNull();
    expect(shotCells(SIZE, 'cross', { target: t })).toHaveLength(5);
    expect(shotCells(SIZE, 'double', { target: t, second: { col: 7, row: 3 } })).toEqual([80, 82]);
    expect(shotCells(SIZE, 'double', { target: t, second: { col: 6, row: 3 } })).toBeNull();
    expect(shotCells(SIZE, 'double', { target: t, second: t })).toBeNull();
    expect(shotCells(SIZE, 'double', { target: t })).toBeNull();
    expect(shotCells(SIZE, 'probe', { target: { col: 25, row: 0 } })).toBeNull();
    expect(SHOT_KIND_IDS).toHaveLength(7);
  });
});

describe('sonda (Egypt probe)', () => {
  it('reveals a unit privately without hitting it and keeps the turn', () => {
    const match = ready({ seed: 3, factions: { blue: 'egito' } });
    const unit = unitCells(match, 'red')[0]!;
    const result = match.special('blue', { target: unit });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.shots).toEqual([]);
    expect(result.outcome.probe).toMatchObject({ target: unit, content: 'unit' });
    expect(match.turn).toBe('blue');
    expect(match.viewFor('blue').enemy.cells[indexOf(SIZE, unit)]?.state).toBe('spotted');
    expect(match.viewFor('blue').intel.probes).toHaveLength(1);
    expect(match.viewFor('red').own.cells[indexOf(SIZE, unit)]).toMatchObject({ struck: false, exposed: true });
    // The other side only learns that a probe was used.
    const entry = match.viewFor('red').history.find((h) => h.kind === 'special');
    expect(entry).toMatchObject({ kind: 'special', special: 'sonda', outcome: null });
    expect(JSON.stringify(match.viewFor('red').history)).not.toContain(`"col":${unit.col},"row":${unit.row}`);
  });

  it('shows earth and rock on the prober map only', () => {
    const match = ready({ seed: 3, factions: { blue: 'egito' } });
    const earth = terrainCells(match, 'red', 'earth')[0]!;
    expect(match.special('blue', { target: earth }).ok).toBe(true);
    expect(match.viewFor('blue').enemy.cells[indexOf(SIZE, earth)]?.state).toBe('earth');
    expect(match.viewFor('red').own.cells[indexOf(SIZE, earth)]?.struck).toBe(false);
  });

  it('one special per turn, cooldown, two charges, then energy only', () => {
    const match = ready({ seed: 3, factions: { blue: 'egito' } });
    // From the far end: the misses of skipTurns use the first earth cells.
    const earth = terrainCells(match, 'red', 'earth').reverse();
    skipTurns(match, 2);
    expect(match.special('blue', { target: earth[0]! }).ok).toBe(true);
    expect(match.special('blue', { target: earth[1]! })).toEqual({ ok: false, error: 'special-used' });
    expect(match.viewFor('blue').own.faction?.special).toMatchObject({ charges: 1, blocker: 'already-used' });
    const wait = 2 * FACTIONS.egito.specialShot!.cooldown;
    skipTurns(match, 2);
    expect(match.special('blue', { target: earth[1]! })).toEqual({ ok: false, error: 'cooldown' });
    skipTurns(match, wait - 2);
    expect(match.special('blue', { target: earth[0]! })).toEqual({ ok: false, error: 'already-revealed' });
    expect(match.special('blue', { target: earth[1]! }).ok).toBe(true);
    skipTurns(match, wait);
    const status = match.viewFor('blue').own.faction!.special!;
    expect(status.charges).toBe(0);
    expect(status.energy).toBe(FACTIONS.egito.specialShot!.rechargeEnergy);
    const before = match.viewFor('blue').own.energy;
    expect(match.special('blue', { target: earth[2]! }).ok).toBe(true);
    expect(match.viewFor('blue').own.energy).toBe(before - FACTIONS.egito.specialShot!.rechargeEnergy!);
  });
});

describe('tiro certeiro (Rome precise shot)', () => {
  it('needs a radar reading with units, then surely hits a unit of that block, with a cooldown', () => {
    const match = ready({ seed: 7, factions: { blue: 'roma' } });
    expect(match.viewFor('blue').own.faction?.special?.blocker).toBe('no-target');
    skipTurns(match, 2);
    const red = match.viewFor('red').own.cells;
    const center = red.find((c) => c.role !== null && c.row > 0 && c.col > 0 && c.role !== 'amphibian')!;
    expect(match.useAbility('blue', { ability: 'radar', target: center }).ok).toBe(true);
    const elsewhere = { col: (center.col + 5) % 25, row: center.row };
    expect(match.special('blue', { target: elsewhere })).toEqual({ ok: false, error: 'invalid-target' });
    const shot = match.special('blue', { target: center });
    expect(shot.ok).toBe(true);
    if (!shot.ok) return;
    const report = shot.outcome.shots[0]!;
    expect(['hit', 'destroyed', 'shield']).toContain(report.result);
    expect(Math.abs(report.target.col - center.col)).toBeLessThanOrEqual(1);
    expect(Math.abs(report.target.row - center.row)).toBeLessThanOrEqual(1);
    // A hit may keep the turn (extra shot): still one special per turn.
    if (match.turn === 'blue') expect(match.special('blue', { target: center })).toEqual({ ok: false, error: 'special-used' });
    const turn = (): string => match.turn;
    while (turn() === 'blue') miss(match);
    while (turn() !== 'blue') miss(match);
    expect(match.special('blue', { target: center })).toEqual({ ok: false, error: 'cooldown' });
  });
});

describe('rajada (Greek line of 3)', () => {
  it('strikes three cells, ends the turn without extra shot and has energy and cooldown', () => {
    const match = ready({ seed: 11, factions: { blue: 'grecia' } });
    skipTurns(match, 2);
    const red = match.viewFor('red').own.cells;
    const start = red.find(
      (c) => c.col < 23 && c.row > 0 && [0, 1, 2].every((k) => red[indexOf(SIZE, { col: c.col + k, row: c.row })]!.terrain === 'earth'),
    )!;
    const energy = match.viewFor('blue').own.energy;
    const result = match.special('blue', { target: start, axis: 'row' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.shots).toHaveLength(3);
    expect(result.outcome.extraShot).toBe(false);
    expect(match.turn).toBe('red');
    miss(match);
    expect(match.viewFor('blue').own.energy).toBe(energy - 3 + 1);
    expect(match.viewFor('blue').own.faction?.special).toMatchObject({ blocker: 'cooldown', cooldownLeft: 2 });
  });

  it('a rock stops the burst', () => {
    const match = ready({ seed: 11, factions: { blue: 'grecia' } });
    skipTurns(match, 2);
    const red = match.viewFor('red').own.cells;
    const start = red.find((c) => c.col < 23 && c.terrain === 'rock' && c.row > 0)!;
    const result = match.special('blue', { target: start, axis: 'row' });
    expect(result.ok && result.outcome.shots.map((s) => s.result)).toEqual(['rock']);
  });
});

describe('library kinds', () => {
  it('cross hits a plus and a rock centre absorbs it', () => {
    const match = ready({ seed: 12, factions: { blue: tester('cross') } });
    const red = match.viewFor('red').own.cells;
    const rock = red.find((c) => c.terrain === 'rock' && c.row > 0 && c.row < 6 && c.col > 0 && c.col < 24)!;
    const blocked = match.special('blue', { target: rock });
    expect(blocked.ok && blocked.outcome.shots.map((s) => s.result)).toEqual(['rock']);
    miss(match);
    const open = red.find((c) => c.terrain === 'earth' && c.row > 1 && c.row < 6 && c.col > 1 && c.col < 23)!;
    const hit = match.special('blue', { target: open });
    expect(hit.ok && hit.outcome.shots.length).toBeGreaterThanOrEqual(4);
  });

  it('double needs two cells that do not touch', () => {
    const match = ready({ seed: 12, factions: { blue: tester('double') } });
    const earth = terrainCells(match, 'red', 'earth');
    const a = earth[0]!;
    const near = neighbors4(SIZE, indexOf(SIZE, a)).map((i) => coordOf(SIZE, i))[0]!;
    expect(match.special('blue', { target: a, second: near })).toEqual({ ok: false, error: 'invalid-target' });
    const far = earth.find((c) => Math.abs(c.col - a.col) + Math.abs(c.row - a.row) > 1)!;
    const result = match.special('blue', { target: a, second: far });
    expect(result.ok && result.outcome.shots.map((s) => sameCoord(s.target, a) || sameCoord(s.target, far))).toEqual([true, true]);
  });

  it('ricochet bounces off plain earth to an unrevealed neighbour', () => {
    const match = ready({ seed: 12, factions: { blue: tester('ricochet') } });
    const earth = terrainCells(match, 'red', 'earth').find((c) => c.row > 0 && c.row < 6 && c.col > 0 && c.col < 24)!;
    const result = match.special('blue', { target: earth });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.shots).toHaveLength(2);
    const bounce = result.outcome.shots[1]!.target;
    expect(Math.abs(bounce.col - earth.col) + Math.abs(bounce.row - earth.row)).toBe(1);
  });

  it('under fog, a special shot may hit a faded miss again, like an attack', () => {
    const match = ready({ seed: 12, factions: { blue: tester('single') }, mutators: ['neblina'] });
    const earth = terrainCells(match, 'red', 'earth').reverse()[0]!;
    expect(match.attack('blue', earth).ok).toBe(true);
    skipTurns(match, 5); // turn 7, blue again: the miss from turn 1 has faded
    expect(match.viewFor('blue').enemy.cells[indexOf(SIZE, earth)]?.state).toBe('hidden');
    const again = match.special('blue', { target: earth });
    expect(again.ok && again.outcome.shots[0]?.result).toBe('earth');
    expect(match.viewFor('blue').enemy.cells[indexOf(SIZE, earth)]?.state).toBe('earth');
  });

  it('single behaves like an attack and keeps the extra-shot cap', () => {
    const match = ready({ seed: 12, factions: { blue: tester('single') } });
    const recruit = cellsOf(match, 'red', 'recruit')[0]!;
    const result = match.special('blue', { target: recruit });
    expect(result.ok && result.outcome.extraShot).toBe(true);
    expect(match.turn).toBe('blue');
    expect(match.viewFor('blue').turnState.extraShotsUsed).toBe(1);
  });
});
