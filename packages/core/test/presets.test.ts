import { describe, expect, it } from 'vitest';
import {
  CLASSIC_CONFIG,
  FULL_CONFIG,
  GAME_PRESETS,
  LayoutBoard,
  Match,
  PRESETS,
  RAPID_CONFIG,
  RAPID_POWERS_CONFIG,
  autoPlace,
  buildPieces,
  createRng,
  generateTerrain,
  hashSeed,
  sizedConfig,
  startAutoMatch,
  unitCellCount,
  type FieldConfig,
  type PresetId,
} from '../src/index.ts';
import { skipTurns } from './helpers.ts';
import { playRandom } from './random-play.ts';

describe('game presets', () => {
  it('pt-BR aliases point to the original configs', () => {
    expect(PRESETS.classico).toBe(CLASSIC_CONFIG);
    expect(PRESETS.completo).toBe(FULL_CONFIG);
    expect(GAME_PRESETS.map((p) => p.id)).toEqual(['classic', 'full', 'rapido', 'rapido-poderes']);
  });

  it('quick presets: 15×5 field, about ten unit cells, one with radar and bomb', () => {
    for (const config of [RAPID_CONFIG, RAPID_POWERS_CONFIG]) {
      expect([config.cols, config.rows]).toEqual([15, 5]);
      expect(unitCellCount(config)).toBeGreaterThanOrEqual(8);
      expect(unitCellCount(config)).toBeLessThanOrEqual(10);
    }
    expect(RAPID_CONFIG.abilities).toEqual([]);
    expect(RAPID_POWERS_CONFIG.abilities).toEqual(['radar', 'bomb']);
  });

  it('the energy scale comes from the preset', () => {
    const match = startAutoMatch({ seed: 3, config: 'rapido-poderes' });
    expect(match.viewFor('blue').own.energyMax).toBe(6);
    skipTurns(match, 20);
    expect(match.viewFor('blue').own.energy).toBe(6);
    expect(startAutoMatch({ seed: 3, config: 'rapido' }).viewFor('blue').own.energy).toBe(0);
  });
});

describe('field size', () => {
  it('sizedConfig keeps the preset when the size is the same and scales rocks otherwise', () => {
    expect(sizedConfig('full', 25, 7)).toBe(FULL_CONFIG);
    const wide = sizedConfig('full', 30, 8);
    expect(wide).toMatchObject({ cols: 30, rows: 8, name: 'full-30x8', rocks: Math.round((45 * 240) / 175) });
    expect(sizedConfig('rapido', 12, 4, { rocks: 6 }).rocks).toBe(6);
    expect(() => sizedConfig('full', 2, 7)).toThrow();
  });

  it('a match can use another size; an army that cannot fit is refused', () => {
    const match = startAutoMatch({ seed: 4, config: 'full', size: { cols: 20, rows: 6 } });
    expect(match.config).toMatchObject({ cols: 20, rows: 6 });
    expect(match.viewFor('blue').enemy.cells).toHaveLength(120);
    expect(() => new Match({ seed: 1, config: 'full', size: { cols: 6, rows: 4 } })).toThrow();
  });
});

describe('placement on small fields (500 seeds)', () => {
  const armies: [string, FieldConfig][] = [
    ['rapido', RAPID_CONFIG],
    ['rapido-poderes', RAPID_POWERS_CONFIG],
    ['rapido-poderes + torre', { ...RAPID_POWERS_CONFIG, units: [...RAPID_POWERS_CONFIG.units, { role: 'tower', count: 1 }] }],
    ['completo 18×6', sizedConfig('full', 18, 6)],
  ];
  for (const [name, config] of armies) {
    it(`autoPlace is always legal: ${name}`, () => {
      const size = { cols: config.cols, rows: config.rows };
      const pieces = buildPieces(config);
      for (let seed = 0; seed < 500; seed++) {
        const terrain = generateTerrain(size, config.rocks, pieces, createRng(hashSeed(seed, 'terrain', name)));
        const board = new LayoutBoard(size, terrain, pieces);
        expect(board.applyLayout(autoPlace(size, terrain, pieces, createRng(seed)))).toBeNull();
      }
    }, 60_000);
  }
});

describe('every preset plays to the end with factions and mutators', () => {
  const presets: PresetId[] = ['classic', 'full', 'rapido', 'rapido-poderes'];
  it('random legal play finishes and replays exactly', () => {
    presets.forEach((preset, i) => {
      for (let seed = 1; seed <= 3; seed++) {
        const live = startAutoMatch({
          seed: seed + i * 10,
          config: preset,
          factions: { blue: 'grecia', red: seed % 2 ? 'egito' : 'roma' },
          mutators: seed === 1 ? ['mare'] : seed === 2 ? ['tiro-duplo', 'mare'] : ['neblina'],
        });
        playRandom(live, seed * 13 + i);
        expect(live.phase).toBe('finished');
        const copy = Match.fromRecord(JSON.parse(JSON.stringify(live.toRecord())));
        expect(copy.serverState()).toEqual(live.serverState());
      }
    });
  });
});
