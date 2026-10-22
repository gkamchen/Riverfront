import type { Coord, HistoryEntry, PlayerView, ShotReport } from '@riverfront/core';

/**
 * Neblina: erros antigos somem do mapa de quem atirou (a célula volta a
 * `hidden`), mas o histórico do core ainda guarda o relatório daquele tiro.
 * Antes de mandar a visão, tiramos do histórico os erros (terra/rocha) do
 * próprio jogador em células que hoje aparecem ocultas para ele.
 */
export function fogHistory(view: PlayerView): HistoryEntry[] {
  const cols = view.config.cols;
  const cells = view.enemy.cells;
  const hidden = (c: Coord) => cells[c.row * cols + c.col]?.state === 'hidden';
  const faded = (r: ShotReport) => (r.result === 'earth' || r.result === 'rock') && hidden(r.target);

  const out: HistoryEntry[] = [];
  for (const entry of view.history) {
    if (entry.kind === 'tide' || entry.kind === 'timeout' || entry.kind === 'end' || entry.by !== view.player) {
      out.push(entry);
      continue;
    }
    if (entry.kind === 'shot' || entry.kind === 'tower') {
      if (!faded(entry.report)) out.push(entry);
      continue;
    }
    if (entry.kind === 'special' && entry.outcome) {
      out.push({ ...entry, outcome: { ...entry.outcome, shots: entry.outcome.shots.filter((s) => !faded(s)) } });
      continue;
    }
    if (entry.kind === 'ability' && entry.outcome?.ability === 'bomb') {
      out.push({ ...entry, outcome: { ...entry.outcome, shots: entry.outcome.shots.filter((s) => !faded(s)) } });
      continue;
    }
    out.push(entry);
  }
  return out;
}
