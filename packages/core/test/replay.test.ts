import { describe, expect, it } from 'vitest';
import {
  ABILITY_IDS,
  Match,
  createRng,
  type AbilityRequest,
  type ClockPresetId,
  type PresetId,
  type Rng,
} from '../src/index.ts';

function randomRequest(match: Match, rng: Rng): AbilityRequest {
  const id = rng.pick(ABILITY_IDS);
  const target = { col: rng.int(25), row: rng.int(7) };
  switch (id) {
    case 'radar':
    case 'bomb':
    case 'repair':
      return { ability: id, target };
    case 'shield':
      return { ability: 'shield', pieceId: rng.pick(match.pieces).id };
    case 'spy':
      return rng.next() < 0.5 ? { ability: 'spy', axis: 'row', index: rng.int(7) } : { ability: 'spy', axis: 'col', index: rng.int(25) };
  }
}

/** Plays a messy random match: manual placement edits, abilities, timeouts and drops. */
function playRandom(seed: number, preset: PresetId, clockId: ClockPresetId): Match {
  const rng = createRng(seed);
  const match = new Match({ seed, config: preset, clock: clockId, startTime: 1000 });
  let now = 1000;
  for (const player of ['blue', 'red'] as const) {
    match.autoPlace(player);
    const piece = rng.pick(match.pieces);
    match.rotate(player, piece.id);
    match.move(player, piece.id, { col: rng.int(25), row: rng.int(7) });
    if (match.viewFor(player).own.issues.length > 0) match.autoPlace(player);
    match.confirm(player);
  }
  for (let step = 0; step < 600 && match.phase === 'playing'; step++) {
    now += rng.int(4000);
    if (rng.next() < 0.03) now += 15_000;
    match.tick(now);
    if (match.phase !== 'playing') break;
    const player = match.turn;
    if (rng.next() < 0.02) {
      match.disconnect(player);
      now += rng.int(20_000);
      match.tick(now);
      match.reconnect(player);
      continue;
    }
    if (rng.next() < 0.35) match.useAbility(player, randomRequest(match, rng));
    const hidden = match.viewFor(player).enemy.cells.filter((c) => c.state === 'hidden' || c.state === 'spotted');
    if (hidden.length === 0) break;
    match.attack(player, rng.pick(hidden));
  }
  return match;
}

describe('event log and replay', () => {
  const cases: [PresetId, ClockPresetId][] = [
    ['full', 'unlimited'],
    ['full', 'relampago'],
    ['classic', 'padrao'],
  ];
  for (const [preset, clockId] of cases) {
    it(`replaying the log equals the live state (${preset}, ${clockId}, 30 seeds)`, () => {
      for (let seed = 1; seed <= 30; seed++) {
        const live = playRandom(seed, preset, clockId);
        const replayed = Match.fromRecord(live.toRecord());
        expect(replayed.serverState()).toEqual(live.serverState());
        expect(replayed.tick(live.now)).toEqual([]);
        expect(replayed.viewFor('blue')).toEqual(live.viewFor('blue'));
        expect(replayed.viewFor('red')).toEqual(live.viewFor('red'));
        expect(replayed.log).toEqual(live.log);
      }
    });
  }

  it('the record is plain JSON', () => {
    const live = playRandom(99, 'full', 'relampago');
    const record = JSON.parse(JSON.stringify(live.toRecord()));
    expect(Match.fromRecord(record).serverState()).toEqual(live.serverState());
  });

  it('a replayed match keeps playing exactly like the original', () => {
    const live = new Match({ seed: 5 });
    for (const p of ['blue', 'red'] as const) {
      live.autoPlace(p);
      live.confirm(p);
    }
    const copy = Match.fromLog(5, 'full', live.log);
    const rng = createRng(5);
    for (let i = 0; i < 80 && live.phase === 'playing'; i++) {
      const hidden = live.viewFor(live.turn).enemy.cells.filter((c) => c.state === 'hidden');
      const target = rng.pick(hidden);
      expect(copy.attack(copy.turn, target)).toEqual(live.attack(live.turn, target));
    }
  });

  it('logs every accepted action and nothing rejected', () => {
    const match = new Match({ seed: 2 });
    match.place('blue', 'armor-1', { col: 99, row: 0 });
    expect(match.log).toEqual([]);
    match.autoPlace('blue', 77);
    expect(match.log).toEqual([{ type: 'auto', player: 'blue', seed: 77, at: 0 }]);
  });

  it('refuses a tampered log', () => {
    const live = playRandom(3, 'full', 'unlimited');
    const log = [...live.log];
    const attackAt = log.findIndex((e) => e.type === 'attack');
    log.splice(attackAt, 0, { type: 'attack', player: 'red', target: { col: 0, row: 0 }, at: 0 });
    expect(() => Match.fromLog(3, 'full', log)).toThrow();
  });
});
