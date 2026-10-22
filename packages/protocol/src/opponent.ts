import { hashSeed } from '@riverfront/core';

/**
 * Semente do layout do adversário nas partidas conferidas pelo servidor
 * (desafio diário e campanha). O cliente posiciona o bot com
 * `match.autoPlace('red', opponentLayoutSeed(seed))` e o servidor só aceita
 * esse layout: assim o cliente não escolhe onde o adversário fica.
 */
export function opponentLayoutSeed(matchSeed: number): number {
  return hashSeed(matchSeed >>> 0, 'opponent-layout') >>> 0;
}
