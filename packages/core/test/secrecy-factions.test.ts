import { describe, expect, it } from 'vitest';
import { Match, PLAYERS, indexOf, plusShape, type Coord, type FactionId, type MutatorId } from '../src/index.ts';

const SIZE = { cols: 25, rows: 7 };

interface Twins {
  readonly a: Match;
  readonly b: Match;
}

/** Same seed and blue layout; only red's hidden layout differs. */
function twins(seed: number, redSeeds: [number, number], factions: Partial<Record<'blue' | 'red', FactionId>>, mutators: MutatorId[]): Twins {
  const make = (redSeed: number) => {
    const m = new Match({ seed, factions, mutators });
    m.autoPlace('blue', seed * 3 + 1);
    m.autoPlace('red', redSeed);
    for (const p of PLAYERS) m.confirm(p);
    return m;
  };
  return { a: make(redSeeds[0]), b: make(redSeeds[1]) };
}

const roleAt = (m: Match, owner: 'blue' | 'red', c: Coord) => m.viewFor(owner).own.cells[indexOf(SIZE, c)]!.role;

/** Red cells empty (no unit) in both twins and not uncovered yet. */
function emptyInBoth(t: Twins, owner: 'blue' | 'red'): Coord[] {
  const ca = t.a.viewFor(owner).own.cells;
  const cb = t.b.viewFor(owner).own.cells;
  return ca.filter((c, i) => c.role === null && cb[i]!.role === null && !c.struck && !cb[i]!.struck).map((c) => ({ col: c.col, row: c.row }));
}

function same(t: Twins): void {
  expect(JSON.stringify(t.b.viewFor('blue'))).toBe(JSON.stringify(t.a.viewFor('blue')));
}

/** Red plays the same harmless turn in both twins (misses on blue's open earth). */
function redTurn(t: Twins): void {
  const target = emptyInBoth(t, 'blue').find((c) => c.row > 0)!;
  for (const m of [t.a, t.b]) expect(m.attack('red', target).ok).toBe(true);
}

describe('secrecy with factions and mutators', () => {
  it('probe, tide refusals, tower shots and enemy specials never leak the hidden layout', () => {
    let checkedSubmerged = 0;
    for (let seed = 1; seed <= 12; seed++) {
      // Find two red layouts that differ on the bank row (a unit in one, nothing in the other).
      let t: Twins | null = null;
      let bank: Coord | null = null;
      for (let s = 0; s < 30 && !bank; s++) {
        const candidate = twins(seed, [100 + s, 900 + s], { blue: 'egito', red: 'grecia' }, ['mare']);
        const cell = candidate.a
          .viewFor('red')
          .own.cells.find((c, i) => c.row === 0 && c.role !== null && c.role !== 'amphibian' && candidate.b.viewFor('red').own.cells[i]!.role === null);
        if (cell) {
          t = candidate;
          bank = { col: cell.col, row: cell.row };
        }
      }
      if (!t || !bank) continue;
      same(t);

      // Blue probes a cell empty on both sides: same answer, same view.
      const free = emptyInBoth(t, 'red').filter((c) => c.row > 0);
      for (const m of [t.a, t.b]) expect(m.special('blue', { target: free[0]! }).ok).toBe(true);
      same(t);
      for (const m of [t.a, t.b]) expect(m.attack('blue', free[1]!).ok).toBe(true);
      same(t);

      // Turns pass until the tide covers the bank (the Greek tower fires on red's 5th turn).
      while (!t.a.viewFor('blue').mutators?.tide?.submerged || t.a.turn !== 'blue') {
        if (t.a.turn === 'red') redTurn(t);
        else {
          const shot = emptyInBoth(t, 'red').find((c) => c.row > 0)!;
          for (const m of [t.a, t.b]) expect(m.attack('blue', shot).ok).toBe(true);
        }
        same(t);
      }
      // Submerged bank cell: unit in A, nothing in B; the refusal is identical.
      expect(roleAt(t.a, 'red', bank)).not.toBeNull();
      expect(roleAt(t.b, 'red', bank)).toBeNull();
      expect(t.a.attack('blue', bank)).toEqual({ ok: false, error: 'submerged' });
      expect(t.b.attack('blue', bank)).toEqual({ ok: false, error: 'submerged' });
      same(t);

      // A bomb whose plus covers that submerged cell fizzles there in both twins.
      const below = { col: bank.col, row: 1 };
      const plus = plusShape(SIZE, indexOf(SIZE, below)).map((i) => ({ col: i % 25, row: Math.floor(i / 25) }));
      const others = plus.filter((c) => c.row > 0);
      const quiet = others.every((c) => roleAt(t!.a, 'red', c) === null && roleAt(t!.b, 'red', c) === null);
      const ready = t.a.viewFor('blue').own.abilities.find((x) => x.id === 'bomb')?.ready;
      if (quiet && ready) {
        const ra = t.a.useAbility('blue', { ability: 'bomb', target: below });
        const rb = t.b.useAbility('blue', { ability: 'bomb', target: below });
        expect(JSON.stringify(rb)).toBe(JSON.stringify(ra));
        same(t);
      }
      checkedSubmerged++;
    }
    expect(checkedSubmerged).toBeGreaterThan(5);
  });

  it('the probed side only learns that a probe happened', () => {
    const t = twins(3, [11, 12], { blue: 'egito' }, []);
    const unit = t.a.viewFor('red').own.cells.find((c) => c.role !== null)!;
    t.a.special('blue', { target: unit });
    const red = t.a.viewFor('red');
    const entry = red.history.find((h) => h.kind === 'special')!;
    expect(entry).toEqual({ kind: 'special', turn: 1, by: 'blue', special: 'sonda', shot: 'probe', outcome: null });
    expect(red.intel.probes).toEqual([]);
  });

  it('enemy faction state shown in the view is public data only', () => {
    const t = twins(5, [21, 22], { blue: 'roma', red: 'grecia' }, ['mare', 'neblina']);
    const blue = t.a.viewFor('blue');
    expect(blue.enemy.faction).toEqual({
      id: 'grecia',
      name: 'Grécia',
      archetype: 'ataque',
      active: true,
      special: { id: 'rajada', name: 'Rajada', kind: 'line3', charges: null, cooldownLeft: 0 },
      testudo: null,
      tower: { alive: 1, nextFireIn: 5 },
    });
    same(t);
    for (const cell of blue.enemy.cells) expect(cell).toEqual({ col: cell.col, row: cell.row, state: 'hidden', role: null, shield: false });
  });
});
