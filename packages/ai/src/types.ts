import type { AbilityRequest, Coord, FactionId, Placement, PlayerView, SpecialShotRequest } from '@riverfront/core';
import type { LeaderPersona } from './leaders.ts';
import type { BotStorage } from './learning.ts';
import type { TrainedParamsFile } from './params.ts';

export type BotAction =
  | { readonly type: 'attack'; readonly target: Coord }
  | { readonly type: 'ability'; readonly request: AbilityRequest }
  | { readonly type: 'special'; readonly request: SpecialShotRequest };

export type TauntEvent = 'onHit' | 'onMiss' | 'onLostPiece' | 'onWin' | 'onLose' | 'onIdle';

export type BotLevel = 1 | 2 | 3 | 4 | 5;

export type BotId = 'pipoca' | 'rotina' | 'neblina' | 'xadrez' | 'abismo';

export interface BotProfile {
  readonly id: BotId;
  readonly level: BotLevel;
  readonly name: string;
  readonly personality: string;
  readonly taunts: Readonly<Record<TauntEvent, string>>;
  /** Set when the bot plays as a faction commander (name and personality then come from the leader). */
  readonly faction?: FactionId;
  readonly leader?: LeaderPersona;
}

/**
 * How hard a bot may think per decision. `samples` keeps it deterministic;
 * `maxMs` adds a wall-clock cap (handy in a slow browser, but then results
 * depend on the machine).
 */
export interface ThinkingBudget {
  readonly samples: number;
  readonly maxMs?: number;
}

export interface BotOptions {
  readonly seed: number;
  /** Where learned habits persist between matches (localStorage works). */
  readonly storage?: BotStorage | null;
  readonly budget?: Partial<ThinkingBudget>;
  /**
   * Faction the bot commands. With a wave-1 faction the bot takes that
   * leader's name and lines; the playing strength still comes from the level.
   */
  readonly faction?: FactionId;
  /**
   * Use what `npm run train` saved in `trained/` (parameters and priors).
   * Default true; false plays with the hand-made defaults (baseline).
   */
  readonly trained?: boolean;
  /** Explicit parameter overrides (used by the training search). */
  readonly params?: TrainedParamsFile['params'];
  /** Forces the trained priors on or off (default: what `trained/params.json` says for the level). */
  readonly priors?: boolean;
}

export interface DecideOptions {
  /** False after the match refused an ability this turn. */
  readonly allowAbility?: boolean;
  /** False after the match refused the special shot this turn. */
  readonly allowSpecial?: boolean;
}

/**
 * A computer opponent. It only ever sees its own `PlayerView`, exactly what a
 * human player would get.
 */
export interface Bot {
  readonly profile: BotProfile;
  /** Layout for the placement phase, built from the bot's own view. */
  placeLayout(view: PlayerView): Placement[];
  /** Next action on the bot's turn; call again while the turn lasts. */
  decide(view: PlayerView, options?: DecideOptions): BotAction;
  /** Final view of a finished match, so learning bots can study it. */
  gameOver(view: PlayerView): void;
  taunt(event: TauntEvent): string;
}
