import { describe, expect, it } from 'vitest';
import { Match, PLAYERS, cellLabel, startAutoMatch } from '@riverfront/core';
import { coach } from '../src/index.ts';

describe('coach', () => {
  it('returns a heat map, a shootable recommendation and a pt-BR explanation', () => {
    const match = startAutoMatch({ seed: 3 });
    const advice = coach(match.viewFor('blue'));
    expect(advice.heat).toHaveLength(175);
    expect(advice.heat.every((p) => p >= 0 && p <= 1)).toBe(true);
    expect(advice.best).not.toBeNull();
    expect(advice.chance).toBeGreaterThan(0);
    expect(advice.explanation).toContain(`Atire em ${cellLabel(advice.best!)}`);
  });

  it('chases an unfinished hit and says so', () => {
    const match = startAutoMatch({ seed: 3 });
    const artillery = match.viewFor('red').own.pieces.find((p) => p.role === 'artillery')!;
    match.attack('blue', artillery.cells[1]!);
    const advice = coach(match.viewFor('blue'));
    const hit = artillery.cells[1]!;
    expect(Math.abs(advice.best!.col - hit.col) + Math.abs(advice.best!.row - hit.row)).toBe(1);
    expect(advice.explanation).toContain(cellLabel(hit));
  });

  it('is deterministic and blind to the hidden layout', () => {
    const make = (redSeed: number) => {
      const m = new Match({ seed: 5 });
      m.autoPlace('blue', 1);
      m.autoPlace('red', redSeed);
      for (const p of PLAYERS) m.confirm(p);
      return m;
    };
    const a = coach(make(10).viewFor('blue'));
    const b = coach(make(20).viewFor('blue'));
    expect(b).toEqual(a);
  });

  it('has nothing to say outside of play', () => {
    const match = new Match({ seed: 1 });
    expect(coach(match.viewFor('blue')).best).toBeNull();
  });
});
