import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN,
  FACTION_IDS,
  Match,
  addDailyResult,
  availableMissions,
  campaignStars,
  dailyChallenge,
  dailyMatchOptions,
  dailyRank,
  dailyResultFromMatch,
  dailyScore,
  emptyDailyBoard,
  missionMatchOptions,
  missionStatus,
  newCampaignProgress,
  parseCampaignProgress,
  parseDailyBoard,
  recordMission,
  startAutoMatch,
  type CampaignProgress,
} from '../src/index.ts';

describe('daily challenge', () => {
  it('same day, same challenge for everyone; days differ', () => {
    expect(dailyChallenge('2026-10-20')).toEqual(dailyChallenge(new Date('2026-10-20T23:59:00Z')));
    const days = Array.from({ length: 20 }, (_, i) => dailyChallenge(`2026-11-${String(i + 1).padStart(2, '0')}`));
    expect(new Set(days.map((d) => d.seed)).size).toBe(20);
    expect(new Set(days.map((d) => JSON.stringify([d.preset, d.mutators, d.playerFaction]))).size).toBeGreaterThan(3);
    for (const d of days) {
      expect(d.description.length).toBeGreaterThan(10);
      const match = startAutoMatch(dailyMatchOptions(d));
      expect(match.phase).toBe('playing');
      expect(match.factionOf('blue').id).toBe(d.playerFaction);
      expect(match.mutators).toEqual(d.mutators);
    }
  });

  it('scores fewer shots, then less time; losses by damage done', () => {
    const win = (shots: number, timeMs: number) => dailyScore({ won: true, shots, timeMs, destroyed: 24 });
    expect(win(40, 60_000)).toBeGreaterThan(win(50, 60_000));
    expect(win(40, 60_000)).toBeGreaterThan(win(40, 120_000));
    expect(win(400, 1e9)).toBe(1000);
    expect(dailyScore({ won: false, shots: 10, timeMs: 0, destroyed: 8 })).toBe(200);
    expect(win(500, 0)).toBeGreaterThan(dailyScore({ won: false, shots: 10, timeMs: 0, destroyed: 24 }));
  });

  it('the board keeps the best result per name, sorted, and survives JSON', () => {
    let board = emptyDailyBoard('2026-10-20');
    board = addDailyResult(board, { name: 'ana', won: true, shots: 50, timeMs: 90_000, destroyed: 24 });
    board = addDailyResult(board, { name: 'bia', won: true, shots: 40, timeMs: 90_000, destroyed: 24 });
    board = addDailyResult(board, { name: 'ana', won: false, shots: 10, timeMs: 10_000, destroyed: 5 });
    board = addDailyResult(board, { name: 'ana', won: true, shots: 38, timeMs: 95_000, destroyed: 24 });
    expect(board.entries.map((e) => [e.name, e.shots])).toEqual([['ana', 38], ['bia', 40]]);
    expect(dailyRank(board, 'bia')).toBe(2);
    expect(parseDailyBoard(JSON.parse(JSON.stringify(board)))).toEqual(board);
    expect(parseDailyBoard({ challengeId: 'x', entries: [{ name: 'z', won: true, shots: -1, timeMs: 0, destroyed: 0 }] })).toBeNull();
  });

  it('reads the result of a finished match', () => {
    const match = startAutoMatch(dailyMatchOptions(dailyChallenge('2026-10-21')));
    match.surrender('red');
    const result = dailyResultFromMatch(match as Match, 'ana', 1234);
    expect(result).toMatchObject({ name: 'ana', won: true, shots: 0, timeMs: 1234 });
  });
});

describe('campaign', () => {
  it('one arc per faction, three missions each with the arc signature mutator', () => {
    expect(CAMPAIGN).toHaveLength(FACTION_IDS.length - 1);
    for (const arc of CAMPAIGN) {
      expect(arc.missions).toHaveLength(3);
      for (const m of arc.missions) {
        expect(m.mutators).toContain(arc.signature);
        expect(m.playerFaction).toBe(arc.faction);
        const options = missionMatchOptions(m.id)!;
        expect(() => new Match(options)).not.toThrow();
      }
    }
    expect(CAMPAIGN.filter((a) => a.wave === 1).map((a) => a.title)).toEqual(['As cheias do Nilo', 'A disciplina do Tibre', 'A névoa do Egeu']);
  });

  it('missions unlock in order, arcs of the next wave after two arcs of the previous one', () => {
    let progress: CampaignProgress = newCampaignProgress();
    expect(availableMissions(progress).map((m) => m.id)).toEqual(['egito-1', 'roma-1', 'grecia-1']);
    expect(missionStatus(progress, 'egito-2')).toBe('locked');
    expect(recordMission(progress, 'egito-2', { won: true, shots: 10 })).toEqual({ ok: false, error: 'locked' });
    expect(missionStatus(progress, 'vikings-1')).toBe('locked');
    for (const arc of ['egito', 'roma']) {
      for (let i = 1; i <= 3; i++) {
        const r = recordMission(progress, `${arc}-${i}`, { won: true, shots: 20 });
        expect(r.ok).toBe(true);
        if (r.ok) progress = r.progress;
      }
    }
    expect(missionStatus(progress, 'egito-3')).toBe('won');
    expect(missionStatus(progress, 'vikings-1')).toBe('available');
    expect(missionStatus(progress, 'mongois-1')).toBe('locked');
    expect(campaignStars(progress)).toBe(18);
  });

  it('stars keep the best result and progress survives JSON', () => {
    let progress = newCampaignProgress();
    const lose = recordMission(progress, 'grecia-1', { won: false, shots: 90 });
    if (lose.ok) progress = lose.progress;
    expect(progress.missions['grecia-1']).toEqual({ won: false, stars: 0, bestShots: null, attempts: 1 });
    const slow = recordMission(progress, 'grecia-1', { won: true, shots: 200 });
    if (slow.ok) progress = slow.progress;
    const fast = recordMission(progress, 'grecia-1', { won: true, shots: 30 });
    if (fast.ok) progress = fast.progress;
    expect(progress.missions['grecia-1']).toEqual({ won: true, stars: 3, bestShots: 30, attempts: 3 });
    expect(parseCampaignProgress(JSON.parse(JSON.stringify(progress)))).toEqual(progress);
    expect(parseCampaignProgress({ missions: { 'x-9': { won: true } } })).toEqual(newCampaignProgress());
  });
});
