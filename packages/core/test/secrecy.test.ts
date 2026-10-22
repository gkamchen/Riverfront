import { describe, expect, it } from 'vitest';
import { Match, opponentOf, type Coord, type PlayerId } from '../src/index.ts';
import { piecesOf, ready, unitCells } from './helpers.ts';

/** Same seed, same blue layout, different red layouts. */
function twins(seed: number): [Match, Match] {
  const make = (redSeed: number) => {
    const m = new Match({ seed });
    m.autoPlace('blue', seed * 3 + 1);
    m.autoPlace('red', redSeed);
    return m;
  };
  return [make(seed * 11 + 5), make(seed * 13 + 7)];
}

function emptyInBoth(a: Match, b: Match, owner: PlayerId): Coord[] {
  const ca = a.viewFor(owner).own.cells;
  const cb = b.viewFor(owner).own.cells;
  return ca.filter((c, i) => c.role === null && cb[i]!.role === null && !c.struck).map((c) => ({ col: c.col, row: c.row }));
}

describe('secrecy', () => {
  it('a player view does not depend on the hidden enemy layout (placing phase)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const [a, b] = twins(seed);
      expect(a.viewFor('red').own.pieces).not.toEqual(b.viewFor('red').own.pieces);
      expect(JSON.stringify(a.viewFor('blue'))).toBe(JSON.stringify(b.viewFor('blue')));
    }
  });

  it('nor during play, including abilities the enemy uses', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const [a, b] = twins(seed);
      for (const m of [a, b]) for (const p of ['blue', 'red'] as const) m.confirm(p);
      const blueTargets = emptyInBoth(a, b, 'red');
      const redTargets = emptyInBoth(a, b, 'blue');
      for (let step = 0; step < 6; step++) {
        for (const m of [a, b]) {
          m.attack('blue', blueTargets[step]!);
          if (step === 1) m.useAbility('red', { ability: 'spy', axis: 'row', index: 2 });
          if (step === 2) m.useAbility('red', { ability: 'radar', target: { col: 4, row: 3 } });
          if (step === 5) expect(m.useAbility('red', { ability: 'shield', pieceId: 'bunker-1' }).ok).toBe(true);
          m.attack('red', redTargets[step]!);
        }
        expect(JSON.stringify(a.viewFor('blue'))).toBe(JSON.stringify(b.viewFor('blue')));
      }
    }
  });

  it('hidden enemy cells carry nothing but their coordinates', () => {
    const match = ready({ seed: 3 });
    for (const cell of match.viewFor('blue').enemy.cells) {
      expect(cell).toEqual({ col: cell.col, row: cell.row, state: 'hidden', role: null, shield: false });
    }
  });

  it('views survive a JSON round trip unchanged', () => {
    const match = ready({ seed: 4 });
    match.attack('blue', unitCells(match, 'red')[0]!);
    for (const player of ['blue', 'red'] as const) {
      const view = match.viewFor(player);
      expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    }
  });

  it('the view holds no reference to internal state', () => {
    const match = ready({ seed: 4 });
    const view = match.viewFor('blue');
    (view.own.pieces as unknown as unknown[]).pop();
    (view.enemy.cells as unknown[]).length = 0;
    expect(match.viewFor('blue').own.pieces).toHaveLength(13);
    expect(match.viewFor('blue').enemy.cells).toHaveLength(175);
  });

  it('the enemy layout is only revealed once the match is over', () => {
    const match = ready({ seed: 4 });
    expect(match.viewFor('blue').enemy.layout).toBeNull();
    match.surrender('red');
    const layout = match.viewFor('blue').enemy.layout;
    expect(layout?.pieces).toHaveLength(13);
    expect(layout?.rocks).toHaveLength(45);
    expect(layout?.pieces.map((p) => p.cells)).toEqual(piecesOf(match, 'red').map((p) => p.cells));
  });

  it('outcomes returned to the attacker only describe struck cells', () => {
    const match = ready({ seed: 6 });
    const target = unitCells(match, 'red')[0]!;
    const result = match.attack('blue', target);
    const text = JSON.stringify(result);
    const others = unitCells(match, 'red');
    for (const cell of others) {
      if (result.ok && result.outcome.destroyed) continue;
      expect(text).not.toContain(`{"col":${cell.col},"row":${cell.row}}`);
    }
  });

  it('own view shows the exposed state only for cells the enemy actually knows', () => {
    const match = ready({ seed: 6 });
    for (const player of ['blue', 'red'] as const) {
      expect(match.viewFor(player).own.cells.some((c) => c.exposed)).toBe(false);
      expect(match.viewFor(opponentOf(player)).enemy.cells.some((c) => c.state === 'spotted')).toBe(false);
    }
  });
});
