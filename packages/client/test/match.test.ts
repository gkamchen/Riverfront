import { describe, expect, it } from 'vitest';
import { CLASSIC_CONFIG, FULL_CONFIG, Match } from '@riverfront/core';
import { createBot } from '@riverfront/ai';
import { LocalHost, type HostUpdate } from '../src/app/matchHost';
import { GAME_MODES, canPause, isGameModeId, nextLevel, onlineModeOf, quickSetup, resolveModeConfig, trainingSetup } from '../src/app/modes';
import { PlacementEditor } from '../src/app/placement';
import { accuracy, summarize } from '../src/app/stats';

describe('modos de jogo', () => {
  it('liga os modos às configurações do core, pegando presets novos quando existem', () => {
    expect(resolveModeConfig('classico')).toBe(CLASSIC_CONFIG);
    expect(resolveModeConfig('completo')).toBe(FULL_CONFIG);
    expect(resolveModeConfig('rapido', {})).toBe(CLASSIC_CONFIG);
    const custom = { ...CLASSIC_CONFIG, name: 'rapido', rocks: 30 };
    expect(resolveModeConfig('rapido', { rapido: custom })).toBe(custom);
    expect(GAME_MODES.rapido.clock).toBe('relampago');
    expect(onlineModeOf('rapido-poderes')).toBe('full');
    expect(onlineModeOf('classico')).toBe('classic');
    expect(isGameModeId('completo')).toBe(true);
    expect(isGameModeId('nope')).toBe(false);
  });

  it('só partida local pausa; subir de nível para no 5', () => {
    expect(canPause('training')).toBe(true);
    expect(canPause('online')).toBe(false);
    expect(nextLevel(4)).toBe(5);
    expect(nextLevel(5)).toBeNull();
    expect(trainingSetup(1).clock).toBe('unlimited');
    expect(quickSetup(1).mode).toBe('completo');
  });
});

describe('editor de posicionamento', () => {
  const view = () => new Match({ seed: 7, config: 'full' }).viewFor('blue');

  it('aponta os mesmos erros de regra que a partida', () => {
    const editor = new PlacementEditor(view());
    const sniper = editor.pieces.findIndex((p) => p.role === 'artillery');
    editor.pick(sniper);
    // Artillery cannot stand on the bank row.
    const rock = view().own.cells.find((c) => c.terrain === 'rock')!;
    const onBank = editor.preview({ col: 12, row: 0 });
    expect(onBank?.ok).toBe(false);
    expect(['bank-row', 'on-rock']).toContain(onBank?.error);
    expect(rock).toBeDefined();
  });

  it('layout automático completo e legal; peça na mão volta ao cancelar', () => {
    const editor = new PlacementEditor(view());
    editor.auto(42);
    expect(editor.complete).toBe(true);
    expect(editor.issues()).toEqual([]);
    const before = editor.placements();
    const first = before[0]!;
    editor.pickAt(first.anchor.col, first.anchor.row);
    expect(editor.held).not.toBeNull();
    expect(editor.complete).toBe(false);
    editor.cancel();
    expect(editor.placements()).toEqual(expect.arrayContaining(before));
    expect(editor.complete).toBe(true);
  });

  it('girar pula orientações iguais', () => {
    const editor = new PlacementEditor(view());
    const recruit = editor.pieces.findIndex((p) => p.role === 'recruit');
    editor.pick(recruit);
    editor.rotateHeld();
    expect(editor.held?.rotation).toBe(0);
    const armor = editor.pieces.findIndex((p) => p.role === 'armor');
    editor.pick(armor);
    editor.rotateHeld();
    expect(editor.held?.rotation).toBe(1);
  });
});

describe('partida local', () => {
  it('joga uma partida inteira contra o bot e avisa cada mudança', () => {
    const setup = { ...quickSetup(11), mode: 'classico' as const, clock: 'unlimited' as const };
    const host = new LocalHost(setup, createBot(1, { seed: 3 }));
    const updates: HostUpdate[] = [];
    host.onUpdate((u) => updates.push(u));
    host.placeBot();
    const editor = new PlacementEditor(host.view());
    editor.auto(5);
    void host.submitLayout(editor.placements(), true);
    expect(host.view().phase).toBe('playing');

    for (let guard = 0; guard < 2000 && host.view().phase === 'playing'; guard++) {
      const view = host.view();
      if (view.turn === host.seat) {
        const cell = view.enemy.cells.find((c) => c.state === 'hidden')!;
        void host.attack({ col: cell.col, row: cell.row });
      } else host.botStep();
    }
    const end = host.view();
    expect(end.phase).toBe('finished');
    expect(end.enemy.layout).not.toBeNull();
    expect(updates.length).toBeGreaterThan(10);
    const stats = summarize(end.history, host.seat);
    expect(stats.own.shots + stats.enemy.shots).toBeGreaterThan(20);
    expect(accuracy(stats.own)).not.toBeNull();
  });

  it('o relógio virtual estoura a vez do jogador e nada anda enquanto ele não avança', () => {
    const setup = { ...quickSetup(12), mode: 'classico' as const, clock: 'relampago' as const };
    const host = new LocalHost(setup, createBot(1, { seed: 4 }));
    host.placeBot();
    const editor = new PlacementEditor(host.view());
    editor.auto(9);
    void host.submitLayout(editor.placements(), true);
    expect(host.view().turn).toBe('blue');
    host.advance(9_000);
    expect(host.view().turn).toBe('blue');
    host.advance(2_000);
    expect(host.view().own.clock.strikes).toBe(1);
    expect(host.view().turn).toBe('red');
  });
});
