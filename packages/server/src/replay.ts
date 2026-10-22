import { Match, type LogEntry, type MatchOptions, type PlayerId } from '@riverfront/core';

export type ReplayResult = { readonly ok: true; readonly match: Match; readonly durationMs: number } | { readonly ok: false; readonly reason: string };

/** Ações que uma partida local (contra o bot) nunca tem. */
const NEVER = new Set<LogEntry['type']>(['disconnect', 'reconnect', 'abandon']);
/** O bot não desiste nem estoura o tempo: se o log disser isso, foi mexido. */
const NEVER_FOR_BOT = new Set<LogEntry['type']>(['timeout', 'surrender']);
/** Entradas que mexem no layout. */
const OPPONENT_LAYOUT = new Set<LogEntry['type']>(['place', 'move', 'rotate', 'remove', 'layout', 'auto']);

/**
 * Refaz uma partida local a partir do log enviado pelo cliente e confere que
 * ela é possível: cada ação tem de ser aceita pelo core na ordem e no instante
 * informados, os estouros de tempo têm de ser os que o relógio produziria (nem
 * a mais, nem a menos) e a partida tem de terminar. Tiros e tempo saem da
 * partida refeita, nunca do que o cliente declarou.
 */
export function replayLocalMatch(options: MatchOptions, log: readonly LogEntry[], player: PlayerId = 'blue', opponentSeed?: number): ReplayResult {
  const fail = (reason: string): ReplayResult => ({ ok: false, reason });
  let match: Match;
  try {
    match = new Match(options);
  } catch (error) {
    return fail(`configuração: ${String(error)}`);
  }
  const start = options.startTime ?? 0;
  let last = start;
  let claimed = 0;
  let opponentPlaced = false;
  let produced = 0;
  const tick = (at: number) => {
    for (const e of match.tick(at)) if (e.type === 'timeout') produced++;
  };

  for (const [i, entry] of log.entries()) {
    if (!Number.isFinite(entry.at) || entry.at < last) return fail(`instante fora de ordem na entrada ${i}`);
    last = entry.at;
    if (entry.type === 'tower') continue; // a torre dispara sozinha no replay
    if (NEVER.has(entry.type)) return fail(`entrada ${entry.type} não existe em partida local`);
    if (entry.player !== player && NEVER_FOR_BOT.has(entry.type)) return fail(`o adversário não faz ${entry.type}`);
    // O layout do adversário não vem do cliente: só o autoPlace com a semente que o servidor espera.
    if (opponentSeed !== undefined && entry.player !== player && OPPONENT_LAYOUT.has(entry.type)) {
      if (entry.type !== 'auto' || entry.seed !== opponentSeed || opponentPlaced) return fail('layout do adversário não é o gerado pelo servidor');
      opponentPlaced = true;
    }
    if (entry.type === 'timeout') {
      claimed++;
      tick(entry.at);
      if (produced !== claimed) return fail(`estouro de tempo que o relógio não produziria (entrada ${i})`);
      continue;
    }
    tick(entry.at);
    if (produced !== claimed) return fail(`jogada depois do prazo do turno (entrada ${i})`);
    const r = apply(match, entry);
    if (!r.ok) return fail(`entrada ${i} (${entry.type}) recusada: ${r.error}`);
  }
  tick(last);
  if (produced !== claimed) return fail('estouro de tempo faltando no fim do log');
  if (match.phase !== 'finished') return fail('a partida não terminou');
  if (opponentSeed !== undefined && !opponentPlaced) return fail('layout do adversário ausente');
  return { ok: true, match, durationMs: Math.max(0, last - start) };
}

function apply(match: Match, e: LogEntry): { ok: boolean; error?: string } {
  switch (e.type) {
    case 'place':
      return match.place(e.player, e.pieceId, e.anchor, e.rotation);
    case 'move':
      return match.move(e.player, e.pieceId, e.anchor);
    case 'rotate':
      return match.rotate(e.player, e.pieceId, e.rotation);
    case 'remove':
      return match.remove(e.player, e.pieceId);
    case 'layout':
      return match.setLayout(e.player, e.placements);
    case 'auto':
      return match.autoPlace(e.player, e.seed);
    case 'confirm':
      return match.confirm(e.player);
    case 'attack':
      return match.attack(e.player, e.target);
    case 'ability':
      return match.useAbility(e.player, e.request);
    case 'special':
      return match.special(e.player, e.request);
    case 'surrender':
      return match.surrender(e.player);
    default:
      return { ok: false, error: 'tipo inesperado' };
  }
}
