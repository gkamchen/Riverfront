import { FACTION_IDS, FACTIONS, GAME_PRESETS, SEATS, MUTATOR_IDS, MUTATORS, type ClockPresetId, type FactionId, type MutatorId } from '@riverfront/core';
import {
  CLOCK_IDS,
  CLOCK_LABELS,
  EMBLEMS,
  NAME_MAX,
  NAME_PROBLEM_TEXT,
  TEAM_COLOURS,
  checkName,
  colourById,
  flagEmoji,
  normalizeRoomCode,
  type FriendsList,
  type GameMode,
  type PresenceStatus,
  type PublicProfile,
  type RoomInfo,
} from '@riverfront/protocol';
import { copyText, defaultServerUrl, inviteLink, roomCodeFromLocation, toServerUrl } from './address.ts';
import type { NetResult } from './connection.ts';
import type { RemoteMatchHost } from './remoteMatchHost.ts';
import { OnlineSession } from './session.ts';
import { ProfileStorage } from './storage.ts';

export interface OnlinePanelDeps {
  /** Sessão já existente. Sem ela, o painel cria uma ao clicar em "Conectar". */
  readonly session?: OnlineSession;
  readonly storage?: ProfileStorage;
  /** Endereço inicial. Padrão: `?servidor=`, a própria origem (se servida pelo servidor) ou o último usado. */
  readonly serverUrl?: string | null;
  readonly clientVersion?: string;
  /** Conecta sozinho ao abrir quando já há um endereço conhecido. Padrão true. */
  readonly autoConnect?: boolean;
  /** A partida começou (ou recomeçou na revanche): troque para a tela do jogo. */
  onMatchStart?(ctx: { session: OnlineSession; host: RemoteMatchHost; room: RoomInfo }): void;
  /** Sessão criada ou descartada pelo painel. */
  onSessionChange?(session: OnlineSession | null): void;
  /** Mostra um botão "Fechar" que chama isto. */
  onClose?(): void;
}

export interface OnlinePanel {
  readonly element: HTMLElement;
  readonly session: OnlineSession | null;
  /** Mostra uma mensagem na linha de avisos do painel. */
  notify(text: string, kind?: 'info' | 'erro'): void;
  destroy(): void;
}

const EMBLEM_LABELS: Readonly<Record<(typeof EMBLEMS)[number], string>> = {
  ancora: 'Âncora',
  estrela: 'Estrela',
  raio: 'Raio',
  coroa: 'Coroa',
  escudo: 'Escudo',
  lobo: 'Lobo',
  aguia: 'Águia',
  arvore: 'Árvore',
  onda: 'Onda',
  montanha: 'Montanha',
};

const STATUS_TEXT = {
  idle: 'Desconectado',
  connecting: 'Conectando…',
  online: 'Conectado',
  reconnecting: 'Reconectando…',
  offline: 'Desconectado',
} as const;

const PRESENCE_TEXT: Readonly<Record<PresenceStatus, string>> = { online: 'online', 'in-match': 'em partida', offline: 'offline' };

const ROOM_STATE_TEXT: Readonly<Record<RoomInfo['state'], string>> = {
  waiting: 'Esperando o adversário',
  lobby: 'Saguão: marquem "Pronto"',
  placing: 'Posicionando peças',
  playing: 'Partida em andamento',
  finished: 'Partida encerrada',
};

/** Nome dos lugares das duplas. */
const SEAT_LABEL: Readonly<Record<string, string>> = {
  'blue-1': 'Azul 1',
  'blue-2': 'Azul 2',
  'red-1': 'Vermelho 1',
  'red-2': 'Vermelho 2',
};

const STYLE_ID = 'rf-online-style';
const STYLE = `
.rf-online{font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#f3eee2;background:rgba(28,22,16,.94);border:1px solid #6b5636;border-radius:12px;padding:14px 16px;max-width:420px;width:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;max-height:100%;overflow:auto}
.rf-online h2{font-size:17px;margin:0;display:flex;justify-content:space-between;align-items:center}
.rf-online h3{font-size:13px;margin:0 0 6px;text-transform:uppercase;letter-spacing:.06em;color:#d9c49b}
.rf-online section{border-top:1px solid rgba(217,196,155,.25);padding-top:10px}
.rf-online label{display:block;font-size:12px;color:#cbbd9f;margin:6px 0 2px}
.rf-online input,.rf-online select{font:inherit;color:#1d1710;background:#f6f0e2;border:1px solid #a68d62;border-radius:6px;padding:5px 8px;box-sizing:border-box}
.rf-online input[type=text]{width:100%}
.rf-online button{font:inherit;cursor:pointer;color:#1d1710;background:#e2c78d;border:1px solid #8c7244;border-radius:6px;padding:5px 10px}
.rf-online button:hover:not(:disabled){background:#f0d69d}
.rf-online button:disabled{opacity:.5;cursor:default}
.rf-online button.rf-ghost{background:transparent;color:#f3eee2;border-color:#7a6748}
.rf-online button.rf-danger{background:#b9493c;color:#fff;border-color:#7d2a20}
.rf-online .rf-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.rf-online .rf-row>input[type=text]{flex:1;min-width:120px}
.rf-online .rf-muted{color:#b6a888;font-size:12px}
.rf-online .rf-msg{min-height:1.4em;font-size:13px}
.rf-online .rf-msg.rf-erro{color:#ff9b8a}
.rf-online .rf-swatches{display:flex;flex-wrap:wrap;gap:6px}
.rf-online .rf-swatch{width:28px;height:28px;border-radius:50%;padding:0;border:2px solid rgba(0,0,0,.4);position:relative}
.rf-online .rf-swatch[aria-pressed=true]{outline:3px solid #fff;outline-offset:1px}
.rf-online .rf-swatch.rf-cb::after{content:"◐";position:absolute;inset:0;display:grid;place-items:center;font-size:12px;color:#fff;text-shadow:0 0 2px #000}
.rf-online .rf-code{font:700 26px/1.1 ui-monospace,Consolas,monospace;letter-spacing:.12em}
.rf-online ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.rf-online li{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.rf-online li .rf-name{flex:1;min-width:100px}
.rf-online .rf-dot{width:10px;height:10px;border-radius:50%;display:inline-block;flex:none}
.rf-online .rf-online-dot{background:#5fd27a}.rf-online .rf-in-match-dot{background:#f0c25b}.rf-online .rf-offline-dot{background:#777}
.rf-online .rf-toast{background:#3b2f20;border:1px solid #c9a865;border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px}
`;

/** Nome do modo para mostrar; os apelidos em português caem no preset original. */
function modeName(mode: string): string {
  const base = mode === 'classico' ? 'classic' : mode === 'completo' ? 'full' : mode;
  return GAME_PRESETS.find((m) => m.id === base)?.name ?? mode;
}

type Child = Node | string | null | false | undefined;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value as EventListener);
    else if (key in el && typeof value !== 'string') (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

function profileLabel(p: PublicProfile): string {
  const flag = flagEmoji(p.flag);
  return `${flag ? `${flag} ` : ''}${p.name}#${p.tag}`;
}

export function mountOnlinePanel(container: HTMLElement, deps: OnlinePanelDeps = {}): OnlinePanel {
  if (!document.getElementById(STYLE_ID)) {
    document.head.append(h('style', { id: STYLE_ID }, STYLE));
  }
  const storage = deps.storage ?? deps.session?.storage ?? new ProfileStorage();
  let session: OnlineSession | null = deps.session ?? null;
  let offSession: (() => void)[] = [];
  let pendingJoin = roomCodeFromLocation();
  let selectedColour = storage.profile?.colour ?? TEAM_COLOURS[0]?.id ?? 'azul';

  // ------------------------------------------------------------ esqueleto

  const msg = h('div', { class: 'rf-msg', role: 'status', 'aria-live': 'polite' });
  const notify = (text: string, kind: 'info' | 'erro' = 'info') => {
    msg.textContent = text;
    msg.className = `rf-msg${kind === 'erro' ? ' rf-erro' : ''}`;
  };
  const report = (result: NetResult, okText?: string) => {
    if (result.ok) {
      if (okText) notify(okText);
    } else notify(result.message, 'erro');
    return result.ok;
  };

  const serverInput = h('input', {
    type: 'text',
    placeholder: 'ex.: 192.168.0.10:8787 ou jogo.exemplo.com',
    'aria-label': 'Endereço do servidor',
    value: deps.serverUrl ?? defaultServerUrl() ?? storage.serverUrl ?? '',
  });
  const connectBtn = h('button', { type: 'button' }, 'Conectar');
  const statusLine = h('div', { class: 'rf-muted' }, 'Desconectado');

  const nameInput = h('input', { type: 'text', maxLength: NAME_MAX, 'aria-label': 'Apelido', value: storage.profile?.name ?? '' });
  const tagLine = h('span', { class: 'rf-muted' });
  const swatches = h('div', { class: 'rf-swatches', role: 'group', 'aria-label': 'Cor do time' });
  const flagInput = h('input', { type: 'text', maxLength: 2, size: 3, placeholder: 'BR', 'aria-label': 'Bandeira (código do país)', value: storage.profile?.flag ?? '' });
  const emblemSelect = h('select', { 'aria-label': 'Emblema' }, ...EMBLEMS.map((id) => h('option', { value: id }, EMBLEM_LABELS[id])));
  emblemSelect.value = storage.profile?.emblem ?? EMBLEMS[0];
  const saveProfileBtn = h('button', { type: 'button' }, 'Salvar perfil');

  const clockSelect = h('select', { 'aria-label': 'Relógio' }, ...CLOCK_IDS.map((id) => h('option', { value: id }, CLOCK_LABELS[id])));
  clockSelect.value = 'padrao';
  const modeSelect = h('select', { 'aria-label': 'Modo' }, ...GAME_PRESETS.map((m) => h('option', { value: m.id, title: m.description }, m.name)));
  modeSelect.value = 'full';
  const formatSelect = h('select', { 'aria-label': 'Formato' }, h('option', { value: 'duel' }, '1 contra 1'), h('option', { value: 'doubles' }, 'Duplas (2 contra 2)'));
  const createBtn = h('button', { type: 'button' }, 'Criar sala');
  const mutatorBoxes = MUTATOR_IDS.map((id) => ({ id, box: h('input', { type: 'checkbox', value: id }) }));
  const mutatorRow = h(
    'div',
    { class: 'rf-row' },
    ...mutatorBoxes.map(({ id, box }) => h('label', { title: MUTATORS[id].description }, box, ` ${MUTATORS[id].name}`)),
  );
  const codeInput = h('input', { type: 'text', maxLength: 9, placeholder: 'K7Q2-PX', 'aria-label': 'Código da sala', autocapitalize: 'characters' });
  const joinBtn = h('button', { type: 'button' }, 'Entrar');
  const roomBox = h('div');
  const lobbyBox = h('div', {}, h('div', { class: 'rf-row' }, formatSelect, clockSelect, modeSelect), h('label', {}, 'Variantes'), mutatorRow, h('div', { class: 'rf-row' }, createBtn), h('label', {}, 'Ou entre com um código'), h('div', { class: 'rf-row' }, codeInput, joinBtn));

  const friendInput = h('input', { type: 'text', placeholder: 'Nome#1234', 'aria-label': 'Adicionar amigo por etiqueta' });
  const addFriendBtn = h('button', { type: 'button' }, 'Adicionar');
  const friendsBox = h('div');
  const toasts = h('div', { class: 'rf-row' });
  const deleteBtn = h('button', { type: 'button', class: 'rf-danger' }, 'Excluir minha conta');

  const profileSection = h(
    'section',
    {},
    h('h3', {}, 'Perfil'),
    h('label', {}, 'Apelido'),
    h('div', { class: 'rf-row' }, nameInput, tagLine),
    h('label', {}, 'Cor do time (◐ = segura para daltonismo)'),
    swatches,
    h('div', { class: 'rf-row' }, h('label', {}, 'Bandeira'), flagInput, h('label', {}, 'Emblema'), emblemSelect),
    h('div', { class: 'rf-row' }, saveProfileBtn),
  );
  const roomSection = h('section', {}, h('h3', {}, 'Partida'), lobbyBox, roomBox);
  const friendsSection = h('section', {}, h('h3', {}, 'Amigos'), h('div', { class: 'rf-row' }, friendInput, addFriendBtn), friendsBox);
  const accountSection = h('section', {}, h('p', { class: 'rf-muted' }, 'Sua conta é anônima e fica guardada neste aparelho.'), deleteBtn);

  const root = h(
    'div',
    { class: 'rf-online' },
    h('h2', {}, 'Jogar online', deps.onClose ? h('button', { type: 'button', class: 'rf-ghost', onclick: () => deps.onClose?.(), 'aria-label': 'Fechar' }, 'Fechar') : null),
    h('section', {}, h('h3', {}, 'Servidor'), h('div', { class: 'rf-row' }, serverInput, connectBtn), statusLine),
    toasts,
    profileSection,
    roomSection,
    friendsSection,
    accountSection,
    msg,
  );
  container.append(root);

  // ------------------------------------------------------------ desenho

  const renderSwatches = () => {
    swatches.replaceChildren(
      ...TEAM_COLOURS.map((c) =>
        h('button', {
          type: 'button',
          class: `rf-swatch${c.colourBlindSafe ? ' rf-cb' : ''}`,
          style: `background:${c.hex}`,
          title: c.name,
          'aria-label': c.name,
          'aria-pressed': String(c.id === selectedColour),
          onclick: () => {
            selectedColour = c.id;
            renderSwatches();
          },
        }),
      ),
    );
  };

  const renderStatus = () => {
    const s = session?.status ?? 'idle';
    const rtt = session?.connection.rtt;
    statusLine.textContent = s === 'online' && rtt !== null && rtt !== undefined ? `${STATUS_TEXT[s]} · ping ${rtt} ms` : STATUS_TEXT[s];
    const online = s === 'online';
    connectBtn.textContent = session && s !== 'offline' ? 'Desconectar' : 'Conectar';
    for (const section of [profileSection, roomSection, friendsSection, accountSection]) {
      for (const el of section.querySelectorAll('input,select,button')) (el as HTMLInputElement).disabled = !online;
    }
  };

  const renderProfile = (p: PublicProfile | null) => {
    if (!p) return;
    if (document.activeElement !== nameInput) nameInput.value = p.name;
    tagLine.textContent = `#${p.tag}`;
    if (document.activeElement !== flagInput) flagInput.value = p.flag;
    emblemSelect.value = p.emblem;
    selectedColour = p.colour;
    renderSwatches();
  };

  const renderRoom = () => {
    const room = session?.room ?? null;
    lobbyBox.hidden = room !== null;
    if (!room || !session) {
      roomBox.replaceChildren();
      return;
    }
    const me = room.players.find((p) => p.seat === room.you);
    const link = inviteLink(room.code, session.connection.url);
    const players = h(
      'ul',
      {},
      ...room.players.map((p) =>
        h(
          'li',
          {},
          h('span', { class: 'rf-dot', style: `background:${colourById(p.colour)?.hex ?? '#888'}`, title: colourById(p.colour)?.name ?? '' }),
          h('span', { class: 'rf-name' }, `${room.format === 'doubles' ? `${SEAT_LABEL[p.seat] ?? p.seat}: ` : ''}${profileLabel(p.profile)}${p.seat === room.you ? ' (você)' : ''}`),
          p.faction !== 'neutra' ? h('span', { class: 'rf-muted' }, FACTIONS[p.faction]?.name ?? p.faction) : null,
          !p.connected ? h('span', { class: 'rf-muted' }, 'desconectado') : null,
          room.state === 'lobby' ? h('span', { class: 'rf-muted' }, p.ready ? 'pronto' : 'não pronto') : null,
          room.state === 'finished' && p.wantsRematch ? h('span', { class: 'rf-muted' }, 'quer revanche') : null,
        ),
      ),
    );
    const actions = h('div', { class: 'rf-row' });
    if (room.format === 'doubles' && (room.state === 'waiting' || room.state === 'lobby') && me && !me.ready) {
      const taken = new Set(room.players.map((p) => p.seat));
      for (const seat of SEATS) {
        if (taken.has(seat)) continue;
        actions.append(h('button', { type: 'button', class: 'rf-ghost', onclick: async () => report(await session?.chooseSeat(seat) ?? offlineResult) }, `Ir para ${SEAT_LABEL[seat]}`));
      }
    }
    if ((room.state === 'waiting' || room.state === 'lobby' || room.state === 'finished') && me && !me.ready) {
      const select = h(
        'select',
        {
          'aria-label': 'Facção',
          onchange: async () => report(await session?.setFaction(select.value as FactionId) ?? offlineResult),
        },
        ...FACTION_IDS.map((id) => h('option', { value: id }, FACTIONS[id].name)),
      );
      select.value = me.faction;
      actions.append(h('label', {}, 'Facção'), select);
    }
    if (room.state === 'lobby' && me) {
      actions.append(h('button', { type: 'button', onclick: async () => report(await session?.setReady(!me.ready) ?? offlineResult) }, me.ready ? 'Cancelar pronto' : 'Estou pronto'));
    }
    if (room.state === 'finished' && me) {
      actions.append(h('button', { type: 'button', disabled: me.wantsRematch, onclick: async () => report(await session?.rematch(true) ?? offlineResult, 'Pedido de revanche enviado.') }, 'Revanche'));
    }
    actions.append(
      h(
        'button',
        {
          type: 'button',
          class: 'rf-ghost',
          onclick: async () => {
            const playing = room.state === 'placing' || room.state === 'playing';
            if (playing && !window.confirm('Sair agora conta como desistência. Sair mesmo assim?')) return;
            report(await session?.leaveRoom() ?? offlineResult);
          },
        },
        'Sair da sala',
      ),
    );
    roomBox.replaceChildren(
      h('div', { class: 'rf-row' }, h('span', { class: 'rf-code', 'aria-label': 'Código da sala' }, room.code)),
      h(
        'div',
        { class: 'rf-row' },
        h('button', { type: 'button', class: 'rf-ghost', onclick: async () => notify((await copyText(room.code)) ? 'Código copiado.' : 'Não deu para copiar; anote o código.') }, 'Copiar código'),
        h('button', { type: 'button', class: 'rf-ghost', onclick: async () => notify((await copyText(link)) ? 'Link copiado.' : link) }, 'Copiar link'),
      ),
      h(
        'div',
        { class: 'rf-muted' },
        [ROOM_STATE_TEXT[room.state], CLOCK_LABELS[room.clock], modeName(room.mode), ...(room.size ? [`${room.size.cols}×${room.size.rows}`] : []), ...room.mutators.map((m) => MUTATORS[m]?.name ?? m)].join(' · '),
      ),
      room.expiresAt && room.state === 'waiting' ? h('div', { class: 'rf-muted' }, 'A sala expira em 10 minutos se ninguém entrar.') : '',
      players,
      actions,
    );
    renderFriends();
  };

  const renderFriends = () => {
    const list: FriendsList | null = session?.friends ?? null;
    if (!list || !session) {
      friendsBox.replaceChildren(h('p', { class: 'rf-muted' }, 'Conecte-se para ver seus amigos.'));
      return;
    }
    const s = session;
    const roomOpen = s.room && (s.room.state === 'waiting' || s.room.state === 'lobby');
    const act = (label: string, run: () => Promise<NetResult>, ok?: string, cls = 'rf-ghost') =>
      h('button', { type: 'button', class: cls, onclick: async () => report(await run(), ok) }, label);
    const block = (p: PublicProfile) =>
      h('button', {
        type: 'button',
        class: 'rf-ghost',
        onclick: async () => {
          if (window.confirm(`Bloquear ${p.name}#${p.tag}? Vocês deixam de ser amigos e ${p.name} não poderá mais te convidar.`)) report(await s.block(p.userId), 'Jogador bloqueado.');
        },
      }, 'Bloquear');
    const parts: Node[] = [];
    if (list.incoming.length > 0) {
      parts.push(
        h('label', {}, 'Pedidos recebidos'),
        h('ul', {}, ...list.incoming.map((r) => h('li', {}, h('span', { class: 'rf-name' }, profileLabel(r.profile)), act('Aceitar', () => s.acceptFriend(r.profile.userId), undefined, ''), act('Recusar', () => s.declineFriend(r.profile.userId)), block(r.profile)))),
      );
    }
    parts.push(
      h('label', {}, `Amigos (${list.friends.length})`),
      list.friends.length === 0
        ? h('p', { class: 'rf-muted' }, 'Nenhum amigo ainda. Peça a etiqueta (Nome#1234) de quem joga com você.')
        : h(
            'ul',
            {},
            ...[...list.friends]
              .sort((a, b) => (a.status === 'offline' ? 1 : 0) - (b.status === 'offline' ? 1 : 0))
              .map((f) =>
                h(
                  'li',
                  {},
                  h('span', { class: `rf-dot rf-${f.status}-dot`, title: PRESENCE_TEXT[f.status] }),
                  h('span', { class: 'rf-name' }, profileLabel(f.profile), h('span', { class: 'rf-muted' }, ` · ${PRESENCE_TEXT[f.status]}`)),
                  roomOpen && f.status === 'online' ? act('Convidar', () => s.invite(f.profile.userId), 'Convite enviado.', '') : null,
                  act('Remover', () => s.removeFriend(f.profile.userId)),
                  block(f.profile),
                ),
              ),
          ),
    );
    if (list.outgoing.length > 0) {
      parts.push(h('label', {}, 'Pedidos enviados'), h('ul', {}, ...list.outgoing.map((r) => h('li', {}, h('span', { class: 'rf-name' }, profileLabel(r.profile)), h('span', { class: 'rf-muted' }, 'pendente')))));
    }
    if (list.blocked.length > 0) {
      parts.push(h('label', {}, 'Bloqueados'), h('ul', {}, ...list.blocked.map((p) => h('li', {}, h('span', { class: 'rf-name' }, profileLabel(p)), act('Desbloquear', () => s.unblock(p.userId))))));
    }
    friendsBox.replaceChildren(...parts);
  };

  const showInvite = (from: PublicProfile, code: string) => {
    const toast = h(
      'div',
      { class: 'rf-toast', role: 'alert' },
      `${profileLabel(from)} convidou você para a sala ${code}.`,
      h(
        'div',
        { class: 'rf-row' },
        h('button', { type: 'button', onclick: async () => { toast.remove(); report(await session?.joinRoom(code) ?? offlineResult); } }, 'Entrar'),
        h('button', { type: 'button', class: 'rf-ghost', onclick: () => toast.remove() }, 'Ignorar'),
      ),
    );
    toasts.append(toast);
    setTimeout(() => toast.remove(), 60_000);
  };

  // ------------------------------------------------------------ sessão

  const offlineResult: NetResult = { ok: false, code: 'offline', detail: null, message: 'Sem conexão com o servidor.' };

  const attach = (s: OnlineSession) => {
    for (const off of offSession) off();
    offSession = [
      s.on('status', renderStatus),
      s.on('rtt', renderStatus),
      s.on('fatal', (reason) => notify(reason, 'erro')),
      s.on('profile', (p) => {
        renderProfile(p);
        if (pendingJoin) {
          const code = pendingJoin;
          pendingJoin = null;
          void s.joinRoom(code).then((r) => report(r, `Você entrou na sala ${code}.`));
        }
      }),
      s.on('room', renderRoom),
      s.on('roomClosed', (reason) => {
        renderRoom();
        const text = { expired: 'A sala expirou.', left: 'Você saiu da sala.', 'opponent-left': 'O adversário saiu da sala.', shutdown: 'O servidor foi reiniciado.', deleted: 'A sala foi encerrada.' }[reason];
        notify(text);
      }),
      s.on('matchStart', ({ room, host }) => deps.onMatchStart?.({ session: s, host, room })),
      s.on('friends', renderFriends),
      s.on('presence', renderFriends),
      s.on('friendRequest', (p) => notify(`${profileLabel(p)} quer ser seu amigo.`)),
      s.on('invite', ({ from, code }) => showInvite(from, code)),
      s.on('colourAdjusted', ({ given }) => notify(`Sua cor estava parecida demais com a do adversário. Nesta sala você joga de ${colourById(given)?.name ?? given}.`)),
      s.on('opponent', ({ connected, graceLeftMs }) =>
        notify(connected ? 'O adversário voltou.' : `O adversário caiu. Ele tem ${Math.ceil((graceLeftMs ?? 45_000) / 1000)} s para voltar.`),
      ),
      s.on('rematchOffer', () => notify('O adversário quer revanche!')),
      s.on('error', (e) => notify(e.message, 'erro')),
      s.on('accountDeleted', () => notify('Conta excluída. Uma nova será criada se você conectar de novo.')),
    ];
    renderStatus();
    renderProfile(s.profile);
    renderRoom();
    renderFriends();
  };

  const connect = async () => {
    const url = toServerUrl(serverInput.value);
    if (!url) {
      notify('Endereço do servidor inválido.', 'erro');
      return;
    }
    if (session && session.connection.url !== url) {
      session.dispose();
      session = null;
    }
    if (!session) {
      const name = nameInput.value.trim();
      session = new OnlineSession(url, { storage, clientVersion: deps.clientVersion ?? '0', ...(name ? { name } : {}) });
      deps.onSessionChange?.(session);
    }
    attach(session);
    notify('Conectando…');
    try {
      await session.connect();
      notify(`Conectado como ${session.displayTag ?? ''}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível conectar.', 'erro');
    }
  };

  connectBtn.addEventListener('click', () => {
    if (session && session.status !== 'offline' && session.status !== 'idle') {
      session.disconnect();
      renderStatus();
      return;
    }
    void connect();
  });

  saveProfileBtn.addEventListener('click', async () => {
    if (!session) return;
    const checked = checkName(nameInput.value);
    if (!checked.ok) {
      notify(NAME_PROBLEM_TEXT[checked.problem], 'erro');
      return;
    }
    const flag = flagInput.value.trim().toUpperCase();
    if (flag && !/^[A-Z]{2}$/.test(flag)) {
      notify('Bandeira: use o código de duas letras do país (ex.: BR, PT).', 'erro');
      return;
    }
    report(await session.updateProfile({ name: checked.name, colour: selectedColour, flag, emblem: emblemSelect.value }), 'Perfil salvo.');
  });

  createBtn.addEventListener('click', async () => {
    if (!session) return;
    const mutators: MutatorId[] = mutatorBoxes.filter(({ box }) => box.checked).map(({ id }) => id);
    const doubles = formatSelect.value === 'doubles';
    report(
      await session.createRoom(clockSelect.value as ClockPresetId, modeSelect.value as GameMode, mutators, undefined, doubles ? 'doubles' : 'duel'),
      doubles ? 'Sala de duplas criada. Chame seu parceiro e os dois adversários com o código ou o link.' : 'Sala criada. Mande o código ou o link para seu amigo.',
    );
  });

  const join = async () => {
    if (!session) return;
    const code = normalizeRoomCode(codeInput.value);
    if (!code) {
      notify('Código inválido. Ele tem o formato K7Q2-PX.', 'erro');
      return;
    }
    report(await session.joinRoom(code), `Você entrou na sala ${code}.`);
  };
  joinBtn.addEventListener('click', () => void join());
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void join();
  });

  const addFriend = async () => {
    if (!session || !friendInput.value.trim()) return;
    if (report(await session.addFriend(friendInput.value.trim()), 'Pedido enviado.')) friendInput.value = '';
  };
  addFriendBtn.addEventListener('click', () => void addFriend());
  friendInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void addFriend();
  });

  deleteBtn.addEventListener('click', async () => {
    if (!session) return;
    if (!window.confirm('Excluir sua conta apaga apelido, amigos e histórico neste servidor. Não dá para desfazer. Continuar?')) return;
    report(await session.deleteAccount(), 'Conta excluída.');
  });

  renderSwatches();
  if (session) attach(session);
  else renderStatus();
  renderFriends();
  if (!session && (deps.autoConnect ?? true) && serverInput.value) void connect();

  return {
    element: root,
    get session() {
      return session;
    },
    notify,
    destroy() {
      for (const off of offSession) off();
      offSession = [];
      root.remove();
      // a sessão continua viva: quem integrou decide quando desconectar
    },
  };
}
