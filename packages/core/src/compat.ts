/**
 * Compatibility layer for the first prototype client, which only knew one-cell
 * units of three kinds and a plain alternating turn. New code should use
 * `Match` and `PlayerView` directly.
 */
import { Match } from './match.ts';
import type { PresetId } from './config.ts';
import type { RoleId } from './roles.ts';
import type { Rng } from './rng.ts';
import { PLAYERS, type Coord, type PlayerId } from './types.ts';
import type { PlayerView as FullView, ShotResult } from './view.ts';

export type UnitType = 'soldier' | 'tank' | 'tower';
export type CellKind = 'earth' | 'rock' | 'unit';

/** Rendering stand-in for each role in the old client. */
export const LEGACY_UNIT: Readonly<Record<RoleId, UnitType>> = {
  recruit: 'soldier',
  sniper: 'soldier',
  generator: 'soldier',
  armor: 'tank',
  amphibian: 'tank',
  workshop: 'tank',
  bunker: 'tank',
  artillery: 'tower',
  antenna: 'tower',
  tower: 'tower',
};

export interface Revealed {
  readonly kind: CellKind;
  readonly unit: UnitType | null;
}

export interface OwnCellView extends Coord, Revealed {
  readonly hit: boolean;
}

export type EnemyCellView =
  | (Coord & { readonly state: 'hidden' })
  | (Coord & Revealed & { readonly state: 'revealed' });

export interface LegacyFieldView<TCell> {
  readonly cols: number;
  readonly rows: number;
  readonly unitsTotal: number;
  readonly unitsLeft: number;
  readonly cells: readonly TCell[];
}

export interface LegacyPlayerView {
  readonly player: PlayerId;
  readonly opponent: PlayerId;
  readonly turn: PlayerId;
  readonly turnNumber: number;
  readonly phase: 'playing' | 'finished';
  readonly winner: PlayerId | null;
  readonly own: LegacyFieldView<OwnCellView>;
  readonly enemy: LegacyFieldView<EnemyCellView>;
}

export interface LegacyAttackOutcome {
  readonly attacker: PlayerId;
  readonly defender: PlayerId;
  readonly target: Coord;
  readonly revealed: Revealed;
  readonly defenderUnitsLeft: number;
  readonly turnNumber: number;
  readonly nextTurn: PlayerId | null;
  readonly winner: PlayerId | null;
}

export type LegacyAttackResult =
  | { readonly ok: true; readonly outcome: LegacyAttackOutcome }
  | { readonly ok: false; readonly error: string };

function revealedFor(result: ShotResult, role: RoleId | null): Revealed {
  if (result === 'earth' || result === 'rock') return { kind: result, unit: null };
  // A hit only shows what it was once the whole piece is down.
  return { kind: 'unit', unit: role ? LEGACY_UNIT[role] : 'soldier' };
}

/** Converts a full view into the prototype's shape. */
export function toLegacyView(view: FullView): LegacyPlayerView {
  const cols = view.config.cols;
  const rows = view.config.rows;
  return {
    player: view.player,
    opponent: view.opponent,
    turn: view.turn,
    turnNumber: view.turnNumber,
    phase: view.phase === 'finished' ? 'finished' : 'playing',
    winner: view.winner,
    own: {
      cols,
      rows,
      unitsTotal: view.own.unitCellsTotal,
      unitsLeft: view.own.unitCellsLeft,
      cells: view.own.cells.map((cell) => ({
        col: cell.col,
        row: cell.row,
        kind: cell.role ? 'unit' : cell.terrain,
        unit: cell.role ? LEGACY_UNIT[cell.role] : null,
        hit: cell.struck,
      })),
    },
    enemy: {
      cols,
      rows,
      unitsTotal: view.enemy.unitCellsTotal,
      unitsLeft: view.enemy.unitCellsLeft,
      cells: view.enemy.cells.map((cell): EnemyCellView => {
        if (cell.state === 'earth' || cell.state === 'rock' || cell.state === 'hit') {
          const result: ShotResult = cell.state === 'hit' ? 'hit' : cell.state;
          return { col: cell.col, row: cell.row, state: 'revealed', ...revealedFor(result, cell.role) };
        }
        return { col: cell.col, row: cell.row, state: 'hidden' };
      }),
    },
  };
}

/**
 * The old `Match` surface: placement is automatic and the match starts right
 * away. Extra shots still apply, so the same player may attack again.
 */
export class LegacyMatch {
  readonly match: Match;

  constructor(options: { seed: number; preset?: PresetId; firstTurn?: PlayerId }) {
    this.match = new Match({ seed: options.seed, config: options.preset ?? 'classic', firstTurn: options.firstTurn ?? 'blue' });
    for (const player of PLAYERS) {
      this.match.autoPlace(player);
      this.match.confirm(player);
    }
  }

  get turn(): PlayerId {
    return this.match.turn;
  }

  get phase(): 'playing' | 'finished' {
    return this.match.phase === 'finished' ? 'finished' : 'playing';
  }

  get winner(): PlayerId | null {
    return this.match.winner;
  }

  viewFor(player: PlayerId): LegacyPlayerView {
    return toLegacyView(this.match.viewFor(player));
  }

  attack(attacker: PlayerId, target: Coord): LegacyAttackResult {
    const result = this.match.attack(attacker, target);
    if (!result.ok) return { ok: false, error: result.error };
    const o = result.outcome;
    const defenderView = this.match.viewFor(o.attacker);
    return {
      ok: true,
      outcome: {
        attacker: o.attacker,
        defender: o.defender,
        target: o.target,
        revealed: revealedFor(o.result, o.destroyed?.role ?? null),
        defenderUnitsLeft: defenderView.enemy.unitCellsLeft,
        turnNumber: o.turnNumber,
        nextTurn: o.nextTurn,
        winner: o.winner,
      },
    };
  }
}

/** The simplest possible opponent: any enemy cell it has not uncovered yet. */
export function chooseRandomTarget(
  view: { readonly enemy: { readonly cells: readonly { readonly col: number; readonly row: number; readonly state: string }[] } },
  rng: Rng,
): Coord | null {
  const candidates = view.enemy.cells.filter((cell) => cell.state === 'hidden' || cell.state === 'spotted');
  if (candidates.length === 0) return null;
  const choice = rng.pick(candidates);
  return { col: choice.col, row: choice.row };
}
