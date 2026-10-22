import { createRng, type Match, type PlayerId, type Rng } from '../src/index.ts';

/**
 * Plays legal random moves only from each player's view: attacks, abilities
 * and special shots. Used by the replay and secrecy tests.
 */
export function randomTurn(match: Match, rng: Rng): void {
  const player: PlayerId = match.turn;
  for (let guard = 0; guard < 40 && match.phase === 'playing' && match.turn === player; guard++) {
    const view = match.viewFor(player);
    const open = view.enemy.cells.filter((c) => c.state === 'hidden' || c.state === 'spotted');
    const pick = () => rng.pick(open.length > 0 ? open : view.enemy.cells);

    const special = view.own.faction?.special;
    if (special?.ready && rng.next() < 0.5) {
      const target = special.kind === 'precise' ? (view.intel.radar.find((r) => (r.count ?? 0) > 0)?.center ?? pick()) : pick();
      const second = pick();
      match.special(player, { target: { col: target.col, row: target.row }, axis: rng.next() < 0.5 ? 'row' : 'col', second });
      continue;
    }
    const ready = view.own.abilities.filter((a) => a.ready);
    if (ready.length > 0 && rng.next() < 0.3) {
      const a = rng.pick(ready);
      const cell = pick();
      const ownPiece = view.own.pieces.find((p) => !p.destroyed && p.damaged === 0 && p.cells.every((c) => c.row > 0));
      const damaged = view.own.cells.find((c) => c.struck && c.role !== null);
      if (a.id === 'radar' || a.id === 'bomb') match.useAbility(player, { ability: a.id, target: { col: cell.col, row: cell.row } });
      else if (a.id === 'spy') match.useAbility(player, { ability: 'spy', axis: 'col', index: rng.int(view.config.cols) });
      else if (a.id === 'shield' && ownPiece) match.useAbility(player, { ability: 'shield', pieceId: ownPiece.id });
      else if (a.id === 'repair' && damaged) match.useAbility(player, { ability: 'repair', target: { col: damaged.col, row: damaged.row } });
    }
    const target = pick();
    const result = match.attack(player, { col: target.col, row: target.row });
    if (!result.ok) {
      // Submerged or similar: try the other open cells in order.
      const fallback = open.find((c) => match.attack(player, { col: c.col, row: c.row }).ok);
      if (!fallback) match.surrender(player);
    }
  }
}

export function playRandom(match: Match, seed: number, maxTurns = 3000): void {
  const rng = createRng(seed);
  for (let t = 0; t < maxTurns && match.phase === 'playing'; t++) randomTurn(match, rng);
}
