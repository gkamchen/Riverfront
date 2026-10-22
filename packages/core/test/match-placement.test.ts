import { describe, expect, it } from 'vitest';
import { Match, candidatesFor, LayoutBoard, buildPieces, FULL_CONFIG, type Terrain } from '../src/index.ts';

function terrainOf(match: Match, player: 'blue' | 'red'): Terrain[] {
  return match.viewFor(player).own.cells.map((c) => c.terrain);
}

/** A legal spot for a piece given the player's current layout. */
function spotFor(match: Match, player: 'blue' | 'red', pieceId: string) {
  const view = match.viewFor(player);
  const board = new LayoutBoard({ cols: 25, rows: 7 }, terrainOf(match, player), buildPieces(FULL_CONFIG));
  board.applyLayout(view.own.pieces.flatMap((p) => (p.placement ? [p.placement] : [])));
  const slot = board.slotOf(pieceId);
  const list = candidatesFor(board, slot);
  if (!list[0]) throw new Error('no spot');
  return list[0];
}

describe('placement phase', () => {
  it('starts in placing with every piece unplaced', () => {
    const match = new Match({ seed: 3 });
    expect(match.phase).toBe('placing');
    const view = match.viewFor('blue');
    expect(view.own.pieces).toHaveLength(13);
    expect(view.own.pieces.every((p) => p.placement === null)).toBe(true);
    expect(view.own.issues).toHaveLength(13);
  });

  it('gives each player its own rocks, 45 of them', () => {
    const match = new Match({ seed: 3 });
    expect(terrainOf(match, 'blue').filter((t) => t === 'rock')).toHaveLength(45);
    expect(terrainOf(match, 'blue')).not.toEqual(terrainOf(match, 'red'));
  });

  it('place, move, rotate and remove a piece', () => {
    const match = new Match({ seed: 5 });
    const spot = spotFor(match, 'blue', 'armor-1');
    expect(match.place('blue', 'armor-1', spot.anchor, spot.rotation).ok).toBe(true);
    let piece = match.viewFor('blue').own.pieces.find((p) => p.id === 'armor-1');
    expect(piece?.cells).toHaveLength(2);

    const moved = spotFor(match, 'blue', 'armor-1');
    expect(match.move('blue', 'armor-1', moved.anchor).ok).toBe(true);

    const before = match.viewFor('blue').own.pieces.find((p) => p.id === 'armor-1')?.placement?.rotation ?? 0;
    const rotated = match.rotate('blue', 'armor-1');
    if (rotated.ok) {
      piece = match.viewFor('blue').own.pieces.find((p) => p.id === 'armor-1');
      expect(piece?.placement?.rotation).toBe((before + 1) % 4);
    } else {
      expect(['out-of-bounds', 'on-rock', 'overlap', 'isolation']).toContain(rotated.error);
    }

    expect(match.remove('blue', 'armor-1').ok).toBe(true);
    expect(match.viewFor('blue').own.pieces.find((p) => p.id === 'armor-1')?.placement).toBeNull();
  });

  it('reports placement errors', () => {
    const match = new Match({ seed: 5 });
    expect(match.place('blue', 'nope-1', { col: 0, row: 0 })).toEqual({ ok: false, error: 'unknown-piece' });
    expect(match.place('blue', 'armor-1', { col: 24, row: 0 })).toEqual({ ok: false, error: 'out-of-bounds' });
    expect(match.move('blue', 'armor-1', { col: 3, row: 3 })).toEqual({ ok: false, error: 'not-placed' });
    expect(match.rotate('blue', 'armor-1')).toEqual({ ok: false, error: 'not-placed' });
    expect(match.remove('blue', 'armor-1')).toEqual({ ok: false, error: 'not-placed' });
    const rock = match.viewFor('blue').own.cells.find((c) => c.terrain === 'rock')!;
    expect(match.place('blue', 'recruit-1', rock)).toEqual({ ok: false, error: 'on-rock' });
  });

  it('confirm needs a complete, legal layout', () => {
    const match = new Match({ seed: 6 });
    expect(match.confirm('blue')).toEqual({ ok: false, error: 'layout-incomplete' });
    expect(match.autoPlace('blue').ok).toBe(true);
    expect(match.viewFor('blue').own.issues).toEqual([]);
    expect(match.confirm('blue').ok).toBe(true);
    expect(match.phase).toBe('placing');
    expect(match.place('blue', 'armor-1', { col: 3, row: 3 })).toEqual({ ok: false, error: 'already-confirmed' });
  });

  it('starts playing once both confirm, first turn as configured', () => {
    const match = new Match({ seed: 6, firstTurn: 'red' });
    match.autoPlace('blue');
    match.autoPlace('red');
    match.confirm('red');
    expect(match.viewFor('blue').enemy.confirmed).toBe(true);
    match.confirm('blue');
    expect(match.phase).toBe('playing');
    expect(match.turn).toBe('red');
    expect(match.place('blue', 'armor-1', { col: 3, row: 3 })).toEqual({ ok: false, error: 'wrong-phase' });
  });

  it('setLayout validates the whole layout and keeps the old one on failure', () => {
    const a = new Match({ seed: 8 });
    const placements = a.autoPlace('blue');
    if (!placements.ok) throw new Error();
    const b = new Match({ seed: 8 });
    expect(b.setLayout('blue', placements.placements).ok).toBe(true);
    expect(b.viewFor('blue').own.pieces).toEqual(a.viewFor('blue').own.pieces);

    const broken = placements.placements.slice(1);
    expect(b.setLayout('blue', broken).ok).toBe(false);
    expect(b.viewFor('blue').own.pieces).toEqual(a.viewFor('blue').own.pieces);
  });

  it('autoPlace without a seed is still reproducible', () => {
    const a = new Match({ seed: 12 });
    const b = new Match({ seed: 12 });
    a.autoPlace('blue');
    b.autoPlace('blue');
    expect(a.viewFor('blue').own.pieces).toEqual(b.viewFor('blue').own.pieces);
    a.autoPlace('blue');
    expect(a.viewFor('blue').own.pieces).not.toEqual(b.viewFor('blue').own.pieces);
  });

  it('attacks are refused while placing', () => {
    const match = new Match({ seed: 1 });
    expect(match.attack('blue', { col: 0, row: 0 })).toEqual({ ok: false, error: 'wrong-phase' });
  });

  it('a player can surrender during placement', () => {
    const match = new Match({ seed: 1 });
    expect(match.surrender('red').ok).toBe(true);
    expect(match.winner).toBe('blue');
    expect(match.winReason).toBe('surrender');
    expect(match.autoPlace('blue')).toEqual({ ok: false, error: 'finished' });
  });
});
