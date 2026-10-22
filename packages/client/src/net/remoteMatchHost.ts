import {
  toLegacyView,
  type AbilityRequest,
  type Coord,
  type HistoryEntry,
  type LegacyPlayerView,
  type Placement,
  type PlayerId,
  type PlayerView,
  type SeatId,
  type SpecialShotRequest,
  type TeamView,
} from '@riverfront/core';
import { unpackView, type MatchEvent, type ServerMessage } from '@riverfront/protocol';
import type { Connection, NetResult } from './connection.ts';
import { Emitter } from './emitter.ts';

export type MatchUpdate =
  /** Estado completo (entrada na partida, reconexão, sync). */
  | { readonly kind: 'state'; readonly view: PlayerView }
  /** Algo aconteceu; `view` já é o estado depois do evento. */
  | { readonly kind: 'event'; readonly event: MatchEvent; readonly view: PlayerView };

export interface RemoteMatchEvents {
  update: MatchUpdate;
}

/**
 * Partida jogada no servidor. Tem a mesma ideia do `MatchHost` local (ler a
 * visão, mandar jogadas), mas as jogadas são assíncronas: a resposta diz só
 * se o servidor aceitou; o resultado chega por `onUpdate` para os dois
 * jogadores ao mesmo tempo, e é ali que a cena deve animar.
 *
 * Só existe a visão do próprio jogador: o servidor nunca manda o layout do
 * adversário antes do fim.
 */
export class RemoteMatchHost extends Emitter<RemoteMatchEvents> {
  readonly #conn: Connection;
  #view: PlayerView | null = null;
  #history: readonly HistoryEntry[] = [];
  readonly #off: (() => void)[] = [];

  constructor(conn: Connection) {
    super();
    this.#conn = conn;
    this.#off.push(
      conn.on('match.state', (msg) => this.#apply(msg)),
      conn.on('match.event', (msg) => this.#apply(msg)),
    );
  }

  /** Lado deste jogador, conhecido depois do primeiro estado. */
  get seat(): PlayerId | null {
    return this.#view?.player ?? null;
  }

  /** Lugar nas duplas ('blue-1'...), ou null no 1×1. */
  get seatId(): SeatId | null {
    return this.teamView()?.doubles.seat ?? null;
  }

  /** A visão com o bloco `doubles`, quando a partida é de duplas. */
  teamView(): TeamView | null {
    const v = this.#view as TeamView | null;
    return v && 'doubles' in v ? v : null;
  }

  /** Última visão recebida, ou null antes da partida começar. */
  view(): PlayerView | null {
    return this.#view;
  }

  /** Visão no formato antigo do protótipo (para o cliente atual, enquanto ele não migra). */
  legacyView(): LegacyPlayerView | null {
    return this.#view ? toLegacyView(this.#view) : null;
  }

  /** Atalho para quem só quer ouvir atualizações. Devolve a função que para de ouvir. */
  onUpdate(listener: (update: MatchUpdate) => void): () => void {
    return this.on('update', listener);
  }

  /**
   * Prazo do turno atual em milissegundos do relógio local, já corrigido pela
   * diferença com o servidor. null sem limite ou com o relógio congelado.
   */
  localDeadline(): number | null {
    const deadline = this.#view?.clock.deadline;
    if (deadline === null || deadline === undefined) return null;
    return deadline - (this.#conn.serverNow() - Date.now());
  }

  attack(target: Coord): Promise<NetResult> {
    return this.#conn.request({ t: 'attack', target: { col: target.col, row: target.row } });
  }

  useAbility(request: AbilityRequest): Promise<NetResult> {
    return this.#conn.request({ t: 'ability', request });
  }

  /** Tiro especial da facção (sonda, rajada, tiro certeiro...). */
  special(request: SpecialShotRequest): Promise<NetResult> {
    return this.#conn.request({ t: 'special', request });
  }

  /** Envia o layout inteiro; com `confirm` também confirma (a partida começa quando os dois confirmam). */
  submitPlacement(placements: readonly Placement[], confirm: boolean): Promise<NetResult> {
    return this.#conn.request({ t: 'placement.submit', placements, confirm });
  }

  /** Layout aleatório feito pelo servidor; chega como um novo estado. */
  autoPlace(): Promise<NetResult> {
    return this.#conn.request({ t: 'placement.auto' });
  }

  surrender(): Promise<NetResult> {
    return this.#conn.request({ t: 'surrender' });
  }

  /** Pede o estado completo de novo (se algo parecer fora de sincronia). */
  sync(): Promise<NetResult> {
    return this.#conn.request({ t: 'sync' });
  }

  /** Esquece a partida atual (ao sair da sala). */
  reset(): void {
    this.#view = null;
    this.#history = [];
  }

  dispose(): void {
    for (const off of this.#off.splice(0)) off();
    this.clear();
  }

  #apply(msg: Extract<ServerMessage, { t: 'match.state' | 'match.event' }>): void {
    let view: PlayerView;
    try {
      view = unpackView(msg.view, msg.t === 'match.state' ? [] : this.#history);
    } catch {
      // perdemos algum evento no meio do caminho: pede o estado inteiro
      void this.sync();
      return;
    }
    this.#history = view.history;
    this.#view = view;
    this.emit('update', msg.t === 'match.state' ? { kind: 'state', view } : { kind: 'event', event: msg.event, view });
  }
}
