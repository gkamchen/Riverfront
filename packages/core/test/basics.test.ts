import { describe, expect, it } from 'vitest';
import {
  BANK_ROW,
  CLASSIC_CONFIG,
  FULL_CONFIG,
  ROLES,
  block3x3,
  buildPieces,
  createRng,
  dailySeed,
  hashSeed,
  isBorder,
  lineCells,
  neighbors4,
  orientations,
  pieceCount,
  plusShape,
  resolveConfig,
  rotateShape,
  unitCellCount,
  validateConfig,
} from '../src/index.ts';

const SIZE = { cols: 25, rows: 7 };

describe('rng', () => {
  it('is deterministic for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 10 }, () => a.next())).toEqual(Array.from({ length: 10 }, () => b.next()));
  });

  it('stays in range and exposes a comparable state', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const n = rng.int(25);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(25);
    }
    const copy = createRng(0);
    expect(copy.state).toBe(0);
    expect(rng.state).not.toBe(0);
  });

  it('shuffle keeps every element', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const shuffled = createRng(3).shuffle([...items]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
    expect(shuffled).not.toEqual(items);
  });

  it('pick refuses an empty list', () => {
    expect(() => createRng(1).pick([])).toThrow();
  });

  it('hashSeed mixes numbers and strings stably', () => {
    expect(hashSeed(1, 'a')).toBe(hashSeed(1, 'a'));
    expect(hashSeed(1, 'a')).not.toBe(hashSeed(1, 'b'));
    expect(hashSeed('ab', 'c')).not.toBe(hashSeed('a', 'bc'));
  });

  it('dailySeed is the same for the whole UTC day and changes with the date', () => {
    expect(dailySeed('2026-10-19')).toBe(dailySeed(new Date('2026-10-19T23:59:00Z')));
    expect(dailySeed('2026-10-19')).toBe(dailySeed('2026-10-19T08:00:00Z'));
    expect(dailySeed('2026-10-19')).not.toBe(dailySeed('2026-10-20'));
    expect(() => dailySeed('ontem')).toThrow();
  });
});

describe('grid helpers', () => {
  it('neighbors4 stays on the board', () => {
    expect(neighbors4(SIZE, 0).sort((a, b) => a - b)).toEqual([1, 25]);
    expect(neighbors4(SIZE, 25 * 3 + 5)).toHaveLength(4);
    expect(neighbors4(SIZE, 174).sort((a, b) => a - b)).toEqual([149, 173]);
  });

  it('block3x3 and plusShape clip at the border', () => {
    expect(block3x3(SIZE, 0)).toHaveLength(4);
    expect(block3x3(SIZE, 30)).toHaveLength(9);
    expect(plusShape(SIZE, 0)).toHaveLength(3);
    expect(plusShape(SIZE, 30)).toHaveLength(5);
  });

  it('lineCells covers rows and columns', () => {
    expect(lineCells(SIZE, 'row', 2)).toHaveLength(25);
    expect(lineCells(SIZE, 'col', 4)).toEqual([4, 29, 54, 79, 104, 129, 154]);
  });

  it('isBorder marks the outer ring, and the bank row is row 0', () => {
    expect(BANK_ROW).toBe(0);
    expect(isBorder(SIZE, { col: 0, row: 3 })).toBe(true);
    expect(isBorder(SIZE, { col: 24, row: 3 })).toBe(true);
    expect(isBorder(SIZE, { col: 5, row: 6 })).toBe(true);
    expect(isBorder(SIZE, { col: 5, row: 3 })).toBe(false);
  });
});

describe('roles and shapes', () => {
  it('rotates an L through four distinct orientations', () => {
    const shape = ROLES.antenna.shape;
    expect(orientations(shape)).toHaveLength(4);
    expect(rotateShape(shape, 1)).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 0, row: 1 },
    ]);
  });

  it('four quarter turns bring a shape back', () => {
    for (const role of Object.values(ROLES)) {
      const base = rotateShape(role.shape, 0);
      const twice = rotateShape(rotateShape(role.shape, 2), 2);
      expect(twice).toEqual(base);
    }
  });

  it('counts orientations by symmetry', () => {
    expect(orientations(ROLES.recruit.shape)).toHaveLength(1);
    expect(orientations(ROLES.bunker.shape)).toHaveLength(1);
    expect(orientations(ROLES.armor.shape)).toHaveLength(2);
    expect(orientations(ROLES.artillery.shape)).toHaveLength(2);
  });

  it('a vertical bar is one wide', () => {
    const vertical = orientations(ROLES.artillery.shape).find((o) => o.rotation === 1);
    expect(vertical?.width).toBe(1);
    expect(vertical?.height).toBe(3);
  });

  it('spy values are unique', () => {
    const values = Object.values(ROLES).map((r) => r.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('presets', () => {
  it('full has 13 pieces over 24 cells and 45 rocks', () => {
    expect(pieceCount(FULL_CONFIG)).toBe(13);
    expect(unitCellCount(FULL_CONFIG)).toBe(24);
    expect(FULL_CONFIG.rocks).toBe(45);
    expect(FULL_CONFIG.abilities).toHaveLength(5);
  });

  it('classic has recruits, armor, artillery and a bunker, no abilities', () => {
    const roles = CLASSIC_CONFIG.units.map((u) => `${u.role}x${u.count}`);
    expect(roles).toEqual(['recruitx6', 'armorx3', 'artilleryx2', 'bunkerx1']);
    expect(CLASSIC_CONFIG.abilities).toEqual([]);
  });

  it('builds stable piece ids', () => {
    const ids = buildPieces(FULL_CONFIG).map((p) => p.id);
    expect(ids).toContain('recruit-4');
    expect(ids).toContain('armor-2');
    expect(new Set(ids).size).toBe(13);
  });

  it('resolveConfig accepts ids, configs and defaults to full', () => {
    expect(resolveConfig('classic')).toBe(CLASSIC_CONFIG);
    expect(resolveConfig(undefined)).toBe(FULL_CONFIG);
    expect(resolveConfig(FULL_CONFIG)).toBe(FULL_CONFIG);
    expect(() => resolveConfig('mega' as never)).toThrow();
  });

  it('validateConfig rejects impossible fields', () => {
    expect(() => validateConfig({ ...FULL_CONFIG, rocks: 160 })).toThrow();
    expect(() => validateConfig({ ...FULL_CONFIG, units: [] })).toThrow();
    expect(() => validateConfig({ ...FULL_CONFIG, units: [{ role: 'dragon' as never, count: 1 }] })).toThrow();
    expect(() => validateConfig({ ...FULL_CONFIG, abilities: ['laser' as never] })).toThrow();
    expect(() => validateConfig(FULL_CONFIG)).not.toThrow();
  });

  it('accepts custom shapes per unit', () => {
    const config = { ...CLASSIC_CONFIG, units: [{ role: 'armor' as const, count: 1, shape: [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 2, row: 0 }, { col: 3, row: 0 }] }] };
    expect(unitCellCount(config)).toBe(4);
    expect(buildPieces(config)[0]?.shape).toHaveLength(4);
  });
});
