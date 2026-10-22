import { describe, expect, it } from 'vitest';
import { FACTION_IDS, FACTIONS, MUTATOR_IDS, startAutoMatch, type Match, type MatchOptions, type PlayerId } from '@riverfront/core';
import { packView, unpackView } from '../src/index.ts';

function playSome(match: Match, shots: number): void {
  for (let n = 0; n < shots && match.phase === 'playing'; n++) {
    const player: PlayerId = match.turn;
    const view = match.viewFor(player);
    const target = view.enemy.cells.find((c) => c.state === 'hidden' || c.state === 'spotted');
    if (!target) break;
    match.attack(player, { col: target.col, row: target.row });
  }
}

describe('visão compactada', () => {
  for (const config of ['classic', 'full'] as const) {
    it(`ida e volta sem perda (${config})`, () => {
      const match = startAutoMatch({ seed: 99, config });
      for (const round of [0, 20, 60, 400]) {
        playSome(match, round);
        for (const player of ['blue', 'red'] as const) {
          const view = match.viewFor(player);
          const packed = JSON.parse(JSON.stringify(packView(view)));
          expect(unpackView(packed)).toEqual(view);
        }
      }
    });
  }

  const tower = FACTION_IDS.find((id) => FACTIONS[id].extraPiece?.role === 'tower') ?? 'neutra';
  const prober = FACTION_IDS.find((id) => FACTIONS[id].specialShot?.kind === 'probe') ?? 'neutra';
  const variants: [string, Omit<MatchOptions, 'seed'>][] = [
    ['facções e mutadores', { config: 'completo', factions: { blue: tower, red: prober }, mutators: [...MUTATOR_IDS] }],
    ['rápido com poderes', { config: 'rapido-poderes', mutators: ['mare'] }],
    ['rápido', { config: 'rapido' }],
  ];
  for (const [name, options] of variants) {
    it(`ida e volta sem perda (${name})`, () => {
      const match = startAutoMatch({ seed: 21, ...options });
      for (const round of [0, 15, 40, 400]) {
        playSome(match, round);
        for (const player of ['blue', 'red'] as const) {
          const view = match.viewFor(player);
          expect(unpackView(JSON.parse(JSON.stringify(packView(view))))).toEqual(view);
        }
      }
    });
  }

  it('histórico incremental', () => {
    const match = startAutoMatch({ seed: 3, config: 'classic' });
    playSome(match, 10);
    const first = match.viewFor('blue');
    playSome(match, 10);
    const second = match.viewFor('blue');
    const packed = packView(second, first.history.length);
    expect(packed.history.length).toBe(second.history.length - first.history.length);
    expect(unpackView(packed, first.history)).toEqual(second);
    expect(() => unpackView(packed, [])).toThrow();
  });

  it('fica bem menor que a visão completa', () => {
    const match = startAutoMatch({ seed: 7, config: 'full' });
    playSome(match, 30);
    const view = match.viewFor('blue');
    const full = JSON.stringify(view).length;
    const small = JSON.stringify(packView(view, view.history.length)).length;
    expect(small * 4).toBeLessThan(full);
  });
});

describe('visão das duplas', () => {
  it('ida e volta sem perda, com o bloco `doubles`', async () => {
    const { TeamMatch, SEATS } = await import('@riverfront/core');
    const match = new TeamMatch({ seed: 5, config: 'full' });
    for (const seat of SEATS) match.autoPlace(seat);
    for (const seat of SEATS) match.confirm(seat);
    for (let n = 0; n < 40 && match.phase === 'playing'; n++) {
      const seat = match.seatOnTurn;
      if (!seat) break;
      const target = match.viewFor(seat).enemy.cells.find((c) => c.state === 'hidden');
      if (!target) break;
      match.attack(seat, { col: target.col, row: target.row });
    }
    for (const seat of SEATS) {
      const view = match.viewFor(seat);
      expect(unpackView(JSON.parse(JSON.stringify(packView(view))))).toEqual(view);
    }
  });
});
