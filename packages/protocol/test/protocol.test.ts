import { describe, expect, it } from 'vitest';
import {
  checkName,
  colourDistance,
  COLOUR_IDS,
  decodeClientMessage,
  decodeServerMessage,
  encode,
  generateRoomCode,
  hasProfanity,
  MAX_CLIENT_MESSAGE_BYTES,
  MIN_COLOUR_DISTANCE,
  nearestFreeColour,
  negotiateVersion,
  normalizeRoomCode,
  parseTag,
  roomCodeFromLink,
  roomLink,
} from '../src/index.ts';

const hello = {
  t: 'hello',
  id: 1,
  protocol: { min: 1, max: 1 },
  client: { name: 'web', version: '0.1.0' },
};

describe('codec', () => {
  it('aceita mensagens válidas e devolve cópia limpa', () => {
    const r = decodeClientMessage(JSON.stringify({ t: 'attack', id: 7, target: { col: 3, row: 2 } }));
    expect(r).toEqual({ ok: true, msg: { t: 'attack', id: 7, target: { col: 3, row: 2 } } });
    expect(decodeClientMessage(JSON.stringify(hello)).ok).toBe(true);
  });

  it('recusa campos extras, tipos errados e JSON quebrado', () => {
    expect(decodeClientMessage('{"t":"attack","target":{"col":1,"row":1},"x":1}').ok).toBe(false);
    expect(decodeClientMessage('{"t":"attack","target":{"col":1.5,"row":1}}').ok).toBe(false);
    expect(decodeClientMessage('{"t":"attack","target":{"col":-1,"row":1}}').ok).toBe(false);
    expect(decodeClientMessage('{"t":"nada"}').ok).toBe(false);
    expect(decodeClientMessage('{"t":').ok).toBe(false);
    expect(decodeClientMessage('[]').ok).toBe(false);
    expect(decodeClientMessage('null').ok).toBe(false);
  });

  it('devolve o id da mensagem recusada para o cliente casar o erro', () => {
    const r = decodeClientMessage('{"t":"attack","id":9,"target":{}}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ref).toBe(9);
  });

  it('não deixa passar __proto__', () => {
    const r = decodeClientMessage('{"t":"sync","__proto__":{"admin":true}}');
    expect(r.ok).toBe(false);
    const nested = decodeClientMessage('{"t":"attack","target":{"col":1,"row":1,"__proto__":{"x":1}}}');
    expect(nested.ok).toBe(false);
  });

  it('limita o tamanho', () => {
    const big = JSON.stringify({ t: 'report', userId: 'a'.repeat(22), reason: 'outro', attachMatch: false, note: 'x'.repeat(MAX_CLIENT_MESSAGE_BYTES) });
    const r = decodeClientMessage(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('too-large');
    // multibyte conta em bytes, não em caracteres
    const emoji = JSON.stringify({ t: 'room.join', code: '😀'.repeat(3000) });
    expect(decodeClientMessage(emoji).ok).toBe(false);
  });

  it('valida emotes por tipo', () => {
    expect(decodeClientMessage('{"t":"emote","kind":"emoji","emote":"fogo"}').ok).toBe(true);
    expect(decodeClientMessage('{"t":"emote","kind":"taunt","emote":"fogo"}').ok).toBe(false);
    expect(decodeClientMessage('{"t":"emote","kind":"taunt","emote":"errou"}').ok).toBe(true);
  });

  it('valida habilidades', () => {
    expect(decodeClientMessage('{"t":"ability","request":{"ability":"spy","axis":"row","index":2}}').ok).toBe(true);
    expect(decodeClientMessage('{"t":"ability","request":{"ability":"spy","axis":"diag","index":2}}').ok).toBe(false);
    expect(decodeClientMessage('{"t":"ability","request":{"ability":"nuke"}}').ok).toBe(false);
    expect(decodeClientMessage('{"t":"ability","request":{"ability":"shield","pieceId":"bunker-1"}}').ok).toBe(true);
  });

  it('valida posicionamento', () => {
    const ok = { t: 'placement.submit', confirm: true, placements: [{ pieceId: 'armor-1', anchor: { col: 1, row: 1 }, rotation: 1 }] };
    expect(decodeClientMessage(JSON.stringify(ok)).ok).toBe(true);
    const badRot = { ...ok, placements: [{ pieceId: 'armor-1', anchor: { col: 1, row: 1 }, rotation: 4 }] };
    expect(decodeClientMessage(JSON.stringify(badRot)).ok).toBe(false);
    const tooMany = { ...ok, placements: Array.from({ length: 65 }, () => ok.placements[0]) };
    expect(decodeClientMessage(JSON.stringify(tooMany)).ok).toBe(false);
  });

  it('fuzz: entradas aleatórias nunca lançam exceção', () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pieces = ['{', '}', '[', ']', '"t"', ':', ',', '"attack"', '"hello"', '1', '-1', 'null', 'true', '"x"', '1e999', '"__proto__"'];
    for (let i = 0; i < 3000; i++) {
      let text = '';
      const len = Math.floor(rand() * 30);
      for (let j = 0; j < len; j++) text += pieces[Math.floor(rand() * pieces.length)];
      expect(() => decodeClientMessage(text)).not.toThrow();
    }
  });

  it('cliente descarta tipos de servidor desconhecidos', () => {
    expect(decodeServerMessage(encode({ t: 'ok', ref: 1 }))).toEqual({ t: 'ok', ref: 1 });
    expect(decodeServerMessage('{"t":"futuro"}')).toBeNull();
    expect(decodeServerMessage('xx')).toBeNull();
  });
});

describe('versão', () => {
  it('negocia a maior versão em comum', () => {
    expect(negotiateVersion({ min: 1, max: 3 }, { min: 1, max: 2 })).toBe(2);
    expect(negotiateVersion({ min: 3, max: 4 }, { min: 1, max: 2 })).toBeNull();
    expect(negotiateVersion({ min: 1, max: 1 })).toBe(1);
  });
});

describe('apelidos', () => {
  it('aceita nomes comuns com acento', () => {
    expect(checkName('  João  Pedro ')).toEqual({ ok: true, name: 'João Pedro' });
    expect(checkName('Lucas').ok).toBe(true);
    expect(checkName('Cuca_99').ok).toBe(true);
  });

  it('recusa curtos, longos e símbolos', () => {
    expect(checkName('ab')).toEqual({ ok: false, problem: 'curto' });
    expect(checkName('a'.repeat(17))).toEqual({ ok: false, problem: 'longo' });
    expect(checkName('nome<script>')).toEqual({ ok: false, problem: 'caracteres' });
    expect(checkName('_abc').ok).toBe(false);
  });

  it('filtra palavrões com leetspeak e acentos', () => {
    expect(hasProfanity('P0rr4')).toBe(true);
    expect(hasProfanity('cAr@lho')).toBe(true);
    expect(hasProfanity('fuuuuck')).toBe(true);
    expect(hasProfanity('vai tnc')).toBe(true);
    expect(hasProfanity('Lucas')).toBe(false);
    expect(hasProfanity('Computador')).toBe(false);
    expect(hasProfanity('kkk')).toBe(false);
  });

  it('lê etiquetas Nome#1234', () => {
    expect(parseTag('Ana Clara#0420')).toEqual({ name: 'Ana Clara', tag: '0420' });
    expect(parseTag('Ana#12')).toBeNull();
  });
});

describe('salas', () => {
  it('gera e normaliza códigos', () => {
    let i = 0;
    const code = generateRoomCode(() => i++ % 32);
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{2}$/);
    expect(normalizeRoomCode('k7q2px')).toBe('K7Q2-PX');
    expect(normalizeRoomCode('K7Q2-P0')).toBeNull();
    expect(normalizeRoomCode('abc')).toBeNull();
  });

  it('monta e lê links', () => {
    const link = roomLink('https://jogo.exemplo/#antigo', 'K7Q2-PX');
    expect(link).toBe('https://jogo.exemplo/#sala=K7Q2-PX');
    expect(roomCodeFromLink(link)).toBe('K7Q2-PX');
    expect(roomCodeFromLink('#sala=k7q2-px')).toBe('K7Q2-PX');
    expect(roomCodeFromLink('K7Q2PX')).toBe('K7Q2-PX');
  });
});

describe('cores', () => {
  it('o par para daltonismo é bem distinto', () => {
    expect(colourDistance('daltonico-azul', 'daltonico-laranja')).toBeGreaterThan(40);
  });

  it('cores parecidas conflitam e a sugestão é a livre mais próxima', () => {
    expect(colourDistance('azul', 'daltonico-azul')).toBeLessThan(MIN_COLOUR_DISTANCE);
    const given = nearestFreeColour('daltonico-azul', ['azul']);
    expect(given).not.toBe('daltonico-azul');
    expect(colourDistance(given, 'azul')).toBeGreaterThanOrEqual(MIN_COLOUR_DISTANCE);
    expect(nearestFreeColour('verde', ['azul'])).toBe('verde');
  });

  it('cada cor da paleta tem pelo menos uma alternativa livre', () => {
    for (const id of COLOUR_IDS) {
      const other = nearestFreeColour(id, [id]);
      expect(other).not.toBe(id);
    }
  });
});

describe('mensagens novas', () => {
  it('log de partida: entradas válidas passam, campos estranhos não', () => {
    const log = [
      { type: 'auto', player: 'blue', seed: 3, at: 10 },
      { type: 'confirm', player: 'blue', at: 11 },
      { type: 'attack', player: 'red', target: { col: 1, row: 2 }, at: 20 },
      { type: 'special', player: 'blue', request: { target: { col: 1, row: 1 }, axis: 'col' }, at: 30 },
    ];
    expect(decodeClientMessage(JSON.stringify({ t: 'daily.submit', date: '2026-10-21', log })).ok).toBe(true);
    expect(decodeClientMessage(JSON.stringify({ t: 'daily.submit', date: '21/10/2026', log })).ok).toBe(false);
    expect(decodeClientMessage(JSON.stringify({ t: 'daily.submit', date: '2026-10-21', log: [{ type: 'hack', player: 'blue', at: 1 }] })).ok).toBe(false);
    expect(decodeClientMessage(JSON.stringify({ t: 'daily.submit', date: '2026-10-21', log: [{ ...log[0], player: 'green' }] })).ok).toBe(false);
  });

  it('mensagens com log podem passar do limite comum; as outras não', () => {
    const entry = { type: 'attack', player: 'blue', target: { col: 1, row: 1 }, at: 1 };
    const big = JSON.stringify({ t: 'daily.submit', date: '2026-10-21', log: Array.from({ length: 400 }, () => entry) });
    expect(big.length).toBeGreaterThan(MAX_CLIENT_MESSAGE_BYTES);
    expect(decodeClientMessage(big).ok).toBe(true);
  });

  it('duplas: criar sala, escolher lugar, emote para o time', () => {
    expect(decodeClientMessage('{"t":"room.create","clock":"padrao","mode":"full","format":"doubles"}').ok).toBe(true);
    expect(decodeClientMessage('{"t":"room.create","clock":"padrao","mode":"full","format":"trios"}').ok).toBe(false);
    expect(decodeClientMessage('{"t":"seat.choose","seat":"red-2"}').ok).toBe(true);
    expect(decodeClientMessage('{"t":"seat.choose","seat":"red-3"}').ok).toBe(false);
    expect(decodeClientMessage('{"t":"emote","kind":"emoji","emote":"fogo","to":"team"}').ok).toBe(true);
    expect(decodeClientMessage('{"t":"mute","muted":true,"who":"partner"}').ok).toBe(true);
  });

  it('campanha: forma do progresso', () => {
    const ok = { t: 'campaign.sync', progress: { version: 1, missions: { 'egito-1': { won: true, stars: 2, bestShots: 40, attempts: 3 } } } };
    expect(decodeClientMessage(JSON.stringify(ok)).ok).toBe(true);
    const bad = { t: 'campaign.sync', progress: { version: 1, missions: { 'egito-1': { won: true, stars: 4, bestShots: 40, attempts: 3 } } } };
    expect(decodeClientMessage(JSON.stringify(bad)).ok).toBe(false);
  });
});
