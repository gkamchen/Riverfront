import { describe, expect, it } from 'vitest';
import { MAX_EXTRA_SHOTS, type Coord } from '../src/index.ts';
import { cellsOf, miss, piecesOf, ready, sameCoord, terrainCells, unitCells } from './helpers.ts';

describe('attacks', () => {
  it('earth is a miss that passes the turn', () => {
    const match = ready({ seed: 2 });
    const target = terrainCells(match, 'red', 'earth')[0]!;
    const result = match.attack('blue', target);
    expect(result.ok && result.outcome.result).toBe('earth');
    expect(result.ok && result.outcome.extraShot).toBe(false);
    expect(match.turn).toBe('red');
    expect(match.turnNumber).toBe(2);
    const cell = match.viewFor('blue').enemy.cells.find((c) => sameCoord(c, target));
    expect(cell?.state).toBe('earth');
  });

  it('rock is revealed and absorbs the shot', () => {
    const match = ready({ seed: 2 });
    const target = terrainCells(match, 'red', 'rock')[0]!;
    const result = match.attack('blue', target);
    expect(result.ok && result.outcome.result).toBe('rock');
    expect(match.turn).toBe('red');
    expect(match.viewFor('blue').enemy.cells.find((c) => sameCoord(c, target))?.state).toBe('rock');
  });

  it('a hit grants an extra shot and reveals no role', () => {
    const match = ready({ seed: 4 });
    const target = cellsOf(match, 'red', 'armor')[0]!;
    const result = match.attack('blue', target);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.result).toBe('hit');
    expect(result.outcome.extraShot).toBe(true);
    expect(result.outcome.extraShotsLeft).toBe(MAX_EXTRA_SHOTS - 1);
    expect(result.outcome.destroyed).toBeNull();
    expect(match.turn).toBe('blue');
    const cell = match.viewFor('blue').enemy.cells.find((c) => sameCoord(c, target));
    expect(cell).toEqual({ ...target, state: 'hit', role: null, shield: false });
  });

  it('caps extra shots at three: the fourth hit passes the turn', () => {
    const match = ready({ seed: 9 });
    const targets = unitCells(match, 'red', ['bunker', 'sniper']).slice(0, 4);
    const outcomes = targets.map((t) => {
      const r = match.attack('blue', t);
      if (!r.ok) throw new Error(r.error);
      return r.outcome;
    });
    expect(outcomes.map((o) => o.extraShot)).toEqual([true, true, true, false]);
    expect(outcomes.every((o) => o.result === 'hit' || o.result === 'destroyed')).toBe(true);
    expect(match.turn).toBe('red');
  });

  it('destroying a piece reveals its role and cells', () => {
    const match = ready({ seed: 4 });
    const armor = piecesOf(match, 'red', 'armor')[0]!;
    match.attack('blue', armor.cells[0]!);
    const result = match.attack('blue', armor.cells[1]!);
    expect(result.ok && result.outcome.result).toBe('destroyed');
    if (!result.ok) return;
    expect(result.outcome.destroyed?.role).toBe('armor');
    expect(result.outcome.destroyed?.cells).toEqual(armor.cells);
    const view = match.viewFor('blue');
    expect(view.enemy.destroyed).toHaveLength(1);
    expect(view.enemy.cells.filter((c) => c.role === 'armor')).toHaveLength(2);
    expect(view.enemy.remaining.find((r) => r.role === 'armor')?.count).toBe(1);
  });

  it('bunker concrete: no extra shot until its second cell is hit', () => {
    const match = ready({ seed: 5 });
    const bunker = cellsOf(match, 'red', 'bunker');
    const first = match.attack('blue', bunker[0]!);
    expect(first.ok && first.outcome.result).toBe('hit');
    expect(first.ok && first.outcome.extraShot).toBe(false);
    expect(match.turn).toBe('red');
    miss(match);
    const second = match.attack('blue', bunker[1]!);
    expect(second.ok && second.outcome.extraShot).toBe(true);
    const third = match.attack('blue', bunker[2]!);
    expect(third.ok && third.outcome.extraShot).toBe(true);
  });

  it('rejects bad attacks', () => {
    const match = ready({ seed: 2 });
    expect(match.attack('red', { col: 0, row: 0 })).toEqual({ ok: false, error: 'not-your-turn' });
    expect(match.attack('blue', { col: 25, row: 0 })).toEqual({ ok: false, error: 'out-of-bounds' });
    expect(match.attack('blue', { col: 1.5, row: 0 })).toEqual({ ok: false, error: 'out-of-bounds' });
    const target = terrainCells(match, 'red', 'earth')[0]!;
    match.attack('blue', target);
    miss(match);
    expect(match.attack('blue', target)).toEqual({ ok: false, error: 'already-revealed' });
  });

  it('wins when every unit cell is destroyed', () => {
    const match = ready({ seed: 13, config: 'classic' });
    let last = null;
    let guard = 0;
    while (match.phase === 'playing' && guard++ < 200) {
      if (match.turn === 'red') {
        miss(match);
        continue;
      }
      const target = unitCells(match, 'red')[0]!;
      const r = match.attack('blue', target);
      if (!r.ok) throw new Error(r.error);
      last = r.outcome;
    }
    expect(match.winner).toBe('blue');
    expect(match.winReason).toBe('destroyed');
    expect(last?.winner).toBe('blue');
    expect(last?.nextTurn).toBeNull();
    expect(match.viewFor('blue').enemy.unitCellsLeft).toBe(0);
    expect(match.attack('red', { col: 0, row: 0 })).toEqual({ ok: false, error: 'finished' });
  });

  it('surrender ends the match for the opponent', () => {
    const match = ready({ seed: 2 });
    expect(match.surrender('blue').ok).toBe(true);
    expect(match.winner).toBe('red');
    expect(match.winReason).toBe('surrender');
    expect(match.surrender('red')).toEqual({ ok: false, error: 'finished' });
  });

  it('sniper last shot exposes one intact cell of the shooter', () => {
    const match = ready({ seed: 21 });
    const sniper = cellsOf(match, 'red', 'sniper')[0]!;
    const result = match.attack('blue', sniper);
    expect(result.ok && result.outcome.result).toBe('destroyed');
    if (!result.ok) return;
    const reveal = result.outcome.sniperReveal as Coord;
    expect(reveal).not.toBeNull();
    const blueOwn = match.viewFor('blue').own.cells.find((c) => sameCoord(c, reveal));
    expect(blueOwn?.role).not.toBeNull();
    expect(blueOwn?.exposed).toBe(true);
    const redSees = match.viewFor('red').enemy.cells.find((c) => sameCoord(c, reveal));
    expect(redSees?.state).toBe('spotted');
  });

  it('records shots in the shared history', () => {
    const match = ready({ seed: 2 });
    miss(match);
    const history = match.viewFor('red').history;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ kind: 'shot', by: 'blue', turn: 1, extraShot: false });
  });
});
