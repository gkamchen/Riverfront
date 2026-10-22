/**
 * Modo online do cliente. Nada aqui depende da cena 3D: a integração com o
 * jogo está descrita em docs/online-integration.md.
 */
export { copyText, defaultServerUrl, inviteLink, roomCodeFromLocation, toServerUrl, DEFAULT_PORT, SERVER_QUERY_KEY } from './address.ts';
export { Connection, type ConnectionStatus, type NetErrorCode, type NetResult, type SocketLike } from './connection.ts';
export { mountOnlinePanel, type OnlinePanel, type OnlinePanelDeps } from './onlinePanel.ts';
export { RemoteMatchHost, type MatchUpdate } from './remoteMatchHost.ts';
export { OnlineSession, type SessionEvents, type SessionOptions } from './session.ts';
export { CampaignStore, MemoryKeyValueStore, ProfileStorage, serverKey, type KeyValueStore } from './storage.ts';
