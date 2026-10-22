import { describe, expect, it } from 'vitest';
import {
  CLASSIC_CONFIG,
  FULL_CONFIG,
  LayoutBoard,
  autoPlace,
  buildPieces,
  candidatesFor,
  createRng,
  generateTerrain,
  type Terrain,
} from '../src/index.ts';

const SIZE = { cols: 25, rows: 7 };
const PIECES = buildPieces(FULL_CONFIG);

function board(rocks: readonly [number, number][] = []): LayoutBoard {
  const terrain: Terrain[] = Array.from({ length: 175 }, () => 'earth');
  for (const [col, row] of rocks) terrain[row * 25 + col] = 'rock';
  return new LayoutBoard(SIZE, terrain, PIECES);
}

const slot = (b: LayoutBoard, id: string) => b.slotOf(id);

describe('LayoutBoard basics', () => {
  it('rejects pieces leaving the board', () => {
    const b = board();
    expect(b.place(slot(b, 'armor-1'), { col: 24, row: 3 }, 0)).toBe('out-of-bounds');
    expect(b.place(slot(b, 'armor-1'), { col: 3, row: 6 }, 1)).toBe('out-of-bounds');
    expect(b.place(slot(b, 'armor-1'), { col: -1, row: 2 }, 0)).toBe('out-of-bounds');
  });

  it('rejects rock cells and overlaps', () => {
    const b = board([[4, 3]]);
    expect(b.place(slot(b, 'armor-1'), { col: 3, row: 3 }, 0)).toBe('on-rock');
    expect(b.place(slot(b, 'armor-1'), { col: 5, row: 3 }, 0)).toBeNull();
    expect(b.place(slot(b, 'armor-2'), { col: 6, row: 2 }, 1)).toBe('overlap');
  });

  it('rotation turns a bar vertical around the anchor', () => {
    const b = board();
    expect(b.place(slot(b, 'armor-1'), { col: 3, row: 2 }, 1)).toBeNull();
    expect(b.cellsOf(slot(b, 'armor-1'))).toEqual([2 * 25 + 3, 3 * 25 + 3]);
  });

  it('rejects an invalid rotation and unknown pieces', () => {
    const b = board();
    expect(b.check(slot(b, 'armor-1'), { col: 3, row: 2 }, 5 as never)).toEqual({ ok: false, error: 'bad-rotation' });
    expect(b.check(99, { col: 3, row: 2 }, 0)).toEqual({ ok: false, error: 'unknown-piece' });
  });

  it('moving a piece onto its own old cells is fine', () => {
    const b = board();
    b.place(slot(b, 'artillery-1'), { col: 3, row: 3 }, 0);
    expect(b.place(slot(b, 'artillery-1'), { col: 4, row: 3 }, 0)).toBeNull();
    expect(b.occupant[3 * 25 + 3]).toBe(-1);
  });
});

describe('role rules', () => {
  it('sniper cannot touch another unit, in either order', () => {
    const b = board();
    b.place(slot(b, 'sniper-1'), { col: 5, row: 3 }, 0);
    expect(b.place(slot(b, 'recruit-1'), { col: 6, row: 3 }, 0)).toBe('isolation');
    expect(b.place(slot(b, 'recruit-1'), { col: 6, row: 4 }, 0)).toBeNull(); // diagonal is fine

    const c = board();
    c.place(slot(c, 'recruit-1'), { col: 6, row: 3 }, 0);
    expect(c.place(slot(c, 'sniper-1'), { col: 5, row: 3 }, 0)).toBe('isolation');
  });

  it('artillery stays off the lake-bank row', () => {
    const b = board();
    expect(b.place(slot(b, 'artillery-1'), { col: 3, row: 0 }, 0)).toBe('bank-row');
    expect(b.place(slot(b, 'artillery-1'), { col: 3, row: 0 }, 1)).toBe('bank-row');
    expect(b.place(slot(b, 'artillery-1'), { col: 3, row: 1 }, 1)).toBeNull();
  });

  it('antenna needs an adjacent rock', () => {
    expect(board().place(slot(board(), 'antenna-1'), { col: 5, row: 3 }, 0)).toBe('needs-rock');
    const b = board([[4, 3]]);
    expect(b.place(slot(b, 'antenna-1'), { col: 5, row: 3 }, 0)).toBeNull();
  });

  it('bunker keeps away from the border', () => {
    const b = board();
    expect(b.place(slot(b, 'bunker-1'), { col: 0, row: 2 }, 0)).toBe('border');
    expect(b.place(slot(b, 'bunker-1'), { col: 5, row: 5 }, 0)).toBe('border');
    expect(b.place(slot(b, 'bunker-1'), { col: 23, row: 2 }, 0)).toBe('border');
    expect(b.place(slot(b, 'bunker-1'), { col: 1, row: 1 }, 0)).toBeNull();
  });

  it('amphibian lies flat on the bank row only', () => {
    const b = board();
    expect(b.place(slot(b, 'amphibian-1'), { col: 3, row: 1 }, 0)).toBe('bank-only');
    expect(b.place(slot(b, 'amphibian-1'), { col: 3, row: 0 }, 1)).toBe('bank-only');
    expect(b.place(slot(b, 'amphibian-1'), { col: 3, row: 0 }, 0)).toBeNull();
  });

  it('generator may be placed early but must end next to a bunker or antenna', () => {
    const b = board([[10, 3]]);
    expect(b.place(slot(b, 'generator-1'), { col: 5, row: 3 }, 0)).toBeNull();
    expect(b.issues()).toContainEqual({ pieceId: 'generator-1', error: 'needs-support' });

    b.place(slot(b, 'bunker-1'), { col: 6, row: 3 }, 0);
    expect(b.issues().some((i) => i.pieceId === 'generator-1')).toBe(false);

    b.clear(slot(b, 'bunker-1'));
    b.place(slot(b, 'antenna-1'), { col: 11, row: 2 }, 0);
    b.place(slot(b, 'generator-1'), { col: 12, row: 2 }, 0);
    expect(b.issues().some((i) => i.pieceId === 'generator-1')).toBe(false);
  });

  it('workshop has no special rule', () => {
    const b = board();
    expect(b.place(slot(b, 'workshop-1'), { col: 0, row: 0 }, 0)).toBeNull();
    expect(b.place(slot(b, 'workshop-1'), { col: 24, row: 5 }, 1)).toBeNull();
  });

  it('issues list unplaced pieces and applyLayout rejects duplicates', () => {
    const b = board();
    expect(b.issues()).toHaveLength(13);
    expect(b.issues()[0]?.error).toBe('not-placed');
    const dup = b.applyLayout([
      { pieceId: 'recruit-1', anchor: { col: 0, row: 0 }, rotation: 0 },
      { pieceId: 'recruit-1', anchor: { col: 5, row: 0 }, rotation: 0 },
    ]);
    expect(dup?.error).toBe('unknown-piece');
  });
});

describe('autoPlace', () => {
  for (const config of [FULL_CONFIG, CLASSIC_CONFIG]) {
    it(`always produces a legal ${config.name} layout (500 seeds)`, () => {
      const pieces = buildPieces(config);
      for (let seed = 0; seed < 500; seed++) {
        const terrain = generateTerrain(SIZE, config.rocks, pieces, createRng(seed));
        const placements = autoPlace(SIZE, terrain, pieces, createRng(seed * 7 + 1));
        const check = new LayoutBoard(SIZE, terrain, pieces);
        expect(check.applyLayout(placements)).toBeNull();
        expect(check.complete).toBe(true);
        const used = Array.from(check.occupant).filter((s) => s >= 0).length;
        expect(used).toBe(config === FULL_CONFIG ? 24 : 22);
      }
    });
  }

  it('is deterministic for a seed', () => {
    const terrain = generateTerrain(SIZE, 45, PIECES, createRng(5));
    expect(autoPlace(SIZE, terrain, PIECES, createRng(9))).toEqual(autoPlace(SIZE, terrain, PIECES, createRng(9)));
  });

  it('honours a weight function', () => {
    const terrain = generateTerrain(SIZE, 45, PIECES, createRng(11));
    const placements = autoPlace(SIZE, terrain, PIECES, createRng(3), {
      weight: (_piece, cells) => (cells.every((i) => i % 25 < 15) ? 1 : 0),
    });
    const b = new LayoutBoard(SIZE, terrain, PIECES);
    expect(b.applyLayout(placements)).toBeNull();
    const cols = Array.from(b.occupant).flatMap((s, i) => (s >= 0 ? [i % 25] : []));
    expect(Math.max(...cols)).toBeLessThan(15);
  });

  it('candidatesFor only lists legal spots', () => {
    const terrain = generateTerrain(SIZE, 45, PIECES, createRng(2));
    const b = new LayoutBoard(SIZE, terrain, PIECES);
    const s = b.slotOf('bunker-1');
    const list = candidatesFor(b, s);
    expect(list.length).toBeGreaterThan(0);
    for (const c of list) expect(b.check(s, c.anchor, c.rotation).ok).toBe(true);
  });
});

describe('generateTerrain', () => {
  it('places exactly the configured rocks, deterministically', () => {
    const a = generateTerrain(SIZE, 45, PIECES, createRng(4));
    const b = generateTerrain(SIZE, 45, PIECES, createRng(4));
    expect(a).toEqual(b);
    expect(a.filter((t) => t === 'rock')).toHaveLength(45);
    expect(a).toHaveLength(175);
  });

  it('throws when nothing can fit', () => {
    expect(() => generateTerrain(SIZE, 170, PIECES, createRng(1))).toThrow();
  });
});
