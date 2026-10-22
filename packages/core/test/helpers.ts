import {
  Match,
  opponentOf,
  startAutoMatch,
  type Coord,
  type MatchOptions,
  type OwnPiece,
  type PlayerId,
  type RoleId,
} from '../src/index.ts';

export function ready(options: Partial<MatchOptions> = {}): Match {
  return startAutoMatch({ seed: 1, ...options });
}

/** Pieces of `owner`, read from the owner's own view (handy for aiming in tests). */
export function piecesOf(match: Match, owner: PlayerId, role?: RoleId): OwnPiece[] {
  return match.viewFor(owner).own.pieces.filter((p) => !role || p.role === role);
}

export function cellsOf(match: Match, owner: PlayerId, role: RoleId): Coord[] {
  return piecesOf(match, owner, role).flatMap((p) => p.cells);
}

/** Every intact unit cell of `owner` except the given roles. */
export function unitCells(match: Match, owner: PlayerId, exclude: readonly RoleId[] = []): Coord[] {
  return match
    .viewFor(owner)
    .own.cells.filter((c) => c.role !== null && !c.struck && !exclude.includes(c.role))
    .map((c) => ({ col: c.col, row: c.row }));
}

export function terrainCells(match: Match, owner: PlayerId, terrain: 'earth' | 'rock'): Coord[] {
  return match
    .viewFor(owner)
    .own.cells.filter((c) => c.role === null && c.terrain === terrain && !c.struck)
    .map((c) => ({ col: c.col, row: c.row }));
}

/** The player on turn shoots plain earth, which ends the turn. */
export function miss(match: Match): void {
  const attacker = match.turn;
  const target = terrainCells(match, opponentOf(attacker), 'earth')[0];
  if (!target) throw new Error('no earth left');
  const result = match.attack(attacker, target);
  if (!result.ok) throw new Error(result.error);
}

export function skipTurns(match: Match, turns: number): void {
  for (let i = 0; i < turns; i++) miss(match);
}

export function sameCoord(a: Coord, b: Coord): boolean {
  return a.col === b.col && a.row === b.row;
}
