import type { EnemyCell, EnemyCellState, HistoryEntry, OwnCell, PlayerView, RoleId, Terrain } from '@riverfront/core';

/**
 * A `PlayerView` em JSON puro passa de 30 KB, quase tudo nas 2 × 175 células.
 * Na rede as células vão compactadas em textos de um caractere por célula e o
 * histórico vai só a partir do que o jogador ainda não recebeu. `unpackView`
 * devolve exatamente a mesma `PlayerView` (há teste de ida e volta).
 */

type OwnSection = PlayerView['own'];
type EnemySection = PlayerView['enemy'];

export interface PackedOwnCells {
  /** 'e' terra, 'r' rocha, uma letra por célula na ordem do core (linha a linha). */
  readonly terrain: string;
  /** Índice em `own.pieces` da peça na célula, ou -1. */
  readonly piece: readonly number[];
  /** Dígito por célula: bit 1 = atingida, bit 2 = exposta. */
  readonly flags: string;
}

export interface PackedEnemyCells {
  /** h oculta, s avistada, e terra, r rocha, x atingida. */
  readonly state: string;
  /** Papel revelado das células atingidas de peças destruídas, por índice da célula. */
  readonly roles: Readonly<Record<string, RoleId>>;
  /** Células onde um escudo absorveu um tiro. */
  readonly shield: readonly number[];
}

export type PackedView = Omit<PlayerView, 'own' | 'enemy' | 'history'> & {
  readonly own: Omit<OwnSection, 'cells'> & { readonly cells: PackedOwnCells };
  readonly enemy: Omit<EnemySection, 'cells'> & { readonly cells: PackedEnemyCells };
  /** Posição em `history` a partir da qual `history` foi enviado. 0 = histórico completo. */
  readonly historyStart: number;
  readonly history: readonly HistoryEntry[];
};

const STATE_CHAR: Readonly<Record<EnemyCellState, string>> = { hidden: 'h', spotted: 's', earth: 'e', rock: 'r', hit: 'x' };
const CHAR_STATE: Readonly<Record<string, EnemyCellState>> = { h: 'hidden', s: 'spotted', e: 'earth', r: 'rock', x: 'hit' };

export function packView(view: PlayerView, historyStart = 0): PackedView {
  const pieceIndex = new Map(view.own.pieces.map((p, i) => [p.id, i]));
  const own: PackedOwnCells = {
    terrain: view.own.cells.map((c) => (c.terrain === 'rock' ? 'r' : 'e')).join(''),
    piece: view.own.cells.map((c) => (c.pieceId === null ? -1 : (pieceIndex.get(c.pieceId) ?? -1))),
    flags: view.own.cells.map((c) => String((c.struck ? 1 : 0) | (c.exposed ? 2 : 0))).join(''),
  };
  const roles: Record<string, RoleId> = {};
  const shield: number[] = [];
  view.enemy.cells.forEach((c, i) => {
    if (c.role) roles[i] = c.role;
    if (c.shield) shield.push(i);
  });
  const enemy: PackedEnemyCells = { state: view.enemy.cells.map((c) => STATE_CHAR[c.state]).join(''), roles, shield };
  const start = Math.max(0, Math.min(historyStart, view.history.length));
  return {
    ...view,
    own: { ...view.own, cells: own },
    enemy: { ...view.enemy, cells: enemy },
    historyStart: start,
    history: view.history.slice(start),
  };
}

/**
 * Reconstrói a visão. `previousHistory` é o histórico que o cliente já tinha
 * (precisa ter pelo menos `historyStart` itens; senão peça um `sync`).
 */
export function unpackView(packed: PackedView, previousHistory: readonly HistoryEntry[] = []): PlayerView {
  if (packed.historyStart > previousHistory.length) throw new Error('Histórico incompleto: peça um sync ao servidor.');
  const cols = packed.config.cols;
  const coord = (i: number) => ({ col: i % cols, row: Math.floor(i / cols) });
  const pieces = packed.own.pieces;

  const ownCells: OwnCell[] = [];
  for (let i = 0; i < packed.own.cells.terrain.length; i++) {
    const piece = pieces[packed.own.cells.piece[i] ?? -1];
    const flags = Number(packed.own.cells.flags[i] ?? '0');
    ownCells.push({
      ...coord(i),
      terrain: (packed.own.cells.terrain[i] === 'r' ? 'rock' : 'earth') as Terrain,
      pieceId: piece?.id ?? null,
      role: piece?.role ?? null,
      struck: (flags & 1) === 1,
      exposed: (flags & 2) === 2,
    });
  }

  const shield = new Set(packed.enemy.cells.shield);
  const enemyCells: EnemyCell[] = [];
  for (let i = 0; i < packed.enemy.cells.state.length; i++) {
    enemyCells.push({
      ...coord(i),
      state: CHAR_STATE[packed.enemy.cells.state[i] as string] ?? 'hidden',
      role: packed.enemy.cells.roles[i] ?? null,
      shield: shield.has(i),
    });
  }

  const { historyStart, history, ...rest } = packed;
  return {
    ...rest,
    own: { ...packed.own, cells: ownCells },
    enemy: { ...packed.enemy, cells: enemyCells },
    history: [...previousHistory.slice(0, historyStart), ...history],
  };
}
