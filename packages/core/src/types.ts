export type PlayerId = 'blue' | 'red';

export const PLAYERS: readonly PlayerId[] = ['blue', 'red'];

export function opponentOf(player: PlayerId): PlayerId {
  return player === 'blue' ? 'red' : 'blue';
}

export interface Coord {
  readonly col: number;
  readonly row: number;
}

/** Quarter turns clockwise. */
export type Rotation = 0 | 1 | 2 | 3;

export type Terrain = 'earth' | 'rock';

export type Result<T = object, E extends string = string> =
  | ({ readonly ok: true } & T)
  | { readonly ok: false; readonly error: E };
