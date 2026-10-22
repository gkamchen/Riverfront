import type { AbilityRequest } from './abilities.ts';
import type { ClockConfig, ClockPresetId } from './clock.ts';
import type { FieldConfig } from './config.ts';
import type { FactionDef, FactionId } from './factions.ts';
import type { MutatorId } from './mutators.ts';
import type { Placement } from './placement.ts';
import type { SpecialShotRequest } from './shots.ts';
import type { Coord, PlayerId, Rotation } from './types.ts';

/**
 * Every accepted action, in order, with the clock time it happened at.
 * Replaying the log on a match built from the same seed and config gives the
 * same state. The log holds both layouts: keep it on the authoritative side.
 */
export type LogEntry =
  | { readonly type: 'place'; readonly player: PlayerId; readonly pieceId: string; readonly anchor: Coord; readonly rotation: Rotation; readonly at: number }
  | { readonly type: 'move'; readonly player: PlayerId; readonly pieceId: string; readonly anchor: Coord; readonly at: number }
  | { readonly type: 'rotate'; readonly player: PlayerId; readonly pieceId: string; readonly rotation: Rotation; readonly at: number }
  | { readonly type: 'remove'; readonly player: PlayerId; readonly pieceId: string; readonly at: number }
  | { readonly type: 'layout'; readonly player: PlayerId; readonly placements: readonly Placement[]; readonly at: number }
  | { readonly type: 'auto'; readonly player: PlayerId; readonly seed: number; readonly at: number }
  | { readonly type: 'confirm'; readonly player: PlayerId; readonly at: number }
  | { readonly type: 'attack'; readonly player: PlayerId; readonly target: Coord; readonly at: number }
  | { readonly type: 'ability'; readonly player: PlayerId; readonly request: AbilityRequest; readonly at: number }
  | { readonly type: 'special'; readonly player: PlayerId; readonly request: SpecialShotRequest; readonly at: number }
  /**
   * Automatic shot of a tower. It follows from the seed and the turn count, so
   * a replay fires it again by itself; the entry lets the replay check it.
   */
  | { readonly type: 'tower'; readonly player: PlayerId; readonly target: Coord; readonly at: number }
  | { readonly type: 'timeout'; readonly player: PlayerId; readonly at: number }
  | { readonly type: 'surrender'; readonly player: PlayerId; readonly at: number }
  | { readonly type: 'disconnect'; readonly player: PlayerId; readonly at: number }
  | { readonly type: 'reconnect'; readonly player: PlayerId; readonly at: number }
  | { readonly type: 'abandon'; readonly player: PlayerId; readonly at: number };

/** Everything needed to rebuild a match: options plus its log. */
export interface MatchRecord {
  readonly seed: number;
  readonly config: FieldConfig;
  readonly firstTurn: PlayerId;
  readonly clock: ClockConfig | ClockPresetId;
  readonly startTime: number;
  readonly log: readonly LogEntry[];
  /** Absent in records made before factions existed (= neutral). */
  readonly factions?: Readonly<Partial<Record<PlayerId, FactionId | FactionDef>>>;
  readonly mutators?: readonly MutatorId[];
}
