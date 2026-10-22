import { describe, expect, it } from 'vitest';
import { FOG_FADE_TURNS, Match, PLAYERS, indexOf, startAutoMatch, tideAt, type FieldConfig } from '../src/index.ts';
import { cellsOf, miss as anyMiss, terrainCells, unitCells } from './helpers.ts';

/** A miss away from the bank row (the water may cover it). */
function miss(match: Match): void {
  const attacker = match.turn;
  const defender = attacker === 'blue' ? 'red' : 'blue';
  const target = terrainCells(match, defender, 'earth').find((c) => c.row > 0);
  if (!target) return anyMiss(match);
  const result = match.attack(attacker, target);
  if (!result.ok) throw new Error(result.error);
}

function skipTurns(match: Match, turns: number): void {
  for (let i = 0; i < turns; i++) miss(match);
}

const SIZE = { cols: 25, rows: 7 };

/** Plays misses until the tide is up (turn 5). */
function untilTide(match: Match): void {
  while (!match.viewFor('blue').mutators?.tide?.submerged) miss(match);
}

describe('tide schedule', () => {
  it('rises every 6 turns and stays up for 2', () => {
    const up = Array.from({ length: 14 }, (_, i) => tideAt(i + 1).submerged);
    expect(up).toEqual([false, false, false, false, true, true, false, false, false, false, true, true, false, false]);
    expect(tideAt(1).turnsUntilRise).toBe(4);
    expect(tideAt(3).turnsUntilRise).toBe(2);
    expect(tideAt(5)).toEqual({ submerged: true, turnsUntilRise: 0, turnsUntilRecede: 2 });
  });

  it('the view warns ahead and logs rise and recede in the history', () => {
    const match = startAutoMatch({ seed: 4, mutators: ['mare'] });
    expect(match.viewFor('blue').mutators?.tide).toMatchObject({ submerged: false, turnsUntilRise: 4, rows: [0] });
    skipTurns(match, 2);
    expect(match.viewFor('red').mutators?.tide?.turnsUntilRise).toBe(2);
    skipTurns(match, 2);
    expect(match.viewFor('blue').mutators?.tide?.submerged).toBe(true);
    skipTurns(match, 2);
    const tides = match.viewFor('red').history.filter((h) => h.kind === 'tide');
    expect(tides).toEqual([
      { kind: 'tide', turn: 5, submerged: true },
      { kind: 'tide', turn: 7, submerged: false },
    ]);
  });

  it('without the mutator there is no tide at all', () => {
    const match = startAutoMatch({ seed: 4 });
    expect(match.viewFor('blue').mutators).toEqual({ active: [], tide: null, doubleShot: null, fog: null });
  });
});

describe('tide rules', () => {
  it('a direct shot at a submerged cell is refused, costs nothing and is not logged', () => {
    const match = startAutoMatch({ seed: 4, mutators: ['mare'] });
    untilTide(match);
    const shooter = match.turn;
    const log = match.log.length;
    const bank = match.viewFor(shooter).enemy.cells.find((c) => c.row === 0 && c.state === 'hidden')!;
    expect(match.attack(shooter, bank)).toEqual({ ok: false, error: 'submerged' });
    expect(match.turn).toBe(shooter);
    expect(match.log).toHaveLength(log);
  });

  it('area shots fizzle on submerged cells but still hit a swimming amphibian', () => {
    const match = startAutoMatch({ seed: 6, mutators: ['mare'] });
    untilTide(match);
    while (match.turn !== 'blue') miss(match);
    skipTurns(match, 2);
    while (!match.viewFor('blue').mutators?.tide?.submerged || match.turn !== 'blue') miss(match);
    const amph = cellsOf(match, 'red', 'amphibian')[0]!;
    const below = { col: amph.col, row: 1 };
    const result = match.useAbility('blue', { ability: 'bomb', target: below });
    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome.ability !== 'bomb') return;
    const bankShots = result.outcome.shots.filter((s) => s.target.row === 0);
    const onAmph = bankShots.find((s) => s.target.col === amph.col)!;
    expect(['hit', 'destroyed']).toContain(onAmph.result);
    for (const s of bankShots) {
      const role = match.viewFor('red').own.cells[indexOf(SIZE, s.target)]!.role;
      if (role !== 'amphibian') expect(s.result).toBe('submerged');
    }
    // Fizzled cells stay hidden.
    for (const s of bankShots.filter((x) => x.result === 'submerged')) {
      expect(match.viewFor('blue').enemy.cells[indexOf(SIZE, s.target)]?.state).toBe('hidden');
    }
  });

  it('radar sees amphibians while the bank is under water', () => {
    const match = startAutoMatch({ seed: 7, mutators: ['mare'] });
    untilTide(match);
    while (match.turn !== 'blue' || !match.viewFor('blue').mutators?.tide?.submerged) miss(match);
    const amph = cellsOf(match, 'red', 'amphibian')[0]!;
    const red = match.viewFor('red').own.cells;
    const expected = [-1, 0, 1]
      .flatMap((dr) => [-1, 0, 1].map((dc) => ({ col: amph.col + dc, row: amph.row + dr })))
      .filter((c) => c.col >= 0 && c.row >= 0 && c.col < 25 && c.row < 7)
      .filter((c) => red[indexOf(SIZE, c)]!.role !== null).length;
    const result = match.useAbility('blue', { ability: 'radar', target: amph });
    expect(result.ok && result.outcome.ability === 'radar' && result.outcome.count).toBe(expected);
    expect(match.viewFor('blue').intel.radar.at(-1)?.amphibians).toBe(true);
  });

  it('when only submerged cells are left, shots there are allowed and fizzle', () => {
    const tiny: FieldConfig = { name: 'tiny', cols: 4, rows: 3, rocks: 0, units: [{ role: 'recruit', count: 1 }], abilities: [] };
    const match = new Match({ seed: 1, config: tiny, mutators: ['mare'] });
    // Both recruits on the bank row.
    for (const p of PLAYERS) {
      expect(match.place(p, 'recruit-1', { col: 0, row: 0 }).ok).toBe(true);
      match.confirm(p);
    }
    const back = [1, 2].flatMap((row) => [0, 1, 2, 3].map((col) => ({ col, row })));
    const bankEarth = [1, 2, 3].map((col) => ({ col, row: 0 }));
    // Turns 1-4 are dry: clear the bank earth first, then the rear.
    const queue = { blue: [...bankEarth, ...back], red: [...bankEarth, ...back] };
    for (let guard = 0; guard < 40 && match.phase === 'playing'; guard++) {
      const p = match.turn;
      const next = queue[p].shift();
      if (!next) break;
      const r = match.attack(p, next);
      if (!r.ok) {
        expect(r.error).toBe('submerged');
        queue[p].push(next);
        // Something else to shoot must exist, otherwise the refusal would be a dead end.
        expect(queue[p].some((c) => c.row > 0)).toBe(true);
      }
    }
    // Only the recruit cell is left: wait for the water and shoot it.
    while (match.phase === 'playing' && !match.viewFor('blue').mutators?.tide?.submerged) {
      const p = match.turn;
      expect(match.attack(p, { col: 0, row: 0 }).ok).toBe(true);
    }
    if (match.phase === 'playing') {
      const r = match.attack(match.turn, { col: 0, row: 0 });
      expect(r.ok && r.outcome.result).toBe('submerged');
    }
  });
});

describe('tiro-duplo', () => {
  it('two shots per turn, hit or miss, and no extra shots', () => {
    const match = startAutoMatch({ seed: 3, mutators: ['tiro-duplo'] });
    expect(match.viewFor('blue').turnState.shotsLeft).toBe(2);
    const recruit = cellsOf(match, 'red', 'recruit')[0]!;
    const hit = match.attack('blue', recruit);
    expect(hit.ok && hit.outcome.extraShot).toBe(false);
    expect(match.turn).toBe('blue');
    expect(match.viewFor('blue').turnState.shotsLeft).toBe(1);
    const second = unitCells(match, 'red')[0]!;
    match.attack('blue', second);
    expect(match.turn).toBe('red');
    expect(match.viewFor('red').turnState.shotsLeft).toBe(2);
  });
});

describe('neblina', () => {
  it('misses fade from the shooter map after 3 own turns; hits stay', () => {
    const match = startAutoMatch({ seed: 5, mutators: ['neblina'] });
    const earth = terrainCells(match, 'red', 'earth').reverse()[0]!;
    const unit = unitCells(match, 'red')[0]!;
    match.attack('blue', unit);
    while (match.turn === 'blue') match.attack('blue', earth);
    const at = indexOf(SIZE, earth);
    expect(match.viewFor('blue').enemy.cells[at]?.state).toBe('earth');
    skipTurns(match, FOG_FADE_TURNS - 2);
    expect(match.viewFor('blue').enemy.cells[at]?.state).toBe('earth');
    skipTurns(match, 1);
    expect(match.viewFor('blue').enemy.cells[at]?.state).toBe('hidden');
    expect(match.viewFor('blue').enemy.cells[indexOf(SIZE, unit)]?.state).toBe('hit');
    // The owner still sees the old struck mark; shooting it again spends the shot.
    const turn = (): string => match.turn;
    while (turn() !== 'blue') miss(match);
    const again = match.attack('blue', earth);
    expect(again.ok && again.outcome.result).toBe('earth');
    expect(turn()).toBe('red');
    expect(match.viewFor('blue').enemy.cells[at]?.state).toBe('earth');
  });
});

describe('config', () => {
  it('refuses unknown mutators and records the active ones', () => {
    expect(() => new Match({ seed: 1, mutators: ['vulcao' as never] })).toThrow();
    const match = startAutoMatch({ seed: 1, mutators: ['mare', 'neblina'] });
    expect(match.toRecord().mutators).toEqual(['mare', 'neblina']);
    expect(startAutoMatch({ seed: 1 }).toRecord().mutators).toBeUndefined();
  });
});
