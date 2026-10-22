import {
  FACTION_IDS,
  MUTATOR_IDS,
  PRESETS,
  SEATS,
  type AbilityRequest,
  type CampaignProgress,
  type Coord,
  type LogEntry,
  type Placement,
  type PlayerId,
  type Rotation,
  type SpecialShotRequest,
} from '@riverfront/core';
import { EMBLEMS, EMOJIS, FLAG_PATTERN, TAUNTS } from './cosmetics.ts';
import { CLOCK_IDS } from './limits.ts';
import type { ClientMessage, ReportReason } from './messages.ts';
import { NAME_MAX } from './names.ts';
import { COLOUR_IDS } from './palette.ts';
import { arr, bool, int, literal, num, obj, oneOf, optional, str, tagged, type Check, type Validator } from './validate.ts';

export const USER_ID_PATTERN = /^[A-Za-z0-9_-]{16,32}$/;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

const MAX_FIELD = 64;

/** Tamanhos de campo aceitos em salas personalizadas. */
export const FIELD_LIMITS = { minCols: 8, maxCols: 25, minRows: 4, maxRows: 9 } as const;
const MAX_PIECES = 64;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const requestId = optional(int(0, 2 ** 31 - 1));
const userId = str({ max: 32, pattern: USER_ID_PATTERN });

const pieceId = str({ max: 32, pattern: /^[a-z][a-z0-9-]{0,31}$/ });

export const coord: Validator<Coord> = obj({ col: int(0, MAX_FIELD - 1), row: int(0, MAX_FIELD - 1) });

const rotation: Validator<Rotation> = (input, path = '') => {
  if (input === 0 || input === 1 || input === 2 || input === 3) return { ok: true, value: input };
  return { ok: false, path: path || '$', reason: 'rotação inválida' };
};

export const placement: Validator<Placement> = obj({
  pieceId,
  anchor: coord,
  rotation,
});

export const abilityRequest: Validator<AbilityRequest> = tagged<AbilityRequest>('ability', {
  radar: obj({ ability: literal('radar'), target: coord }),
  bomb: obj({ ability: literal('bomb'), target: coord }),
  shield: obj({ ability: literal('shield'), pieceId }),
  repair: obj({ ability: literal('repair'), target: coord }),
  spy: obj({ ability: literal('spy'), axis: oneOf(['row', 'col']), index: int(0, MAX_FIELD - 1) }),
});

export const specialRequest: Validator<SpecialShotRequest> = obj({
  target: coord,
  axis: optional(oneOf(['row', 'col'])),
  second: optional(coord),
});

const player = oneOf<PlayerId>(['blue', 'red']);
const at = num(0, Number.MAX_SAFE_INTEGER);

/** Uma entrada do log do core (partidas locais enviadas para conferência). */
export const logEntry: Validator<LogEntry> = tagged<LogEntry>('type', {
  place: obj({ type: literal('place'), player, pieceId, anchor: coord, rotation, at }),
  move: obj({ type: literal('move'), player, pieceId, anchor: coord, at }),
  rotate: obj({ type: literal('rotate'), player, pieceId, rotation, at }),
  remove: obj({ type: literal('remove'), player, pieceId, at }),
  layout: obj({ type: literal('layout'), player, placements: arr(placement, MAX_PIECES), at }),
  auto: obj({ type: literal('auto'), player, seed: int(0, 2 ** 32 - 1), at }),
  confirm: obj({ type: literal('confirm'), player, at }),
  attack: obj({ type: literal('attack'), player, target: coord, at }),
  ability: obj({ type: literal('ability'), player, request: abilityRequest, at }),
  special: obj({ type: literal('special'), player, request: specialRequest, at }),
  tower: obj({ type: literal('tower'), player, target: coord, at }),
  timeout: obj({ type: literal('timeout'), player, at }),
  surrender: obj({ type: literal('surrender'), player, at }),
  disconnect: obj({ type: literal('disconnect'), player, at }),
  reconnect: obj({ type: literal('reconnect'), player, at }),
  abandon: obj({ type: literal('abandon'), player, at }),
});

/** Maior log aceito (uma partida longa tem algumas centenas de entradas). */
export const MAX_LOG_ENTRIES = 3_000;

const missionRecord = obj({
  won: bool,
  stars: int(0, 3),
  bestShots: (input: unknown, path = '') => (input === null ? { ok: true as const, value: null } : int(0, 100_000)(input, path)),
  attempts: int(0, 1_000_000),
});

/** Progresso da campanha vindo do cliente: só a forma; as regras de desbloqueio são conferidas no servidor. */
type MissionShape = typeof missionRecord extends Validator<infer T> ? T : never;

const missions: Validator<Record<string, MissionShape>> = (v, p = '') => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ok: false, path: p || '$', reason: 'esperava objeto' };
  const entries = Object.entries(v);
  if (entries.length > 500) return { ok: false, path: p || '$', reason: 'missões demais' };
  const out: Record<string, MissionShape> = {};
  for (const [id, r] of entries) {
    if (!/^[a-z0-9-]{1,48}$/.test(id)) return { ok: false, path: `${p}.${id}`, reason: 'id inválido' };
    const c = missionRecord(r, `${p}.${id}`);
    if (!c.ok) return c;
    out[id] = c.value;
  }
  return { ok: true, value: out };
};

export const campaignProgress: Validator<CampaignProgress> = (input, path = '') =>
  obj({ version: literal(1), missions })(input, path) as Check<CampaignProgress>;

const REPORT_REASONS: readonly ReportReason[] = ['nome', 'provocacao', 'trapaca', 'abandono', 'outro'];

const emote: Validator<ClientMessage> = (input, path = '') => {
  const base = obj({ id: requestId, t: literal('emote'), kind: oneOf(['emoji', 'taunt']), emote: str({ max: 24 }), to: optional(oneOf(['all', 'team'])) })(input, path);
  if (!base.ok) return base;
  const list: readonly string[] = base.value.kind === 'emoji' ? EMOJIS : TAUNTS;
  if (!list.includes(base.value.emote)) return { ok: false, path: 'emote', reason: 'emote desconhecido' };
  return base as Check<ClientMessage>;
};

const variants: Readonly<Record<ClientMessage['t'], Validator<ClientMessage>>> = {
  hello: obj({
    id: requestId,
    t: literal('hello'),
    protocol: obj({ min: int(1, 1000), max: int(1, 1000) }),
    client: obj({ name: str({ max: 32 }), version: str({ max: 32 }) }),
    auth: optional(obj({ userId, token: str({ max: 64, pattern: TOKEN_PATTERN }) })),
    name: optional(str({ max: NAME_MAX * 2 })),
  }),
  'profile.update': obj({
    id: requestId,
    t: literal('profile.update'),
    name: optional(str({ max: NAME_MAX * 2 })),
    colour: optional(oneOf(COLOUR_IDS)),
    flag: optional(str({ max: 2, pattern: FLAG_PATTERN })),
    emblem: optional(oneOf(EMBLEMS)),
  }),
  'room.create': obj({
    id: requestId,
    t: literal('room.create'),
    clock: oneOf(CLOCK_IDS),
    mode: oneOf(Object.keys(PRESETS) as (keyof typeof PRESETS)[]),
    mutators: optional(arr(oneOf(MUTATOR_IDS), MUTATOR_IDS.length)),
    format: optional(oneOf(['duel', 'doubles'])),
    size: optional(obj({ cols: int(FIELD_LIMITS.minCols, FIELD_LIMITS.maxCols), rows: int(FIELD_LIMITS.minRows, FIELD_LIMITS.maxRows) })),
  }),
  'room.join': obj({ id: requestId, t: literal('room.join'), code: str({ max: 16 }) }),
  'room.leave': obj({ id: requestId, t: literal('room.leave') }),
  ready: obj({ id: requestId, t: literal('ready'), ready: bool }),
  'seat.choose': obj({ id: requestId, t: literal('seat.choose'), seat: oneOf(SEATS) }),
  faction: obj({ id: requestId, t: literal('faction'), faction: oneOf(FACTION_IDS) }),
  'placement.submit': obj({
    id: requestId,
    t: literal('placement.submit'),
    placements: arr(placement, MAX_PIECES),
    confirm: bool,
  }),
  'placement.auto': obj({ id: requestId, t: literal('placement.auto') }),
  attack: obj({ id: requestId, t: literal('attack'), target: coord }),
  ability: obj({ id: requestId, t: literal('ability'), request: abilityRequest }),
  special: obj({ id: requestId, t: literal('special'), request: specialRequest }),
  surrender: obj({ id: requestId, t: literal('surrender') }),
  emote,
  mute: obj({ id: requestId, t: literal('mute'), muted: bool, who: optional(oneOf(['opponents', 'partner'])) }),
  ping: obj({ id: requestId, t: literal('ping'), ts: int(0, Number.MAX_SAFE_INTEGER) }),
  sync: obj({ id: requestId, t: literal('sync') }),
  rematch: obj({ id: requestId, t: literal('rematch'), accept: bool }),
  'friends.list': obj({ id: requestId, t: literal('friends.list') }),
  'friends.request': obj({ id: requestId, t: literal('friends.request'), tag: str({ max: NAME_MAX + 8 }) }),
  'friends.accept': obj({ id: requestId, t: literal('friends.accept'), userId }),
  'friends.decline': obj({ id: requestId, t: literal('friends.decline'), userId }),
  'friends.remove': obj({ id: requestId, t: literal('friends.remove'), userId }),
  'friends.block': obj({ id: requestId, t: literal('friends.block'), userId }),
  'friends.unblock': obj({ id: requestId, t: literal('friends.unblock'), userId }),
  invite: obj({ id: requestId, t: literal('invite'), userId }),
  report: obj({
    id: requestId,
    t: literal('report'),
    userId,
    reason: oneOf(REPORT_REASONS),
    note: optional(str({ max: 500 })),
    attachMatch: bool,
  }),
  'daily.get': obj({ id: requestId, t: literal('daily.get'), date: optional(str({ max: 10, pattern: DATE_PATTERN })) }),
  'daily.submit': obj({ id: requestId, t: literal('daily.submit'), date: str({ max: 10, pattern: DATE_PATTERN }), log: arr(logEntry, MAX_LOG_ENTRIES, 1) }),
  'campaign.get': obj({ id: requestId, t: literal('campaign.get') }),
  'campaign.sync': obj({ id: requestId, t: literal('campaign.sync'), progress: campaignProgress }),
  'campaign.result': obj({ id: requestId, t: literal('campaign.result'), mission: str({ max: 48, pattern: /^[a-z0-9-]{1,48}$/ }), log: arr(logEntry, MAX_LOG_ENTRIES, 1) }),
  'account.delete': obj({ id: requestId, t: literal('account.delete'), confirm: literal('EXCLUIR') }),
};

export const clientMessage: Validator<ClientMessage> = tagged<ClientMessage>('t', variants);
