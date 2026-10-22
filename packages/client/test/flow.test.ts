import { describe, expect, it } from 'vitest';
import { INITIAL_FLOW, SHOT, canAim, canPlace, footprintOf, reduceFlow, targetField, type FlowEvent, type FlowState } from '../src/app/flow';

const run = (events: FlowEvent[], from: FlowState = INITIAL_FLOW) => events.reduce(reduceFlow, from);

describe('fluxo do controlador', () => {
  it('passa por posicionando -> esperando -> jogando -> fim', () => {
    let s = run([{ type: 'placing' }]);
    expect(s.phase).toBe('placing');
    expect(canPlace(s)).toBe(true);
    s = reduceFlow(s, { type: 'confirmed' });
    expect(s.phase).toBe('waiting');
    expect(canPlace(s)).toBe(false);
    s = reduceFlow(s, { type: 'playing', myTurn: true });
    expect(s.phase).toBe('playing');
    expect(canAim(s)).toBe(true);
    s = reduceFlow(s, { type: 'ended' });
    expect(s.phase).toBe('ended');
    expect(canAim(s)).toBe(false);
  });

  it('só mira na própria vez, parado, sem pausa e conectado', () => {
    const playing = run([{ type: 'placing' }, { type: 'playing', myTurn: true }]);
    expect(canAim(playing)).toBe(true);
    expect(canAim(reduceFlow(playing, { type: 'busy', busy: true }))).toBe(false);
    expect(canAim(reduceFlow(playing, { type: 'pause', paused: true }))).toBe(false);
    expect(canAim(reduceFlow(playing, { type: 'offline', offline: true }))).toBe(false);
    expect(canAim(reduceFlow(playing, { type: 'turn', myTurn: false }))).toBe(false);
  });

  it('um turno novo limpa a habilidade escolhida e a célula armada', () => {
    let s = run([{ type: 'placing' }, { type: 'playing', myTurn: true }]);
    s = reduceFlow(s, { type: 'target', targeting: { kind: 'ability', ability: 'radar', axis: 'row' } });
    s = reduceFlow(s, { type: 'arm', cell: { col: 3, row: 2 } });
    expect(s.targeting.kind).toBe('ability');
    expect(s.armed).toEqual({ col: 3, row: 2 });
    s = reduceFlow(s, { type: 'turn', myTurn: false });
    expect(s.targeting).toBe(SHOT);
    expect(s.armed).toBeNull();
  });

  it('cancelar desfaz uma camada por vez', () => {
    let s = run([{ type: 'placing' }, { type: 'playing', myTurn: true }]);
    s = reduceFlow(s, { type: 'target', targeting: { kind: 'special', shot: 'double', axis: 'row', first: { col: 1, row: 1 } } });
    s = reduceFlow(s, { type: 'arm', cell: { col: 5, row: 5 } });
    s = reduceFlow(s, { type: 'cancel' });
    expect(s.armed).toBeNull();
    expect(s.targeting).toMatchObject({ kind: 'special', first: { col: 1, row: 1 } });
    s = reduceFlow(s, { type: 'cancel' });
    expect(s.targeting).toMatchObject({ kind: 'special', first: null });
    s = reduceFlow(s, { type: 'cancel' });
    expect(s.targeting).toBe(SHOT);
  });

  it('ignora a mira enquanto o adversário joga', () => {
    const s = run([{ type: 'placing' }, { type: 'playing', myTurn: false }, { type: 'target', targeting: { kind: 'ability', ability: 'bomb', axis: 'row' } }]);
    expect(s.targeting).toBe(SHOT);
    expect(reduceFlow(s, { type: 'arm', cell: { col: 0, row: 0 } }).armed).toBeNull();
  });

  it('escudo e reparo miram o próprio campo', () => {
    expect(targetField({ kind: 'ability', ability: 'shield', axis: 'row' })).toBe('own');
    expect(targetField({ kind: 'ability', ability: 'repair', axis: 'row' })).toBe('own');
    expect(targetField({ kind: 'ability', ability: 'radar', axis: 'row' })).toBe('enemy');
    expect(targetField(SHOT)).toBe('enemy');
  });

  it('áreas de efeito ficam presas ao tabuleiro', () => {
    expect(footprintOf({ kind: 'ability', ability: 'radar', axis: 'row' }, 25, 7, { col: 0, row: 0 })).toHaveLength(4);
    expect(footprintOf({ kind: 'ability', ability: 'bomb', axis: 'row' }, 25, 7, { col: 5, row: 3 })).toHaveLength(5);
    expect(footprintOf({ kind: 'ability', ability: 'spy', axis: 'col' }, 25, 7, { col: 5, row: 3 })).toHaveLength(7);
    expect(footprintOf({ kind: 'special', shot: 'line3', axis: 'row', first: null }, 25, 7, { col: 23, row: 3 })).toHaveLength(2);
  });
});
