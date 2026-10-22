import type { CampaignProgress, DailyBoard, MatchRecord, PlayerId, TeamMatchRecord, WinReason } from '@riverfront/core';

export interface FriendRequest {
  readonly userId: string;
  readonly at: number;
}

export interface Account {
  readonly id: string;
  /** sha256 do token, em hex. O token em si nunca é guardado. */
  tokenHash: string;
  name: string;
  tag: string;
  colour: string;
  flag: string;
  emblem: string;
  readonly createdAt: number;
  lastSeenAt: number;
  friends: string[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  blocked: string[];
  /** Momentos dos últimos pedidos de amizade enviados (limite por hora). */
  requestTimes: number[];
  /** Progresso da campanha sincronizado (opcional). */
  campaign?: { progress: CampaignProgress; verified: string[]; updatedAt: number };
  /** Envios ao desafio diário: dia -> quantidade (limite por dia). */
  dailySubmits?: Record<string, number>;
}

export interface StoredMatch {
  readonly id: string;
  readonly room: string;
  readonly endedAt: number;
  /** Lugar -> conta: 'blue'/'red' no 1×1, 'blue-1'... nas duplas. */
  readonly players: Readonly<Record<string, string>>;
  readonly winner: PlayerId | null;
  readonly reason: WinReason | null;
  readonly record: MatchRecord | TeamMatchRecord;
}

export interface Report {
  readonly id: string;
  readonly at: number;
  readonly reporter: string;
  readonly target: string;
  readonly reason: string;
  readonly note: string;
  /** Registro completo da partida entre os dois, quando o denunciante anexou. */
  readonly match: StoredMatch | null;
  /** Emotes trocados na sala (de quem, qual, quando). */
  readonly emotes: readonly { readonly from: string; readonly emote: string; readonly at: number }[];
}

/**
 * Onde o servidor guarda contas, partidas encerradas e denúncias. As
 * implementações daqui (arquivo e memória) mantêm tudo em memória e servem
 * para uma instância só; para várias instâncias, implemente esta interface
 * sobre um banco de dados.
 */
export interface Store {
  init(): Promise<void>;
  getAccount(id: string): Promise<Account | null>;
  findByTag(name: string, tag: string): Promise<Account | null>;
  /** Etiquetas já usadas por um apelido (comparação sem acento e sem caixa). */
  tagsInUse(name: string): Promise<Set<string>>;
  saveAccount(account: Account): Promise<void>;
  accountCount(): Promise<number>;
  /** Apaga contas sem acesso desde `before` (menos as de `keep`). Devolve quantas. */
  pruneInactive(before: number, keep?: ReadonlySet<string>): Promise<number>;
  /** Retenção: tira denúncias e partidas guardadas mais antigas que os prazos. */
  pruneHistory(reportsBefore: number, matchesBefore: number): Promise<void>;
  /** Apaga a conta, tira o id das listas dos outros e remove partidas e denúncias dela. */
  deleteAccount(id: string): Promise<void>;
  appendMatch(match: StoredMatch): Promise<void>;
  lastMatchBetween(a: string, b: string): Promise<StoredMatch | null>;
  appendReport(report: Report): Promise<void>;
  getDailyBoard(id: string): Promise<DailyBoard | null>;
  saveDailyBoard(board: DailyBoard): Promise<void>;
  /** Apaga as tabelas de dias que não estão em `keep`. */
  pruneDailyBoards(keep: ReadonlySet<string>): Promise<void>;
  /** Grava o que estiver pendente. */
  flush(): Promise<void>;
  close(): Promise<void>;
}

export function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}
