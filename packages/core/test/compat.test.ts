import { describe, expect, it } from 'vitest';
import { LEGACY_UNIT, LegacyMatch, ROLE_IDS, chooseRandomTarget, createRng } from '../src/index.ts';

describe('legacy compatibility', () => {
  it('starts straight into play with the classic army', () => {
    const match = new LegacyMatch({ seed: 1 });
    const view = match.viewFor('blue');
    expect(view.phase).toBe('playing');
    expect(view.turn).toBe('blue');
    expect(view.own.unitsTotal).toBe(22);
    expect(view.own.cells.filter((c) => c.kind === 'unit')).toHaveLength(22);
    expect(view.own.cells.filter((c) => c.kind === 'rock')).toHaveLength(45);
    expect(view.enemy.cells.every((c) => c.state === 'hidden')).toBe(true);
  });

  it('maps every role onto an old unit type', () => {
    for (const role of ROLE_IDS) expect(['soldier', 'tank', 'tower']).toContain(LEGACY_UNIT[role]);
    expect(LEGACY_UNIT.recruit).toBe('soldier');
    expect(LEGACY_UNIT.armor).toBe('tank');
    expect(LEGACY_UNIT.antenna).toBe('tower');
  });

  it('reports attacks in the old shape', () => {
    const match = new LegacyMatch({ seed: 2 });
    const result = match.attack('blue', { col: 3, row: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(['earth', 'rock', 'unit']).toContain(result.outcome.revealed.kind);
    expect(result.outcome.defender).toBe('red');
    expect(match.attack('blue', { col: 99, row: 0 })).toEqual({ ok: false, error: match.turn === 'blue' ? 'out-of-bounds' : 'not-your-turn' });
  });

  it('chooseRandomTarget plays a whole match to the end', () => {
    const match = new LegacyMatch({ seed: 77 });
    const rng = createRng(77);
    let guard = 0;
    while (match.phase === 'playing' && guard++ < 1000) {
      const view = match.viewFor(match.turn);
      const target = chooseRandomTarget(view, rng);
      expect(target).not.toBeNull();
      if (!target) break;
      expect(match.attack(match.turn, target).ok).toBe(true);
    }
    expect(match.phase).toBe('finished');
    expect(match.winner).not.toBeNull();
  });

  it('chooseRandomTarget returns null when nothing is hidden', () => {
    expect(chooseRandomTarget({ enemy: { cells: [{ col: 0, row: 0, state: 'revealed' }] } }, createRng(1))).toBeNull();
  });
});
