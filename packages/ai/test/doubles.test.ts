import { describe, expect, it } from 'vitest';
import { SEATS, TeamMatch, type SeatId } from '@riverfront/core';
import { MemoryStorage, createBot, runTeamBotMatch, type Bot, type BotLevel } from '../src/index.ts';

function seatBots(levels: Readonly<Record<SeatId, BotLevel>>, seed: number): Record<SeatId, Bot> {
  return Object.fromEntries(SEATS.map((s, i) => [s, createBot(levels[s], { seed: seed + i, storage: new MemoryStorage() })])) as Record<SeatId, Bot>;
}

describe('bots in doubles', () => {
  it('every level plays a whole doubles match without refused actions', () => {
    for (const level of [1, 2, 3, 4, 5] as BotLevel[]) {
      const result = runTeamBotMatch({
        seed: 10 + level,
        config: level % 2 ? 'full' : 'rapido-poderes',
        bots: seatBots({ 'blue-1': level, 'blue-2': level, 'red-1': 3, 'red-2': 3 }, level),
        factions: { blue: 'grecia', red: 'egito' },
        mutators: level === 5 ? ['mare'] : [],
      });
      expect(result.rejected).toBe(0);
      expect(result.winner).not.toBeNull();
      expect(result.match.winReason).toBe('destroyed');
    }
  });

  it('is deterministic and replays from the record', () => {
    const play = () =>
      runTeamBotMatch({ seed: 4, config: 'full', bots: seatBots({ 'blue-1': 4, 'blue-2': 2, 'red-1': 5, 'red-2': 1 }, 9), mutators: ['neblina'] }).match;
    const a = play();
    expect(a.log).toEqual(play().log);
    expect(TeamMatch.fromRecord(JSON.parse(JSON.stringify(a.toRecord()))).serverState()).toEqual(a.serverState());
  });

  it('a stronger pair beats a weaker one most of the time', () => {
    let strong = 0;
    for (let g = 0; g < 8; g++) {
      const strongTeam = g % 2 ? 'blue' : 'red';
      const levels = (team: 'blue' | 'red'): [BotLevel, BotLevel] => (team === strongTeam ? [4, 4] : [1, 1]);
      const [b1, b2] = levels('blue');
      const [r1, r2] = levels('red');
      const result = runTeamBotMatch({ seed: 100 + g, config: 'full', bots: seatBots({ 'blue-1': b1, 'blue-2': b2, 'red-1': r1, 'red-2': r2 }, g) });
      if (result.winner === strongTeam) strong++;
    }
    expect(strong).toBeGreaterThanOrEqual(7);
  });
});
