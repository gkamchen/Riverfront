/**
 * Fronteira entre a lógica do jogo e o meio de transporte.
 *
 * O `GameServer` só conhece `Connection` e recebe três eventos (abrir,
 * mensagem, fechar). O transporte padrão é WebSocket com `ws` sobre um
 * servidor HTTP do Node (ws-transport.ts). Outro host, como uma plataforma
 * de WebSocket sem servidor, pode implementar `Transport` chamando os mesmos
 * handlers; veja docs/online.md para o que muda nesse caso (estado das salas
 * fica em memória, então todas as conexões de uma sala precisam cair na
 * mesma instância).
 */

export interface Connection {
  /** Id único desta conexão (não é o id do jogador). */
  readonly id: string;
  /** Endereço remoto. Só vai para o log em arquivo, que o apaga depois de 7 dias. */
  readonly ip: string;
  send(text: string): void;
  close(code: number, reason: string): void;
  /** Bytes ainda na fila de saída; usado para derrubar clientes lentos. */
  bufferedAmount(): number;
}

export interface TransportHandlers {
  open(conn: Connection): void;
  message(conn: Connection, text: string): void;
  close(conn: Connection): void;
}

export interface Transport {
  start(handlers: TransportHandlers): Promise<void>;
  /** Para de aceitar conexões novas e fecha as existentes. */
  stop(): Promise<void>;
}

/** Códigos de fechamento usados pelo servidor (4000-4999 são livres para a aplicação). */
export const CLOSE = {
  normal: 1000,
  goingAway: 1001,
  policy: 1008,
  tooBig: 1009,
  replaced: 4001,
  helloTimeout: 4002,
  protocol: 4003,
  deleted: 4004,
  slow: 4005,
} as const;
