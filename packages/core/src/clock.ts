/**
 * Turn clock. Nothing here reads the system time: every function receives the
 * current time (ms) from the caller, so it behaves the same live, in tests and
 * in replays.
 */

export type ClockPresetId = 'relampago' | 'padrao' | 'tranquilo' | 'unlimited';

export interface ClockConfig {
  readonly id: ClockPresetId | 'custom';
  /** Time per turn; null means no limit. */
  readonly turnMs: number | null;
  /** Reserve spent once the turn time runs out. */
  readonly bankMs: number;
  readonly maxConsecutiveStrikes: number;
  readonly maxStrikes: number;
  /** Longest single disconnection tolerated. */
  readonly graceDropMs: number;
  /** Total disconnection tolerated over the match. */
  readonly graceTotalMs: number;
}

const BASE = { maxConsecutiveStrikes: 3, maxStrikes: 5, graceDropMs: 45_000, graceTotalMs: 90_000 } as const;

export const CLOCK_PRESETS: Readonly<Record<ClockPresetId, ClockConfig>> = {
  relampago: { id: 'relampago', turnMs: 10_000, bankMs: 0, ...BASE },
  padrao: { id: 'padrao', turnMs: 30_000, bankMs: 60_000, ...BASE },
  tranquilo: { id: 'tranquilo', turnMs: 60_000, bankMs: 120_000, ...BASE },
  unlimited: { id: 'unlimited', turnMs: null, bankMs: 0, ...BASE },
};

export function resolveClock(clock: ClockPresetId | ClockConfig | undefined): ClockConfig {
  if (clock === undefined) return CLOCK_PRESETS.unlimited;
  if (typeof clock === 'string') {
    const preset = CLOCK_PRESETS[clock];
    if (!preset) throw new Error(`Unknown clock preset: ${String(clock)}`);
    return preset;
  }
  return clock;
}

/** Per-player clock bookkeeping. Plain data so it can be logged and compared. */
export interface ClockState {
  readonly bankMs: number;
  readonly strikes: number;
  readonly consecutiveStrikes: number;
  /** When the current disconnection started, or null while connected. */
  readonly disconnectedAt: number | null;
  readonly graceUsedMs: number;
}

export function initialClock(config: ClockConfig): ClockState {
  return { bankMs: config.bankMs, strikes: 0, consecutiveStrikes: 0, disconnectedAt: null, graceUsedMs: 0 };
}

/** Milliseconds left in the current turn (turn time + bank), or null without a limit. */
export function timeLeft(config: ClockConfig, state: ClockState, elapsedMs: number): number | null {
  if (config.turnMs === null) return null;
  return Math.max(0, config.turnMs + state.bankMs - elapsedMs);
}

/** Moment the turn times out, or null without a limit. */
export function turnDeadline(config: ClockConfig, state: ClockState, turnStartedAt: number): number | null {
  if (config.turnMs === null) return null;
  return turnStartedAt + config.turnMs + state.bankMs;
}

/** Charges the bank for whatever the turn took beyond its own time. */
export function spendTurn(config: ClockConfig, state: ClockState, elapsedMs: number): ClockState {
  if (config.turnMs === null) return state;
  const overflow = Math.max(0, elapsedMs - config.turnMs);
  return overflow > 0 ? { ...state, bankMs: Math.max(0, state.bankMs - overflow) } : state;
}

/** A timeout: the turn is skipped and a strike recorded. */
export function addStrike(config: ClockConfig, state: ClockState): { state: ClockState; forfeit: boolean } {
  const next: ClockState = {
    ...state,
    bankMs: 0,
    strikes: state.strikes + 1,
    consecutiveStrikes: state.consecutiveStrikes + 1,
  };
  const forfeit = next.consecutiveStrikes >= config.maxConsecutiveStrikes || next.strikes >= config.maxStrikes;
  return { state: next, forfeit };
}

/** Any shot clears the consecutive-strike counter. */
export function registerShot(state: ClockState): ClockState {
  return state.consecutiveStrikes === 0 ? state : { ...state, consecutiveStrikes: 0 };
}

export function disconnect(state: ClockState, now: number): ClockState {
  return state.disconnectedAt === null ? { ...state, disconnectedAt: now } : state;
}

export function reconnect(state: ClockState, now: number): ClockState {
  if (state.disconnectedAt === null) return state;
  return { ...state, disconnectedAt: null, graceUsedMs: state.graceUsedMs + Math.max(0, now - state.disconnectedAt) };
}

/** Grace left for the current disconnection (the smaller of both limits), or null while connected. */
export function graceLeft(config: ClockConfig, state: ClockState, now: number): number | null {
  if (state.disconnectedAt === null) return null;
  const away = Math.max(0, now - state.disconnectedAt);
  return Math.max(0, Math.min(config.graceDropMs - away, config.graceTotalMs - state.graceUsedMs - away));
}

/** Moment the grace runs out, or null while connected. */
export function graceDeadline(config: ClockConfig, state: ClockState): number | null {
  if (state.disconnectedAt === null) return null;
  return state.disconnectedAt + Math.max(0, Math.min(config.graceDropMs, config.graceTotalMs - state.graceUsedMs));
}

export function graceExpired(config: ClockConfig, state: ClockState, now: number): boolean {
  const deadline = graceDeadline(config, state);
  return deadline !== null && now >= deadline;
}
