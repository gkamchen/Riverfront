import { describe, expect, it } from 'vitest';
import { crossedSecond, crossedWarning, formatElapsed, formatSeconds, readClock, seatReading, warnLevel } from '../src/app/clockDisplay';

describe('relógio na tela', () => {
  it('formata o tempo restante arredondando para cima', () => {
    expect(formatSeconds(30_000)).toBe('0:30');
    expect(formatSeconds(29_001)).toBe('0:30');
    expect(formatSeconds(65_000)).toBe('1:05');
    expect(formatSeconds(-5)).toBe('0:00');
    expect(formatElapsed(125_400)).toBe('02:05');
  });

  it('mostra o tempo do turno e depois a reserva', () => {
    const base = { turnStartedAt: 0, turnMs: 30_000, deadline: 90_000, frozen: false };
    const early = readClock({ ...base, now: 12_000 });
    expect(early.phase).toBe('turn');
    expect(early.text).toBe('0:18');
    expect(early.leftMs).toBe(78_000);
    const late = readClock({ ...base, now: 40_000 });
    expect(late.phase).toBe('bank');
    expect(late.text).toBe('0:50');
    expect(readClock({ ...base, now: 86_000 }).warn).toBe(5);
  });

  it('trata relógio sem limite e congelado', () => {
    expect(readClock({ now: 5, turnStartedAt: 0, turnMs: null, deadline: null, frozen: false }).phase).toBe('none');
    expect(readClock({ now: 5, turnStartedAt: 0, turnMs: 30_000, deadline: null, frozen: true }).phase).toBe('frozen');
  });

  it('avisa uma vez aos 10 s e aos 5 s, mesmo pulando quadros', () => {
    expect(warnLevel(12_000)).toBe(0);
    expect(warnLevel(9_000)).toBe(10);
    expect(warnLevel(4_000)).toBe(5);
    expect(crossedWarning(10_200, 9_900)).toBe(10);
    expect(crossedWarning(9_900, 9_800)).toBeNull();
    expect(crossedWarning(12_000, 4_000)).toBe(5);
    expect(crossedWarning(null, 4_000)).toBeNull();
    expect(crossedWarning(4_000, 30_000)).toBeNull();
  });

  it('bate a cada segundo nos últimos cinco', () => {
    expect(crossedSecond(4_100, 3_950)).toBe(true);
    expect(crossedSecond(3_950, 3_900)).toBe(false);
    expect(crossedSecond(8_000, 7_000)).toBe(false);
  });

  it('lê o prazo do lugar nas duplas', () => {
    expect(seatReading(null, 0).phase).toBe('none');
    expect(seatReading(40_000, 31_000)).toMatchObject({ phase: 'turn', text: '0:09', warn: 10 });
  });
});
