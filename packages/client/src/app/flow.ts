import type { AbilityId, Coord, LineAxis, ShotKind } from '@riverfront/core';

/**
 * The game controller's state machine, kept free of DOM and three.js so the
 * rules about "may the player act now?" are easy to test.
 *
 *   idle -> placing -> waiting (confirmed, opponent still placing) -> playing -> ended
 *
 * `busy` covers animations and requests in flight; `paused` and `offline`
 * freeze input on top of that.
 */

export type FlowPhase = 'idle' | 'placing' | 'waiting' | 'playing' | 'ended';

export type Targeting =
  | { readonly kind: 'shot' }
  | { readonly kind: 'ability'; readonly ability: AbilityId; readonly axis: LineAxis }
  | { readonly kind: 'special'; readonly shot: ShotKind; readonly axis: LineAxis; readonly first: Coord | null };

export interface FlowState {
  readonly phase: FlowPhase;
  readonly myTurn: boolean;
  readonly busy: boolean;
  readonly paused: boolean;
  readonly offline: boolean;
  readonly targeting: Targeting;
  /** Cell picked on a touch screen, waiting for the "Disparar" button. */
  readonly armed: Coord | null;
}

export type FlowEvent =
  | { readonly type: 'reset' }
  | { readonly type: 'placing' }
  | { readonly type: 'confirmed' }
  | { readonly type: 'playing'; readonly myTurn: boolean }
  | { readonly type: 'turn'; readonly myTurn: boolean }
  | { readonly type: 'busy'; readonly busy: boolean }
  | { readonly type: 'pause'; readonly paused: boolean }
  | { readonly type: 'offline'; readonly offline: boolean }
  | { readonly type: 'target'; readonly targeting: Targeting }
  | { readonly type: 'cancel' }
  | { readonly type: 'arm'; readonly cell: Coord | null }
  | { readonly type: 'ended' };

export const SHOT: Targeting = { kind: 'shot' };

export const INITIAL_FLOW: FlowState = {
  phase: 'idle',
  myTurn: false,
  busy: false,
  paused: false,
  offline: false,
  targeting: SHOT,
  armed: null,
};

export function reduceFlow(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'reset':
      return INITIAL_FLOW;
    case 'placing':
      return { ...INITIAL_FLOW, phase: 'placing', paused: state.paused, offline: state.offline };
    case 'confirmed':
      return state.phase === 'placing' ? { ...state, phase: 'waiting' } : state;
    case 'playing':
      return { ...state, phase: 'playing', myTurn: event.myTurn, targeting: SHOT, armed: null };
    case 'turn':
      if (state.phase !== 'playing') return state;
      // A new turn always starts with a plain shot selected.
      return event.myTurn === state.myTurn ? state : { ...state, myTurn: event.myTurn, targeting: SHOT, armed: null };
    case 'busy':
      return { ...state, busy: event.busy, armed: event.busy ? null : state.armed };
    case 'pause':
      return { ...state, paused: event.paused, armed: null };
    case 'offline':
      return { ...state, offline: event.offline, armed: null };
    case 'target':
      if (!canAim(state)) return state;
      return { ...state, targeting: event.targeting, armed: null };
    case 'cancel':
      if (state.armed) return { ...state, armed: null };
      if (state.targeting.kind === 'special' && state.targeting.first) return { ...state, targeting: { ...state.targeting, first: null } };
      return { ...state, targeting: SHOT };
    case 'arm':
      if (event.cell && !canAim(state)) return state;
      return { ...state, armed: event.cell };
    case 'ended':
      return { ...state, phase: 'ended', myTurn: false, busy: false, targeting: SHOT, armed: null };
  }
}

/** May the player aim and fire right now? */
export function canAim(state: FlowState): boolean {
  return state.phase === 'playing' && state.myTurn && !state.busy && !state.paused && !state.offline;
}

/** May the player edit the layout right now? */
export function canPlace(state: FlowState): boolean {
  return state.phase === 'placing' && !state.busy && !state.paused && !state.offline;
}

/** Which field a tap selects in the current targeting mode. */
export function targetField(targeting: Targeting): 'enemy' | 'own' {
  if (targeting.kind === 'ability' && (targeting.ability === 'shield' || targeting.ability === 'repair')) return 'own';
  return 'enemy';
}

/** Cells (relative to the aimed cell) a targeting mode covers, for the preview. */
export function footprintOf(targeting: Targeting, cols: number, rows: number, at: Coord): Coord[] {
  const inside = (c: Coord) => c.col >= 0 && c.row >= 0 && c.col < cols && c.row < rows;
  const plus = [at, { col: at.col + 1, row: at.row }, { col: at.col - 1, row: at.row }, { col: at.col, row: at.row + 1 }, { col: at.col, row: at.row - 1 }];
  const block: Coord[] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) block.push({ col: at.col + dc, row: at.row + dr });
  const line = (axis: LineAxis, length: number): Coord[] =>
    Array.from({ length }, (_, i) => (axis === 'row' ? { col: at.col + i, row: at.row } : { col: at.col, row: at.row + i }));

  if (targeting.kind === 'ability') {
    switch (targeting.ability) {
      case 'radar':
        return block.filter(inside);
      case 'bomb':
        return plus.filter(inside);
      case 'spy':
        return targeting.axis === 'row'
          ? Array.from({ length: cols }, (_, col) => ({ col, row: at.row }))
          : Array.from({ length: rows }, (_, row) => ({ col: at.col, row }));
      default:
        return [at];
    }
  }
  if (targeting.kind === 'special') {
    switch (targeting.shot) {
      case 'cross':
        return plus.filter(inside);
      case 'line3':
        return line(targeting.axis, 3).filter(inside);
      case 'precise':
        return block.filter(inside);
      case 'double':
        return targeting.first ? [targeting.first, at] : [at];
      default:
        return [at];
    }
  }
  return [at];
}
