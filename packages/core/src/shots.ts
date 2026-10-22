import { indexOf, isInside, neighbors4, plusShape, type GridSize, type LineAxis } from './grid.ts';
import type { Coord } from './types.ts';

/**
 * Reusable shot patterns. A faction's special shot is one of these plus its
 * costs (`SpecialShotDef`); the match resolves every kind the same way.
 *
 * - single: one cell, like a normal shot;
 * - line3: three cells in a row (right) or column (down) from the target; a rock stops the burst;
 * - cross: the target and its 4 neighbours (a rock centre absorbs everything, like the bomb);
 * - probe: looks at one cell without hitting it (earth, rock or unit), privately;
 * - precise: on one of your radar readings with units: hits an intact unit cell of that 3×3;
 * - double: two cells that are neither the same nor adjacent;
 * - ricochet: one cell; on a plain miss the shot bounces to a random neighbour not uncovered yet.
 */
export type ShotKind = 'single' | 'line3' | 'cross' | 'probe' | 'precise' | 'double' | 'ricochet';

export interface ShotKindDef {
  readonly kind: ShotKind;
  readonly name: string;
  /** It is the turn's shot (ends the turn unless an extra shot comes). The probe is not. */
  readonly isShot: boolean;
  /** A hit earns the usual extra shot (single-target kinds only). */
  readonly extraOnHit: boolean;
  readonly description: string;
}

export const SHOT_KINDS: Readonly<Record<ShotKind, ShotKindDef>> = {
  single: { kind: 'single', name: 'Tiro simples', isShot: true, extraOnHit: true, description: 'Atinge uma célula.' },
  line3: {
    kind: 'line3',
    name: 'Rajada',
    isShot: true,
    extraOnHit: false,
    description: 'Atinge 3 células em linha (para a direita ou para baixo). Uma rocha para a rajada. Não dá tiro extra.',
  },
  cross: {
    kind: 'cross',
    name: 'Cruz',
    isShot: true,
    extraOnHit: false,
    description: 'Atinge o alvo e as 4 vizinhas. Rocha no centro absorve tudo. Não dá tiro extra.',
  },
  probe: {
    kind: 'probe',
    name: 'Sonda',
    isShot: false,
    extraOnHit: false,
    description: 'Revela o conteúdo de uma célula (terra, rocha ou unidade) sem atingir. Só você vê. Não gasta o tiro.',
  },
  precise: {
    kind: 'precise',
    name: 'Tiro certeiro',
    isShot: true,
    extraOnHit: true,
    description: 'Mire no centro de um radar seu que achou unidades: acerta uma célula intacta daquele 3×3.',
  },
  double: {
    kind: 'double',
    name: 'Tiro duplo',
    isShot: true,
    extraOnHit: false,
    description: 'Atinge duas células que não sejam vizinhas. Não dá tiro extra.',
  },
  ricochet: {
    kind: 'ricochet',
    name: 'Ricochete',
    isShot: true,
    extraOnHit: true,
    description: 'Atinge uma célula; se cair em terra, ricocheteia para uma vizinha ainda não revelada.',
  },
};

export const SHOT_KIND_IDS: readonly ShotKind[] = ['single', 'line3', 'cross', 'probe', 'precise', 'double', 'ricochet'];

/** A faction's special shot: a kind plus what it costs. */
export interface SpecialShotDef {
  /** Stable id, e.g. 'sonda', 'tiro-certeiro', 'rajada'. */
  readonly id: string;
  /** Name shown to players (pt-BR). */
  readonly name: string;
  readonly kind: ShotKind;
  /** Energy per use (ignored when the mode has no energy). */
  readonly energy: number;
  /** Own turns before it can be used again. */
  readonly cooldown: number;
  /** Uses per match; null = unlimited (cooldown and energy only). */
  readonly charges: number | null;
  /** With charges spent, it can still be used by paying this much energy instead. Null = no recharge. */
  readonly rechargeEnergy: number | null;
  readonly description: string;
  /**
   * Costs for specific modes, by preset name (e.g. 'rapido-poderes'). The
   * power budget uses the base numbers; modes only re-tune the price.
   */
  readonly modes?: Readonly<Record<string, Partial<Pick<SpecialShotDef, 'energy' | 'cooldown' | 'charges' | 'rechargeEnergy'>>>>;
}

/** The special shot with the costs of a mode applied (null stays null). */
export function specialForMode(def: SpecialShotDef | null, mode: string): SpecialShotDef | null {
  const tune = def?.modes?.[mode];
  return def && tune ? { ...def, ...tune } : def;
}

/** What the player sends to fire the special shot. */
export interface SpecialShotRequest {
  readonly target: Coord;
  /** line3: 'row' goes right from the target, 'col' goes down. Default 'row'. */
  readonly axis?: LineAxis;
  /** double: the second cell. */
  readonly second?: Coord;
}

/**
 * Cells a pattern covers, in resolution order, or null when it does not fit
 * the board (or breaks its own shape rule). Precise and ricochet start on the
 * target; their final cell is chosen by the match.
 */
export function shotCells(size: GridSize, kind: ShotKind, request: SpecialShotRequest): number[] | null {
  if (!request || !isInside(size, request.target)) return null;
  const index = indexOf(size, request.target);
  switch (kind) {
    case 'single':
    case 'probe':
    case 'precise':
    case 'ricochet':
      return [index];
    case 'cross':
      return plusShape(size, index);
    case 'line3': {
      const axis = request.axis ?? 'row';
      if (axis !== 'row' && axis !== 'col') return null;
      const out: number[] = [];
      for (let step = 0; step < 3; step++) {
        const cell = axis === 'row' ? { col: request.target.col + step, row: request.target.row } : { col: request.target.col, row: request.target.row + step };
        if (!isInside(size, cell)) return null;
        out.push(indexOf(size, cell));
      }
      return out;
    }
    case 'double': {
      if (!request.second || !isInside(size, request.second)) return null;
      const second = indexOf(size, request.second);
      if (second === index || neighbors4(size, index).includes(second)) return null;
      return [index, second];
    }
    default:
      return null;
  }
}
