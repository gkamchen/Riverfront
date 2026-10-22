import { describe, expect, it } from 'vitest';
import { CLOCK_PRESETS, clock, resolveClock } from '../src/index.ts';
import { miss, ready } from './helpers.ts';

const padrao = CLOCK_PRESETS.padrao;

describe('clock presets and pure helpers', () => {
  it('has the four presets', () => {
    expect(CLOCK_PRESETS.relampago).toMatchObject({ turnMs: 10_000, bankMs: 0 });
    expect(CLOCK_PRESETS.padrao).toMatchObject({ turnMs: 30_000, bankMs: 60_000 });
    expect(CLOCK_PRESETS.tranquilo).toMatchObject({ turnMs: 60_000, bankMs: 120_000 });
    expect(CLOCK_PRESETS.unlimited.turnMs).toBeNull();
    expect(resolveClock(undefined)).toBe(CLOCK_PRESETS.unlimited);
    expect(() => resolveClock('turbo' as never)).toThrow();
  });

  it('timeLeft adds the bank to the turn time', () => {
    const state = clock.initialClock(padrao);
    expect(clock.timeLeft(padrao, state, 0)).toBe(90_000);
    expect(clock.timeLeft(padrao, state, 100_000)).toBe(0);
    expect(clock.timeLeft(CLOCK_PRESETS.unlimited, state, 1e9)).toBeNull();
    expect(clock.turnDeadline(padrao, state, 1000)).toBe(91_000);
  });

  it('spendTurn only charges the overflow to the bank', () => {
    const state = clock.initialClock(padrao);
    expect(clock.spendTurn(padrao, state, 20_000).bankMs).toBe(60_000);
    expect(clock.spendTurn(padrao, state, 45_000).bankMs).toBe(45_000);
    expect(clock.spendTurn(padrao, state, 500_000).bankMs).toBe(0);
  });

  it('three consecutive strikes forfeit', () => {
    let state = clock.initialClock(padrao);
    let result = clock.addStrike(padrao, state);
    expect(result.forfeit).toBe(false);
    result = clock.addStrike(padrao, result.state);
    expect(result.forfeit).toBe(false);
    result = clock.addStrike(padrao, result.state);
    expect(result.forfeit).toBe(true);
    state = result.state;
    expect(state.strikes).toBe(3);
    expect(state.bankMs).toBe(0);
  });

  it('a shot resets the consecutive counter, but five in total still forfeit', () => {
    let state = clock.initialClock(padrao);
    let forfeit = false;
    for (let i = 0; i < 5; i++) {
      const r = clock.addStrike(padrao, state);
      state = clock.registerShot(r.state);
      forfeit = r.forfeit;
      expect(state.consecutiveStrikes).toBe(0);
    }
    expect(forfeit).toBe(true);
    expect(state.strikes).toBe(5);
  });

  it('disconnection grace: 45 s per drop, 90 s in total', () => {
    let state = clock.initialClock(padrao);
    state = clock.disconnect(state, 0);
    expect(clock.graceLeft(padrao, state, 10_000)).toBe(35_000);
    expect(clock.graceExpired(padrao, state, 44_999)).toBe(false);
    expect(clock.graceExpired(padrao, state, 45_000)).toBe(true);
    state = clock.reconnect(state, 40_000);
    expect(state.graceUsedMs).toBe(40_000);
    state = clock.disconnect(clock.reconnect(clock.disconnect(state, 50_000), 90_000), 100_000);
    expect(state.graceUsedMs).toBe(80_000);
    expect(clock.graceLeft(padrao, state, 100_000)).toBe(10_000);
    expect(clock.graceExpired(padrao, state, 110_000)).toBe(true);
    expect(clock.graceLeft(padrao, clock.initialClock(padrao), 5)).toBeNull();
  });
});

describe('match clock', () => {
  it('a timeout skips the turn and records a strike', () => {
    const match = ready({ seed: 1, clock: 'relampago' });
    expect(match.tick(9_999)).toEqual([]);
    expect(match.tick(10_000)).toEqual([{ type: 'timeout', player: 'blue', forfeit: false }]);
    expect(match.turn).toBe('red');
    expect(match.viewFor('blue').own.clock.strikes).toBe(1);
    expect(match.viewFor('red').history.at(-1)).toMatchObject({ kind: 'timeout', by: 'blue' });
  });

  it('timed-out turns grant no energy refund but the next player starts fresh', () => {
    const match = ready({ seed: 1, clock: 'relampago' });
    match.tick(10_000);
    expect(match.viewFor('red').clock.turnStartedAt).toBe(10_000);
    expect(match.viewFor('red').clock.deadline).toBe(20_000);
  });

  it('three consecutive timeouts forfeit the match', () => {
    const match = ready({ seed: 1, clock: 'relampago' });
    let now = 0;
    for (let i = 0; i < 3; i++) {
      now += 10_000;
      match.tick(now); // blue times out
      if (match.phase !== 'playing') break;
      now += 1_000;
      match.tick(now);
      miss(match); // red plays
    }
    expect(match.winner).toBe('red');
    expect(match.winReason).toBe('timeout');
  });

  it('a shot in between resets the consecutive count; five in total still forfeit', () => {
    const match = ready({ seed: 1, clock: 'relampago' });
    let now = 0;
    for (let round = 0; round < 5 && match.phase === 'playing'; round++) {
      now += 10_000;
      match.tick(now); // blue times out
      if (match.phase !== 'playing') break;
      miss(match); // red
      miss(match); // blue shoots: the consecutive count resets
      miss(match); // red
      expect(match.viewFor('blue').own.clock.consecutiveStrikes).toBe(0);
      now = match.viewFor('blue').clock.turnStartedAt;
    }
    expect(match.viewFor('blue').own.clock.strikes).toBe(5);
    expect(match.winner).toBe('red');
  });

  it('several turns can expire in one big jump', () => {
    const match = ready({ seed: 1, clock: 'relampago' });
    const events = match.tick(25_000);
    expect(events.map((e) => e.player)).toEqual(['blue', 'red']);
    expect(match.turn).toBe('blue');
  });

  it('the bank absorbs slow turns', () => {
    const match = ready({ seed: 1, clock: 'padrao' });
    expect(match.tick(50_000)).toEqual([]);
    miss(match);
    expect(match.viewFor('blue').own.clock.bankMs).toBe(40_000);
    expect(match.viewFor('blue').clock.deadline).toBe(50_000 + 90_000);
  });

  it('applyTimeout is the explicit server-side version', () => {
    const match = ready({ seed: 1, clock: 'padrao' });
    expect(match.applyTimeout('red')).toEqual({ ok: false, error: 'not-your-turn' });
    expect(match.applyTimeout('blue').ok).toBe(true);
    expect(match.turn).toBe('red');
  });

  it('a disconnection freezes the clock and shifts the deadline', () => {
    const match = ready({ seed: 1, clock: 'relampago' });
    match.tick(5_000);
    match.disconnect('red');
    expect(match.viewFor('blue').clock.frozen).toBe(true);
    expect(match.tick(30_000)).toEqual([]);
    match.reconnect('red');
    expect(match.viewFor('blue').clock.deadline).toBe(35_000);
    expect(match.tick(34_999)).toEqual([]);
    expect(match.tick(35_000)).toHaveLength(1);
  });

  it('running out of grace abandons the match', () => {
    const match = ready({ seed: 1, clock: 'padrao' });
    match.disconnect('blue');
    expect(match.viewFor('red').enemy.clock.connected).toBe(false);
    expect(match.tick(44_000)).toEqual([]);
    expect(match.tick(45_000)).toEqual([{ type: 'abandon', player: 'blue' }]);
    expect(match.winner).toBe('red');
    expect(match.winReason).toBe('abandon');
  });

  it('unlimited never times out', () => {
    const match = ready({ seed: 1 });
    expect(match.tick(1e9)).toEqual([]);
    expect(match.viewFor('blue').clock.deadline).toBeNull();
  });
});
