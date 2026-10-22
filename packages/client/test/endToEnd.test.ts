import { describe, expect, it } from 'vitest';
import { CAMPAIGN, addDailyResult, dailyChallenge, dailyRank, dailyResultFromMatch, dailyScore, emptyDailyBoard } from '@riverfront/core';
import * as ai from '@riverfront/ai';
import { FieldBoard } from '../src/app/fieldBoard';
import { LocalHost } from '../src/app/matchHost';
import { modeOfPreset, quickSetup, type MatchSetup } from '../src/app/modes';
import { PlacementEditor } from '../src/app/placement';
import { CampaignStore, MemoryKeyValueStore } from '../src/net/storage';
import type { Board } from '../src/board/board';

/** Plays a local match to the end the way the controller does: one bot decision at a time, virtual clock. */
function playOut(host: LocalHost): void {
  host.placeBot();
  const editor = new PlacementEditor(host.view());
  editor.auto(17);
  void host.submitLayout(editor.placements(), true);
  for (let guard = 0; guard < 6000 && host.view().phase === 'playing'; guard++) {
    host.advance(700);
    const v = host.view();
    if (v.phase !== 'playing') break;
    if (v.turn === host.seat) {
      const submerged = v.mutators?.tide?.submerged ? new Set(v.mutators.tide.rows) : new Set<number>();
      const cell = v.enemy.cells.find((c) => c.state === 'hidden' && !submerged.has(c.row)) ?? v.enemy.cells.find((c) => c.state === 'hidden');
      if (cell) void host.attack({ col: cell.col, row: cell.row });
    } else host.botStep();
  }
}

describe('ponta a ponta (lado das regras das telas)', () => {
  it('desafio diário: joga, pontua e entra na tabela local', () => {
    const c = dailyChallenge('2026-10-22');
    const setup: MatchSetup = { play: 'daily', mode: modeOfPreset(c.preset), clock: c.clock, level: c.botLevel, faction: c.playerFaction, botFaction: c.opponentFaction, mutators: c.mutators, seed: c.seed, daily: c.id };
    const host = new LocalHost(setup, ai.createBot(c.botLevel, { seed: c.seed ^ 0x5bd1e995, storage: new ai.MemoryStorage() }));
    playOut(host);
    expect(host.view().phase).toBe('finished');
    const result = dailyResultFromMatch(host.match, 'Tester', host.now());
    const board = addDailyResult(emptyDailyBoard(c.id), result);
    expect(dailyRank(board, 'Tester')).toBe(1);
    expect(board.entries[0]!.score).toBe(dailyScore(result));
  });

  it('missão da campanha contra bot só dá estrelas na vitória', () => {
    const mission = CAMPAIGN.find((a) => a.faction === 'egito')!.missions[0]!;
    const setup: MatchSetup = { play: 'campaign', mode: modeOfPreset(mission.preset), clock: 'unlimited', level: 1, faction: mission.playerFaction, botFaction: mission.opponentFaction, mutators: mission.mutators, seed: mission.seed, mission: mission.id };
    const host = new LocalHost(setup, ai.createBot(1, { seed: 9, storage: new ai.MemoryStorage() }));
    playOut(host);
    const won = host.view().winner === 'blue';
    const shots = dailyResultFromMatch(host.match, 'x', 0).shots;
    const store = new CampaignStore(new MemoryKeyValueStore());
    const recorded = store.record(mission.id, { won, shots });
    expect(recorded.ok).toBe(true);
    expect(store.progress.missions[mission.id]?.won).toBe(won);
    if (!won) expect(store.progress.missions[mission.id]?.stars).toBe(0);
  });

  it('partida rápida 15x5 com maré vai até o fim e fica centralizada no tabuleiro', () => {
    const setup: MatchSetup = { ...quickSetup(33), mode: 'rapido', clock: 'unlimited', mutators: ['mare'] };
    const host = new LocalHost(setup, ai.createBot(1, { seed: 4 }));
    expect(host.view().config.cols).toBe(15);
    playOut(host);
    expect(host.view().phase).toBe('finished');
    expect(host.view().history.some((e) => e.kind === 'tide')).toBe(true);

    const field = new FieldBoard({} as Board, 15, 5);
    expect(field.offset).toBe(5);
    expect(field.index(0, 0)).toBe(5);
    expect(field.toMatch({ side: 'enemy', col: 4, row: 0 })).toBeNull();
    expect(field.toMatch({ side: 'enemy', col: 19, row: 4 })).toEqual({ side: 'enemy', col: 14, row: 4 });
    expect(field.toMatch({ side: 'enemy', col: 10, row: 5 })).toBeNull();
  });
});
