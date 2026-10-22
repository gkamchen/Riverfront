import type { Board, CellContent, PieceContent } from '../board/board';
import { COLS, ROWS, cellIndexOf, type Side } from '../board/layout';
import type { ResultKind } from '../board/resultMarkers';
import type { TeamId } from '../units/roles';
import type { UnitPlacement } from '../units/unitPiece';

interface Cell {
  readonly col: number;
  readonly row: number;
}

/**
 * The match field inside the fixed 25 × 7 board. Smaller fields (the quick
 * modes are 15 × 5) are centred along the river with row 0 on the bank; the
 * rest of the board is out of play. Everything here takes match coordinates
 * and talks to the board in board coordinates.
 */
export class FieldBoard {
  readonly board: Board;
  readonly cols: number;
  readonly rows: number;
  /** Board column of match column 0. */
  readonly offset: number;

  constructor(board: Board, cols = COLS, rows = ROWS) {
    this.board = board;
    this.cols = Math.min(COLS, cols);
    this.rows = Math.min(ROWS, rows);
    this.offset = Math.floor((COLS - this.cols) / 2);
  }

  /** Board tile index of a match cell. */
  index(col: number, row: number): number {
    return cellIndexOf(col + this.offset, row);
  }

  toBoard<T extends Cell>(cell: T): T {
    return { ...cell, col: cell.col + this.offset };
  }

  /** Match cell of a board cell, or null when it is outside the field. */
  toMatch<T extends Cell>(cell: T | null): T | null {
    if (!cell) return null;
    const col = cell.col - this.offset;
    if (col < 0 || col >= this.cols || cell.row < 0 || cell.row >= this.rows) return null;
    return { ...cell, col };
  }

  markResult(side: Side, col: number, row: number, kind: ResultKind): void {
    this.board.markResult(side, col + this.offset, row, kind);
  }

  unitAt(side: Side, col: number, row: number) {
    return this.board.unitAt(side, col + this.offset, row);
  }

  pieceAt(side: Side, col: number, row: number) {
    return this.board.pieceAt(side, col + this.offset, row);
  }

  revealEnemy(col: number, row: number, revealed: Omit<CellContent, 'col' | 'row'>, owner: TeamId) {
    return this.board.revealEnemy(col + this.offset, row, revealed, owner);
  }

  placePiece(piece: PieceContent, team: TeamId, side: Side) {
    return this.board.placePiece(
      {
        ...piece,
        cells: piece.cells.map((c) => this.toBoard(c)),
        placement: piece.placement ? { ...piece.placement, anchor: this.toBoard(piece.placement.anchor) } : null,
      },
      team,
      side,
    );
  }

  placeUnit(placement: UnitPlacement) {
    return this.board.placeUnit({ ...placement, origin: this.toBoard(placement.origin) });
  }

  populateOwn(cells: readonly CellContent[], team: TeamId, pieces?: readonly PieceContent[]): void {
    const shifted = cells.map((c) => this.toBoard(c));
    if (!pieces) {
      this.board.populateOwn(shifted, team);
      return;
    }
    this.board.populateOwn(
      shifted,
      team,
      pieces.map((p) => ({ ...p, cells: p.cells.map((c) => this.toBoard(c)), placement: p.placement ? { ...p.placement, anchor: this.toBoard(p.placement.anchor) } : null })),
    );
  }
}
