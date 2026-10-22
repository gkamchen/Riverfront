import type { HistoryEntry, PlayerId, PlayerView, ShotReport } from '@riverfront/core';

export interface SideStats {
  shots: number;
  hits: number;
  misses: number;
  rocks: number;
  destroyed: number;
  abilities: number;
  specials: number;
  timeouts: number;
}

export interface MatchStats {
  readonly own: SideStats;
  readonly enemy: SideStats;
  readonly turns: number;
}

function empty(): SideStats {
  return { shots: 0, hits: 0, misses: 0, rocks: 0, destroyed: 0, abilities: 0, specials: 0, timeouts: 0 };
}

function count(stats: SideStats, report: ShotReport): void {
  stats.shots++;
  switch (report.result) {
    case 'hit':
      stats.hits++;
      break;
    case 'destroyed':
      stats.hits++;
      stats.destroyed++;
      break;
    case 'rock':
      stats.rocks++;
      stats.misses++;
      break;
    case 'earth':
    case 'submerged':
      stats.misses++;
      break;
    case 'shield':
      break;
  }
}

/** Per-side tallies from the public history (works for local and online matches). */
export function summarize(history: readonly HistoryEntry[], player: PlayerId): MatchStats {
  const own = empty();
  const enemy = empty();
  let turns = 0;
  for (const entry of history) {
    turns = Math.max(turns, entry.turn);
    const side = 'by' in entry ? (entry.by === player ? own : enemy) : null;
    switch (entry.kind) {
      case 'shot':
      case 'tower':
        if (side) count(side, entry.report);
        break;
      case 'ability':
        if (side) side.abilities++;
        if (side && entry.outcome && entry.outcome.ability === 'bomb') for (const s of entry.outcome.shots) count(side, s);
        break;
      case 'special':
        if (side) side.specials++;
        if (side && entry.outcome) for (const s of entry.outcome.shots) count(side, s);
        break;
      case 'timeout':
        if (side) side.timeouts++;
        break;
      default:
        break;
    }
  }
  return { own, enemy, turns };
}

export function accuracy(stats: SideStats): number | null {
  return stats.shots === 0 ? null : stats.hits / stats.shots;
}

export function statsOf(view: PlayerView): MatchStats {
  return summarize(view.history, view.player);
}
