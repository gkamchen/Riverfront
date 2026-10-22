/**
 * Turn clock maths for the HUD. Pure: the caller passes the time, so the same
 * code serves local matches (virtual clock that stops on pause) and online
 * ones (server deadline corrected to the local clock).
 */

export interface ClockInput {
  readonly now: number;
  readonly turnStartedAt: number;
  /** Per-turn time; null = no limit. */
  readonly turnMs: number | null;
  /** When the turn times out (turn time plus reserve); null without a limit or while frozen. */
  readonly deadline: number | null;
  readonly frozen: boolean;
}

export type ClockPhase = 'none' | 'turn' | 'bank' | 'frozen';

export interface ClockReading {
  readonly phase: ClockPhase;
  /** Milliseconds until the turn is lost (turn + reserve), null without a limit. */
  readonly leftMs: number | null;
  /** Milliseconds left of the turn's own time (0 once the reserve is being spent). */
  readonly turnLeftMs: number | null;
  /** Reserve left while it is being spent, otherwise the whole reserve. */
  readonly bankLeftMs: number | null;
  /** Warning level for styling: 0 calm, 10 and 5 seconds. */
  readonly warn: 0 | 10 | 5;
  readonly text: string;
}

/** "0:42", "1:05"; under 10 s shows tenths would be noisy, so whole seconds only. */
export function formatSeconds(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Elapsed time, "mm:ss" (used for stats). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function warnLevel(leftMs: number | null): 0 | 10 | 5 {
  if (leftMs === null) return 0;
  if (leftMs <= 5_000) return 5;
  if (leftMs <= 10_000) return 10;
  return 0;
}

export function readClock(input: ClockInput): ClockReading {
  if (input.turnMs === null) {
    return { phase: 'none', leftMs: null, turnLeftMs: null, bankLeftMs: null, warn: 0, text: '∞' };
  }
  if (input.frozen || input.deadline === null) {
    return { phase: 'frozen', leftMs: null, turnLeftMs: null, bankLeftMs: null, warn: 0, text: '—' };
  }
  const leftMs = Math.max(0, input.deadline - input.now);
  const turnEnd = input.turnStartedAt + input.turnMs;
  const turnLeftMs = Math.max(0, turnEnd - input.now);
  const bankTotal = Math.max(0, input.deadline - turnEnd);
  const inBank = turnLeftMs <= 0 && bankTotal > 0;
  const bankLeftMs = inBank ? leftMs : bankTotal;
  const shown = inBank ? leftMs : turnLeftMs;
  return {
    phase: inBank ? 'bank' : 'turn',
    leftMs,
    turnLeftMs,
    bankLeftMs,
    warn: warnLevel(leftMs),
    text: formatSeconds(shown),
  };
}

/**
 * The 10 s / 5 s cue to play when the countdown crosses a threshold between two
 * readings (each cue once per turn, also when frames are skipped).
 */
export function crossedWarning(previousMs: number | null, currentMs: number | null): 10 | 5 | null {
  if (previousMs === null || currentMs === null || currentMs >= previousMs) return null;
  if (previousMs > 5_000 && currentMs <= 5_000) return 5;
  if (previousMs > 10_000 && currentMs <= 10_000) return 10;
  return null;
}

/** Per-second tick during the last five seconds. */
export function crossedSecond(previousMs: number | null, currentMs: number | null): boolean {
  if (previousMs === null || currentMs === null || currentMs > 5_000 || currentMs <= 0) return false;
  return Math.ceil(previousMs / 1000) !== Math.ceil(currentMs / 1000);
}

/** Doubles: the team view only gives the deadline of the seat on turn (turn time plus its reserve). */
export function seatReading(deadline: number | null, now: number): ClockReading {
  if (deadline === null) return { phase: 'none', leftMs: null, turnLeftMs: null, bankLeftMs: null, warn: 0, text: '∞' };
  const leftMs = Math.max(0, deadline - now);
  return { phase: 'turn', leftMs, turnLeftMs: leftMs, bankLeftMs: null, warn: warnLevel(leftMs), text: formatSeconds(leftMs) };
}