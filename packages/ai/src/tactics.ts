import {
  BANK_ROW,
  block3x3,
  coordOf,
  lineCells,
  neighbors4,
  plusShape,
  type AbilityId,
  type Coord,
  type LineAxis,
  type PlayerView,
  type Rng,
  type SpecialShotRequest,
} from '@riverfront/core';
import { DEAD, EMPTY, HIT, ROCK, SPOTTED, UNKNOWN, type Knowledge } from './knowledge.ts';

/** Shootable cells, leaving out the ones a live shield would absorb when possible. */
export function shotCandidates(k: Knowledge): number[] {
  const all: number[] = [];
  const open: number[] = [];
  for (let i = 0; i < k.n; i++) {
    if (!k.shootable(i)) continue;
    all.push(i);
    if (!k.shielded(i)) open.push(i);
  }
  return open.length > 0 ? open : all;
}

/** Cells next to an absorbed shot probably belong to the same shielded piece. */
export function shieldPenalty(k: Knowledge, cell: number): number {
  if (!k.shieldActive) return 1;
  return neighbors4(k.size, cell).some((n) => k.shieldMark[n] === 1) ? 0.3 : 1;
}

/** Bank cells are worth more right before the tide covers them for two turns. */
export function tideFactor(k: Knowledge, cell: number): number {
  return k.bankUrgent && Math.floor(cell / k.size.cols) === BANK_ROW ? 1.3 : 1;
}

/** Highest chance wins; ties go to the cell with likelier neighbours, then to the rng. */
export function bestCell(k: Knowledge, prob: Float64Array, rng: Rng): number {
  const candidates = shotCandidates(k);
  const spotted = candidates.filter((i) => k.status[i] === SPOTTED && !k.shielded(i));
  if (spotted.length > 0) return rng.pick(spotted);

  let best = -1;
  let bestScore = -Infinity;
  let ties = 0;
  for (const i of candidates) {
    const around = neighbors4(k.size, i).reduce((s, c) => s + (prob[c] ?? 0), 0);
    const score = (prob[i] ?? 0) * shieldPenalty(k, i) * tideFactor(k, i) * 1000 + around * 1e-3;
    if (score > bestScore + 1e-12) {
      best = i;
      bestScore = score;
      ties = 1;
    } else if (Math.abs(score - bestScore) <= 1e-12) {
      ties++;
      if (rng.int(ties) === 0) best = i;
    }
  }
  return best >= 0 ? best : rng.pick(candidates);
}

export function toCoord(k: Knowledge, index: number): Coord {
  return coordOf(k.size, index);
}

export function abilityReady(view: PlayerView, id: AbilityId): boolean {
  return !view.turnState.abilityUsed && view.own.abilities.some((a) => a.id === id && a.ready);
}

export function abilityCost(view: PlayerView, id: AbilityId): number {
  return view.own.abilities.find((a) => a.id === id)?.cost ?? Infinity;
}

/** Expected unit cells a bomb would hit, for the best centre. */
export function bestBomb(k: Knowledge, prob: Float64Array): { target: Coord; value: number } | null {
  const rockRate = k.rockRate();
  let best: { target: Coord; value: number } | null = null;
  for (let center = 0; center < k.n; center++) {
    const s = k.status[center];
    if (s === ROCK) continue;
    let value = 0;
    let open = 0;
    for (const c of plusShape(k.size, center)) {
      if (!k.shootable(c)) continue;
      open++;
      if (!k.shielded(c)) value += prob[c] ?? 0;
    }
    if (open === 0) continue;
    // An unknown centre may turn out to be rock, which only uncovers the centre.
    if (s === UNKNOWN) value = (1 - rockRate) * value;
    if (!best || value > best.value) best = { target: toCoord(k, center), value };
  }
  return best;
}

/** The line with the most expected units (the spy then names the best piece in it). */
export function bestSpy(k: Knowledge, prob: Float64Array): { axis: LineAxis; index: number; value: number } {
  let best = { axis: 'row' as LineAxis, index: 0, value: -1 };
  for (const axis of ['row', 'col'] as const) {
    const lines = axis === 'row' ? k.size.rows : k.size.cols;
    for (let index = 0; index < lines; index++) {
      const value = lineCells(k.size, axis, index).reduce((s, c) => s + (k.status[c] === UNKNOWN ? (prob[c] ?? 0) : 0), 0);
      if (value > best.value) best = { axis, index, value };
    }
  }
  return best;
}

/** Radar where the answer is least predictable (most variance among unknown cells). */
export function bestRadar(k: Knowledge, prob: Float64Array): { target: Coord; value: number } | null {
  let best: { target: Coord; value: number } | null = null;
  for (let center = 0; center < k.n; center++) {
    if (k.status[center] === ROCK || k.status[center] === EMPTY) continue;
    let value = 0;
    for (const c of block3x3(k.size, center)) {
      if (k.status[c] !== UNKNOWN) continue;
      const p = prob[c] ?? 0;
      value += p * (1 - p);
    }
    if (!best || value > best.value) best = { target: toCoord(k, center), value };
  }
  return best;
}

/** Own piece most worth a shield: damaged, alive, away from the bank. */
export function shieldTarget(view: PlayerView): string | null {
  const options = view.own.pieces.filter(
    (p) => !p.destroyed && p.damaged > 0 && p.shieldTurns === 0 && p.cells.every((c) => c.row !== BANK_ROW),
  );
  options.sort((a, b) => b.cells.length - b.damaged - (a.cells.length - a.damaged));
  return options[0]?.id ?? null;
}

/** A damaged cell of a live piece that touches open earth. */
export function repairTarget(view: PlayerView): Coord | null {
  const { cols, rows } = view.config;
  const cells = view.own.cells;
  for (const piece of view.own.pieces) {
    if (piece.destroyed || piece.damaged === 0) continue;
    for (const c of piece.cells) {
      const own = cells[c.row * cols + c.col];
      if (!own?.struck) continue;
      const nearEarth = neighbors4({ cols, rows }, c.row * cols + c.col).some((n) => {
        const cell = cells[n];
        return cell !== undefined && cell.terrain === 'earth' && cell.role === null;
      });
      if (nearEarth) return { col: c.col, row: c.row };
    }
  }
  return null;
}

/** Whether the enemy hit one of our pieces on its last turn (it is probably chasing it). */
export function underAttack(view: PlayerView): boolean {
  let turn = -1;
  for (let i = view.history.length - 1; i >= 0; i--) {
    const h = view.history[i]!;
    if (h.kind !== 'shot' || h.by !== view.opponent) continue;
    if (turn === -1) turn = h.turn;
    if (h.turn !== turn) break;
    if (h.report.result === 'hit') return true;
  }
  return false;
}

// ------------------------------------------------------------ special shots

/** Expected unit cells a line of three would uncover from `start` (rocks stop it). */
export function lineValue(k: Knowledge, prob: Float64Array, start: number, axis: LineAxis): number | null {
  const col = start % k.size.cols;
  const row = Math.floor(start / k.size.cols);
  const rockRate = k.rockRate();
  let reach = 1;
  let value = 0;
  let open = false;
  for (let step = 0; step < 3; step++) {
    const c = axis === 'row' ? col + step : col;
    const r = axis === 'row' ? row : row + step;
    if (c >= k.size.cols || r >= k.size.rows) return null;
    const cell = r * k.size.cols + c;
    const s = k.status[cell];
    if (s === ROCK) break;
    if (!k.shootable(cell)) continue;
    open = true;
    if (!k.shielded(cell)) value += reach * (prob[cell] ?? 0) * tideFactor(k, cell);
    if (s === UNKNOWN) reach *= 1 - rockRate;
  }
  return open ? value : null;
}

function bestOpenCell(k: Knowledge, prob: Float64Array, filter: (i: number) => boolean = () => true): { cell: number; p: number } | null {
  let best: { cell: number; p: number } | null = null;
  for (const i of shotCandidates(k)) {
    if (!filter(i)) continue;
    const p = (prob[i] ?? 0) * (k.shielded(i) ? 0 : 1);
    if (!best || p > best.p) best = { cell: i, p };
  }
  return best;
}

/**
 * Decides whether to fire the faction special shot now, and where. Skill 1
 * fires it whenever it does something; skill 2 compares it with a plain shot
 * and keeps energy for the next bomb.
 */
export function planSpecial(view: PlayerView, k: Knowledge, prob: Float64Array, rng: Rng, skill: 1 | 2): SpecialShotRequest | null {
  const status = view.own.faction?.special;
  if (!status?.ready || view.turnState.specialUsed) return null;
  const single = bestOpenCell(k, prob);
  const bomb = view.own.abilities.find((a) => a.id === 'bomb');
  const bombSoon = bomb !== undefined && bomb.blocker !== 'missing-piece' && bomb.cooldownLeft <= 1;
  const thrifty = skill === 2 && bombSoon && view.own.energy - status.energy + 1 < (bomb?.cost ?? 0);
  const hasSpotted = shotCandidates(k).some((i) => k.status[i] === SPOTTED && !k.shielded(i));

  switch (status.kind) {
    case 'probe': {
      // Look before shooting: the probe keeps the turn, so it pays to check the best guess.
      if (hasSpotted) return null;
      const unknown = (i: number) => k.status[i] === UNKNOWN && !k.submerged[i];
      if (skill === 1) {
        const pool = shotCandidates(k).filter(unknown);
        return pool.length > 0 ? { target: toCoord(k, rng.pick(pool)) } : null;
      }
      const best = bestOpenCell(k, prob, unknown);
      if (!best || best.p >= 0.85) return null;
      if (status.charges === 0 && (thrifty || view.own.energy < status.energy + 2)) return null;
      return { target: toCoord(k, best.cell) };
    }
    case 'precise': {
      if (skill === 2 && hasSpotted) return null;
      let pick: { center: Coord; open: number } | null = null;
      for (const r of view.intel.radar) {
        if (!r.count) continue;
        const cells = block3x3(k.size, r.center.row * k.size.cols + r.center.col);
        const known = cells.filter((c) => k.status[c] === HIT || k.status[c] === SPOTTED || k.status[c] === DEAD).length;
        const open = cells.filter((c) => k.status[c] === UNKNOWN || k.status[c] === SPOTTED).length;
        if (open === 0 || (skill === 2 && r.count <= known)) continue;
        if (!pick || open < pick.open) pick = { center: r.center, open };
      }
      return pick ? { target: { col: pick.center.col, row: pick.center.row } } : null;
    }
    case 'line3': {
      if (thrifty) return null;
      let best: { target: Coord; axis: LineAxis; value: number } | null = null;
      for (let start = 0; start < k.n; start++) {
        for (const axis of ['row', 'col'] as const) {
          const value = lineValue(k, prob, start, axis);
          if (value !== null && (!best || value > best.value)) best = { target: toCoord(k, start), axis, value };
        }
      }
      const bar = skill === 2 ? Math.max(0.9, (single?.p ?? 0) + 0.4) : 0.6;
      return best && best.value >= bar ? { target: best.target, axis: best.axis } : null;
    }
    case 'cross': {
      if (thrifty) return null;
      const cross = bestBomb(k, prob);
      const bar = skill === 2 ? Math.max(1, (single?.p ?? 0) + 0.5) : 0.7;
      return cross && cross.value >= bar ? { target: cross.target } : null;
    }
    case 'double': {
      if (thrifty || !single) return null;
      const second = bestOpenCell(k, prob, (i) => i !== single.cell && !neighbors4(k.size, single.cell).includes(i));
      if (!second) return null;
      // While hunting, two looks beat one (a lone shot rarely earns its extra shot);
      // once a piece is found, only when the second cell is promising too.
      // Only with energy to spare: the bombardment is worth more than a second look.
      const spare = view.own.energy - status.energy >= (bomb && bomb.blocker !== 'missing-piece' ? bomb.cost : 0);
      const hunting = single.p < 0.45 && spare;
      const worth = skill === 2 ? hunting || second.p >= 0.3 : single.p + second.p >= 0.4;
      return worth ? { target: toCoord(k, single.cell), second: toCoord(k, second.cell) } : null;
    }
    case 'ricochet': {
      if (thrifty || !single || hasSpotted) return null;
      // Worth it when the best guess may well miss: the bounce gets a second look.
      if (skill === 2 && single.p > 0.6) return null;
      // ...and only with energy to spare for the next bombardment.
      if (skill === 2 && bomb && bomb.blocker !== 'missing-piece' && view.own.energy - status.energy < bomb.cost) return null;
      return { target: toCoord(k, single.cell) };
    }
    default:
      return null;
  }
}
