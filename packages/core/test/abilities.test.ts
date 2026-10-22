import { describe, expect, it } from 'vitest';
import { ABILITIES, ENERGY, block3x3, indexOf, lineCells, plusShape, ROLES, type Match, type RoleId } from '../src/index.ts';
import { cellsOf, miss, piecesOf, ready, sameCoord, skipTurns, terrainCells, unitCells } from './helpers.ts';

const SIZE = { cols: 25, rows: 7 };

function energyOf(match: Match, player: 'blue' | 'red'): number {
  return match.viewFor(player).own.energy;
}

function status(match: Match, player: 'blue' | 'red', id: string) {
  return match.viewFor(player).own.abilities.find((a) => a.id === id)!;
}

/** Destroys every piece of a role on `owner` (the other side shoots, misses fill the gaps). */
function destroyRole(match: Match, owner: 'blue' | 'red', role: RoleId): void {
  const shooter = owner === 'blue' ? 'red' : 'blue';
  for (const cell of cellsOf(match, owner, role)) {
    while (match.turn !== shooter) miss(match);
    const r = match.attack(shooter, cell);
    if (!r.ok) throw new Error(r.error);
  }
  while (match.turn !== owner) miss(match);
}

describe('energy', () => {
  it('starts at 2 and gains 1 at the start of each own turn', () => {
    const match = ready({ seed: 1 });
    expect(energyOf(match, 'blue')).toBe(ENERGY.start + 1);
    expect(energyOf(match, 'red')).toBe(ENERGY.start);
    miss(match);
    expect(energyOf(match, 'red')).toBe(ENERGY.start + 1);
    miss(match);
    expect(energyOf(match, 'blue')).toBe(ENERGY.start + 2);
  });

  it('caps at 8', () => {
    const match = ready({ seed: 1 });
    skipTurns(match, 20);
    expect(energyOf(match, 'blue')).toBe(ENERGY.max);
  });

  it('gives +2 per enemy piece destroyed', () => {
    const match = ready({ seed: 3 });
    const before = energyOf(match, 'blue');
    const recruit = cellsOf(match, 'red', 'recruit')[0]!;
    match.attack('blue', recruit);
    expect(energyOf(match, 'blue')).toBe(before + ENERGY.perKill);
  });

  it('the classic preset has no energy and no abilities', () => {
    const match = ready({ seed: 1, config: 'classic' });
    expect(energyOf(match, 'blue')).toBe(0);
    expect(match.viewFor('blue').own.abilities).toEqual([]);
    expect(match.useAbility('blue', { ability: 'spy', axis: 'row', index: 0 })).toEqual({ ok: false, error: 'abilities-disabled' });
  });
});

describe('ability rules', () => {
  it('one ability per turn and it does not end the turn', () => {
    const match = ready({ seed: 1 });
    const used = match.useAbility('blue', { ability: 'spy', axis: 'row', index: 3 });
    expect(used.ok).toBe(true);
    expect(match.turn).toBe('blue');
    expect(match.viewFor('blue').turnState.abilityUsed).toBe(true);
    expect(match.useAbility('blue', { ability: 'radar', target: { col: 5, row: 3 } })).toEqual({ ok: false, error: 'ability-used' });
    expect(status(match, 'blue', 'radar').blocker).toBe('already-used');
  });

  it('spends energy and refuses when short', () => {
    const match = ready({ seed: 1 });
    match.useAbility('blue', { ability: 'spy', axis: 'row', index: 3 });
    expect(energyOf(match, 'blue')).toBe(1);
    miss(match);
    miss(match); // blue: 2 energy
    expect(match.useAbility('blue', { ability: 'radar', target: { col: 5, row: 3 } })).toEqual({ ok: false, error: 'energy' });
    expect(status(match, 'blue', 'radar').blocker).toBe('energy');
  });

  it('only on your own turn', () => {
    const match = ready({ seed: 1 });
    expect(match.useAbility('red', { ability: 'spy', axis: 'row', index: 0 })).toEqual({ ok: false, error: 'not-your-turn' });
    expect(status(match, 'red', 'spy').blocker).toBe('not-your-turn');
  });

  it('cooldown counts own turns', () => {
    const match = ready({ seed: 1 });
    match.useAbility('blue', { ability: 'spy', axis: 'row', index: 3 });
    const cooldown = ABILITIES.spy.cooldown;
    expect(status(match, 'blue', 'spy').cooldownLeft).toBe(cooldown);
    for (let k = 1; k < cooldown; k++) {
      skipTurns(match, 2);
      expect(status(match, 'blue', 'spy').cooldownLeft).toBe(cooldown - k);
      expect(match.useAbility('blue', { ability: 'spy', axis: 'row', index: 3 })).toEqual({ ok: false, error: 'cooldown' });
    }
    skipTurns(match, 2);
    expect(status(match, 'blue', 'spy').cooldownLeft).toBe(0);
    expect(match.useAbility('blue', { ability: 'spy', axis: 'row', index: 3 }).ok).toBe(true);
  });
});

describe('radar', () => {
  it('counts occupied cells in the 3×3, ignoring amphibians', () => {
    const match = ready({ seed: 7 });
    const red = match.viewFor('red').own.cells;
    const center = red.find((c) => c.terrain === 'earth' && c.role !== null && c.row > 0 && c.col > 0)!;
    const expected = block3x3(SIZE, indexOf(SIZE, center)).filter((i) => {
      const role = red[i]!.role;
      return role !== null && role !== 'amphibian';
    }).length;
    const result = match.useAbility('blue', { ability: 'radar', target: center });
    expect(result.ok && result.outcome).toEqual({ ability: 'radar', target: { col: center.col, row: center.row }, count: expected });
    expect(match.viewFor('blue').intel.radar).toEqual([{ turn: 1, center: { col: center.col, row: center.row }, count: expected }]);
  });

  it('a rock in the centre blocks the signal', () => {
    const match = ready({ seed: 7 });
    const rock = terrainCells(match, 'red', 'rock')[0]!;
    const result = match.useAbility('blue', { ability: 'radar', target: rock });
    expect(result.ok && result.outcome.ability === 'radar' && result.outcome.count).toBeNull();
  });

  it('amphibians are invisible to radar', () => {
    const match = ready({ seed: 7 });
    const amph = cellsOf(match, 'red', 'amphibian')[0]!;
    const red = match.viewFor('red').own.cells;
    const others = block3x3(SIZE, indexOf(SIZE, amph)).filter((i) => {
      const role = red[i]!.role;
      return role !== null && role !== 'amphibian';
    }).length;
    const result = match.useAbility('blue', { ability: 'radar', target: amph });
    expect(result.ok && result.outcome.ability === 'radar' && result.outcome.count).toBe(others);
  });

  it('needs a live antenna', () => {
    const match = ready({ seed: 7 });
    destroyRole(match, 'blue', 'antenna');
    expect(status(match, 'blue', 'radar').blocker).toBe('missing-piece');
    expect(match.useAbility('blue', { ability: 'radar', target: { col: 3, row: 3 } })).toEqual({ ok: false, error: 'missing-piece' });
  });
});

describe('bomb', () => {
  it('strikes a plus of five cells without granting extra shots', () => {
    const match = ready({ seed: 8 });
    skipTurns(match, 2); // blue 4 energy
    const red = match.viewFor('red').own.cells;
    const center = red.find((c) => c.terrain === 'earth' && c.row > 0 && c.row < 6 && c.col > 0 && c.col < 24 &&
      plusShape(SIZE, indexOf(SIZE, c)).every((i) => red[i]!.terrain === 'earth' && !red[i]!.struck))!;
    const before = match.viewFor('blue').enemy.cells.filter((c) => c.state !== 'hidden').length;
    const result = match.useAbility('blue', { ability: 'bomb', target: center });
    expect(result.ok).toBe(true);
    if (!result.ok || result.outcome.ability !== 'bomb') return;
    expect(result.outcome.shots).toHaveLength(5);
    expect(match.turn).toBe('blue');
    expect(match.viewFor('blue').turnState.extraShotsUsed).toBe(0);
    const revealed = match.viewFor('blue').enemy.cells.filter((c) => c.state !== 'hidden');
    expect(revealed.length - before).toBe(5);
  });

  it('a rock centre absorbs everything', () => {
    const match = ready({ seed: 8 });
    skipTurns(match, 2);
    const rock = terrainCells(match, 'red', 'rock')[0]!;
    const result = match.useAbility('blue', { ability: 'bomb', target: rock });
    expect(result.ok && result.outcome.ability === 'bomb' && result.outcome.shots.map((s) => s.result)).toEqual(['rock']);
  });

  it('refuses a revealed rock centre', () => {
    const match = ready({ seed: 8 });
    const rock = terrainCells(match, 'red', 'rock')[0]!;
    match.attack('blue', rock);
    skipTurns(match, 3);
    expect(match.useAbility('blue', { ability: 'bomb', target: rock })).toEqual({ ok: false, error: 'invalid-target' });
  });

  it('cooldown is 3 with a live artillery, 4 without', () => {
    const match = ready({ seed: 8 });
    expect(status(match, 'blue', 'bomb').cooldown).toBe(3);
    destroyRole(match, 'blue', 'artillery');
    expect(status(match, 'blue', 'bomb').cooldown).toBe(4);
  });

  it('is public: the opponent sees the struck cells in the history', () => {
    const match = ready({ seed: 8 });
    skipTurns(match, 2);
    const target = terrainCells(match, 'red', 'earth').find((c) => c.row > 0 && c.row < 6 && c.col > 0 && c.col < 24)!;
    match.useAbility('blue', { ability: 'bomb', target });
    const entry = match.viewFor('red').history.find((h) => h.kind === 'ability');
    expect(entry?.kind === 'ability' && entry.outcome?.ability).toBe('bomb');
  });
});

describe('shield', () => {
  function shieldable(match: Match) {
    return piecesOf(match, 'blue').find((p) => p.role !== 'sniper' && p.cells.length >= 2 && p.cells.every((c) => c.row > 0) && p.role !== 'bunker')!;
  }

  it('absorbs shots for two enemy turns without extra shots', () => {
    const match = ready({ seed: 10 });
    const piece = shieldable(match);
    const used = match.useAbility('blue', { ability: 'shield', pieceId: piece.id });
    expect(used.ok).toBe(true);
    expect(match.viewFor('blue').own.pieces.find((p) => p.id === piece.id)?.shieldTurns).toBe(2);
    miss(match);

    const absorbed = match.attack('red', piece.cells[0]!);
    expect(absorbed.ok && absorbed.outcome.result).toBe('shield');
    expect(absorbed.ok && absorbed.outcome.extraShot).toBe(false);
    expect(match.turn).toBe('blue');
    const seen = match.viewFor('red').enemy.cells.find((c) => sameCoord(c, piece.cells[0]!));
    expect(seen).toMatchObject({ state: 'spotted', shield: true });
    expect(match.viewFor('blue').own.pieces.find((p) => p.id === piece.id)?.damaged).toBe(0);

    miss(match);
    expect(match.attack('red', piece.cells[0]!).ok && match.viewFor('red').enemy.cells.find((c) => sameCoord(c, piece.cells[0]!))?.state).toBe('spotted');
    miss(match);
    const landed = match.attack('red', piece.cells[0]!);
    expect(landed.ok && landed.outcome.result).toBe('hit');
  });

  it('does not work on pieces touching the bank row', () => {
    const match = ready({ seed: 10 });
    const amph = piecesOf(match, 'blue', 'amphibian')[0]!;
    expect(match.useAbility('blue', { ability: 'shield', pieceId: amph.id })).toEqual({ ok: false, error: 'invalid-target' });
  });

  it('needs a live generator', () => {
    const match = ready({ seed: 10 });
    destroyRole(match, 'blue', 'generator');
    expect(status(match, 'blue', 'shield').blocker).toBe('missing-piece');
  });

  it('the opponent only learns that a shield is up', () => {
    const match = ready({ seed: 10 });
    const piece = shieldable(match);
    match.useAbility('blue', { ability: 'shield', pieceId: piece.id });
    const red = match.viewFor('red');
    expect(red.enemy.shieldActive).toBe(true);
    const entry = red.history.find((h) => h.kind === 'ability');
    expect(entry).toMatchObject({ kind: 'ability', ability: 'shield', outcome: null });
    expect(JSON.stringify(red.enemy) + JSON.stringify(red.history)).not.toContain(piece.id);
  });
});

describe('repair', () => {
  function damagedRepairable(match: Match) {
    const blue = match.viewFor('blue').own.cells;
    const piece = piecesOf(match, 'blue').find((p) => p.cells.length >= 2 && p.role !== 'bunker' &&
      p.cells.some((c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => {
        const n = blue.find((x) => x.col === c.col + dc! && x.row === c.row + dr!);
        return n && n.terrain === 'earth' && n.role === null;
      })))!;
    const cell = piece.cells.find((c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => {
      const n = blue.find((x) => x.col === c.col + dc! && x.row === c.row + dr!);
      return n && n.terrain === 'earth' && n.role === null;
    }))!;
    return { piece, cell };
  }

  it('restores a damaged cell next to earth and hides it again', () => {
    const match = ready({ seed: 14 });
    const { cell } = damagedRepairable(match);
    miss(match);
    match.attack('red', cell);
    while (match.turn !== 'blue') miss(match);
    skipTurns(match, 2); // enough energy
    const left = match.viewFor('blue').own.unitCellsLeft;
    const result = match.useAbility('blue', { ability: 'repair', target: cell });
    expect(result.ok).toBe(true);
    expect(match.viewFor('blue').own.unitCellsLeft).toBe(left + 1);
    expect(match.viewFor('red').enemy.cells.find((c) => sameCoord(c, cell))?.state).toBe('hidden');
    expect(match.viewFor('blue').own.cells.find((c) => sameCoord(c, cell))?.struck).toBe(false);
  });

  it('reinforces the repaired piece: a shot at the remembered cell is absorbed next turn', () => {
    const match = ready({ seed: 14 });
    const { piece, cell } = damagedRepairable(match);
    miss(match);
    match.attack('red', cell);
    while (match.turn !== 'blue') miss(match);
    skipTurns(match, 2);
    const result = match.useAbility('blue', { ability: 'repair', target: cell });
    expect(result.ok && result.outcome.ability === 'repair' && result.outcome.guardTurns).toBe(1);
    expect(match.viewFor('blue').own.pieces.find((p) => p.id === piece.id)?.shieldTurns).toBe(1);
    expect(match.viewFor('red').enemy.shieldActive).toBe(true);
    miss(match);
    const again = match.attack('red', cell);
    expect(again.ok && again.outcome.result).toBe('shield');
    // One enemy turn only: next time the shot lands.
    miss(match);
    const later = match.attack('red', cell);
    expect(later.ok && ['hit', 'destroyed'].includes(later.outcome.result)).toBe(true);
  });

  it('refuses intact cells and empty cells', () => {
    const match = ready({ seed: 14 });
    skipTurns(match, 2);
    const intact = unitCells(match, 'blue')[0]!;
    expect(match.useAbility('blue', { ability: 'repair', target: intact })).toEqual({ ok: false, error: 'invalid-target' });
    const earth = terrainCells(match, 'blue', 'earth')[0]!;
    expect(match.useAbility('blue', { ability: 'repair', target: earth })).toEqual({ ok: false, error: 'invalid-target' });
  });

  it('cannot bring back a destroyed piece', () => {
    const match = ready({ seed: 14 });
    const recruit = cellsOf(match, 'blue', 'recruit')[0]!;
    miss(match);
    match.attack('red', recruit);
    while (match.turn !== 'blue') miss(match);
    skipTurns(match, 2);
    expect(match.useAbility('blue', { ability: 'repair', target: recruit })).toEqual({ ok: false, error: 'invalid-target' });
  });

  it('needs a live workshop', () => {
    const match = ready({ seed: 14 });
    destroyRole(match, 'blue', 'workshop');
    expect(status(match, 'blue', 'repair').blocker).toBe('missing-piece');
  });
});

describe('spy', () => {
  it('names a piece type that crosses the line (a random one, not the best)', () => {
    const match = ready({ seed: 16 });
    const red = match.viewFor('red').own.cells;
    for (let index = 0; index < 7; index++) {
      const fresh = ready({ seed: 16 });
      const roles = lineCells(SIZE, 'row', index).map((i) => red[i]!.role).filter((r): r is RoleId => r !== null);
      const result = fresh.useAbility('blue', { ability: 'spy', axis: 'row', index });
      expect(result.ok && result.outcome.ability === 'spy').toBe(true);
      if (!result.ok || result.outcome.ability !== 'spy') return;
      expect(result.outcome.ranked).toBe(false);
      if (roles.length === 0) expect(result.outcome.role).toBeNull();
      else expect(roles).toContain(result.outcome.role);
    }
  });

  it('the Egyptian spy still names the most valuable piece', () => {
    const match = ready({ seed: 16, factions: { blue: 'egito' } });
    const red = match.viewFor('red').own.cells;
    for (const [axis, index] of [['row', 2], ['col', 7]] as const) {
      const fresh = ready({ seed: 16, factions: { blue: 'egito' } });
      const roles = lineCells(SIZE, axis, index).map((i) => red[i]!.role).filter((r): r is RoleId => r !== null);
      const best = roles.sort((a, b) => ROLES[b].value - ROLES[a].value)[0] ?? null;
      const result = fresh.useAbility('blue', { ability: 'spy', axis, index });
      expect(result.ok && result.outcome.ability === 'spy' && result.outcome.role).toBe(best);
      expect(result.ok && result.outcome.ability === 'spy' && result.outcome.ranked).toBe(true);
    }
  });

  it('returns null on an empty line and validates the index', () => {
    const match = ready({ seed: 16 });
    const red = match.viewFor('red').own.cells;
    const empty = Array.from({ length: 25 }, (_, col) => col).find((col) => lineCells(SIZE, 'col', col).every((i) => red[i]!.role === null));
    expect(match.useAbility('blue', { ability: 'spy', axis: 'row', index: 7 })).toEqual({ ok: false, error: 'out-of-bounds' });
    if (empty !== undefined) {
      const result = match.useAbility('blue', { ability: 'spy', axis: 'col', index: empty });
      expect(result.ok && result.outcome.ability === 'spy' && result.outcome.role).toBeNull();
    }
  });

  it('is private to its user', () => {
    const match = ready({ seed: 16 });
    match.useAbility('blue', { ability: 'spy', axis: 'row', index: 1 });
    expect(match.viewFor('red').intel.spy).toEqual([]);
    expect(match.viewFor('blue').intel.spy).toHaveLength(1);
    const entry = match.viewFor('red').history.find((h) => h.kind === 'ability');
    expect(entry).toMatchObject({ ability: 'spy', outcome: null });
  });
});
