import { describe, expect, it } from 'vitest';
import { CAMPAIGN, Match, dailyChallenge, dailyMatchOptions, missionMatchOptions, type SeatId } from '@riverfront/core';
import * as ai from '@riverfront/ai';
import { LocalHost, LocalTeamHost } from '../src/app/matchHost';
import { modeOfPreset, quickSetup, type MatchSetup } from '../src/app/modes';
import { PlacementEditor } from '../src/app/placement';

describe('configuração do desafio diário e da campanha', () => {
  it('a partida do desafio montada pelo menu se refaz como no servidor (mesmas opções)', () => {
    const c = dailyChallenge('2026-10-21');
    const setup: MatchSetup = { play: 'daily', mode: modeOfPreset(c.preset), clock: c.clock, level: c.botLevel, faction: c.playerFaction, botFaction: c.opponentFaction, mutators: c.mutators, seed: c.seed, daily: c.id };
    const host = new LocalHost(setup, ai.createBot(c.botLevel, { seed: 1 }));
    const reference = new Match(dailyMatchOptions(c, 0));
    expect(host.match.config).toEqual(reference.config);
    expect(host.view().own.cells).toEqual(reference.viewFor('blue').own.cells);
    expect(host.view().enemy.units).toEqual(reference.viewFor('blue').enemy.units);
  });

  it('as missões da campanha dão as mesmas opções de partida', () => {
    const mission = CAMPAIGN[0]!.missions[1]!;
    const options = missionMatchOptions(mission.id)!;
    const setup: MatchSetup = { play: 'campaign', mode: modeOfPreset(mission.preset), clock: 'unlimited', level: mission.botLevel, faction: mission.playerFaction, botFaction: mission.opponentFaction, mutators: mission.mutators, seed: mission.seed, mission: mission.id };
    const host = new LocalHost(setup, ai.createBot(mission.botLevel, { seed: 2 }));
    expect(host.match.config).toEqual(new Match(options).config);
    expect(host.view().mutators?.active).toEqual(mission.mutators);
  });
});

describe('duplas locais', () => {
  it('o jogador posiciona só as próprias peças e depois o time joga a partida inteira', () => {
    const seat: SeatId = 'blue-2';
    const setup: MatchSetup = { ...quickSetup(21), mode: 'classico', clock: 'unlimited', play: 'doubles', doubles: { seat, partnerLevel: 2 } };
    const bots = { 'blue-1': ai.createBot(1, { seed: 1 }), 'red-1': ai.createBot(1, { seed: 2 }), 'red-2': ai.createBot(1, { seed: 3 }) };
    const names = { 'blue-1': 'P', 'blue-2': 'Eu', 'red-1': 'A', 'red-2': 'B' };
    const host = new LocalTeamHost(setup, { seat, names }, bots, ai);
    host.placeBot();
    const view = host.view();
    const owned = new Set(Object.entries(view.doubles.pieceOwners).filter(([, s]) => s === seat).map(([id]) => id));
    const editor = new PlacementEditor(view, owned);
    // The partner (seat 1) already placed its pieces; they are locked.
    const partnerSlot = editor.pieces.findIndex((p) => !owned.has(p.id));
    expect(editor.isPlaced(partnerSlot)).toBe(true);
    expect(editor.pick(partnerSlot)).toBe(false);
    editor.auto(5);
    expect(editor.complete).toBe(true);
    expect(editor.issues()).toEqual([]);
    const mine = editor.placements().filter((p) => owned.has(p.pieceId));
    void host.submitLayout(mine, true);
    expect(host.view().phase).toBe('playing');

    let myTurns = 0;
    for (let guard = 0; guard < 4000 && host.view().phase === 'playing'; guard++) {
      const v = host.view();
      if (v.doubles.myTurn) {
        myTurns++;
        const cell = v.enemy.cells.find((c) => c.state === 'hidden')!;
        void host.attack({ col: cell.col, row: cell.row });
      } else expect(host.botStep()).not.toBeNull();
    }
    expect(host.view().phase).toBe('finished');
    expect(myTurns).toBeGreaterThan(3);
  });
});
