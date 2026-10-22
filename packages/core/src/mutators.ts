import { BANK_ROW } from './grid.ts';

/**
 * Optional rule changes for a match, set in `MatchOptions.mutators`:
 * - mare: every 6 turns the lake rises and the bank row of both fields is under water for 2 turns;
 * - tiro-duplo: two shots per turn and no extra shots;
 * - neblina: misses you uncovered fade from your map after 3 of your turns.
 */
export type MutatorId = 'mare' | 'tiro-duplo' | 'neblina';

export interface MutatorDef {
  readonly id: MutatorId;
  readonly name: string;
  readonly description: string;
}

export const MUTATORS: Readonly<Record<MutatorId, MutatorDef>> = {
  mare: {
    id: 'mare',
    name: 'Maré',
    description:
      'A cada 6 turnos a água sobe e cobre a margem (linha 1) dos dois campos por 2 turnos. Peças submersas não podem ser atingidas, exceto o anfíbio, que fica exposto (e aparece no radar).',
  },
  'tiro-duplo': {
    id: 'tiro-duplo',
    name: 'Tiro duplo',
    description: 'Dois tiros por turno, acertando ou não. Não há tiro extra.',
  },
  neblina: {
    id: 'neblina',
    name: 'Neblina',
    description: 'Erros (terra e rocha) somem do seu mapa depois de 3 turnos seus. Atirar de novo ali gasta o tiro.',
  },
};

export const MUTATOR_IDS = Object.keys(MUTATORS) as MutatorId[];

export function isMutatorId(value: unknown): value is MutatorId {
  return typeof value === 'string' && value in MUTATORS;
}

/** Tide timing, in match turns (each player's turn counts one). */
export const TIDE = {
  period: 6,
  /** Turns under water at the end of each period (turns 5–6, 11–12...). */
  duration: 2,
  rows: [BANK_ROW] as readonly number[],
} as const;

export interface TideState {
  readonly submerged: boolean;
  /** Turns until the water rises (0 while submerged). */
  readonly turnsUntilRise: number;
  /** Turns until it recedes (0 while dry). */
  readonly turnsUntilRecede: number;
}

/** Pure tide schedule for a turn number (1-based). */
export function tideAt(turnNumber: number): TideState {
  const phase = (Math.max(1, turnNumber) - 1) % TIDE.period;
  const dryTurns = TIDE.period - TIDE.duration;
  if (phase >= dryTurns) return { submerged: true, turnsUntilRise: 0, turnsUntilRecede: TIDE.period - phase };
  return { submerged: false, turnsUntilRise: dryTurns - phase, turnsUntilRecede: 0 };
}

/** Shots per turn under 'tiro-duplo'. */
export const DOUBLE_SHOTS = 2;

/** Under 'neblina', a miss fades after this many match turns (3 of your own). */
export const FOG_FADE_TURNS = 6;
