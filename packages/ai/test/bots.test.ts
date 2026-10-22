import { describe, expect, it } from 'vitest';
import { Match, PLAYERS, startAutoMatch, type PlayerView, type PresetId } from '@riverfront/core';
import {
  BOT_IDS,
  MemoryStorage,
  PROFILES,
  createBot,
  playBotTurn,
  runBotMatch,
  type BotAction,
  type BotLevel,
} from '../src/index.ts';

const LEVELS: BotLevel[] = [1, 2, 3, 4, 5];
const PRESETS: PresetId[] = ['classic', 'full'];

describe('profiles', () => {
  it('has five bots with names, personalities and a line per event', () => {
    expect(BOT_IDS).toHaveLength(5);
    const names = BOT_IDS.map((id) => PROFILES[id].name);
    expect(names).toEqual(['Cabo Pipoca', 'Sargento Rotina', 'Capitã Neblina', 'Major Xadrez', 'General Abismo']);
    for (const id of BOT_IDS) {
      const p = PROFILES[id];
      expect(p.personality.length).toBeGreaterThan(20);
      expect(Object.keys(p.taunts).sort()).toEqual(['onHit', 'onIdle', 'onLose', 'onLostPiece', 'onMiss', 'onWin']);
      for (const line of Object.values(p.taunts)) expect(line.length).toBeGreaterThan(5);
    }
  });

  it('createBot accepts a level or an id', () => {
    for (const level of LEVELS) expect(createBot(level, { seed: 1 }).profile.level).toBe(level);
    expect(createBot('abismo', { seed: 1 }).profile.name).toBe('General Abismo');
    expect(createBot('rotina', { seed: 1 }).taunt('onHit')).toBe(PROFILES.rotina.taunts.onHit);
    expect(() => createBot(9 as BotLevel, { seed: 1 })).toThrow();
  });
});

describe('every bot plays by the rules', () => {
  for (const preset of PRESETS) {
    for (const level of LEVELS) {
      it(`level ${level} finishes ${preset} matches without a single refused action`, () => {
        for (let game = 0; game < 3; game++) {
          const result = runBotMatch({
            seed: 100 + game,
            config: preset,
            bots: {
              blue: createBot(level, { seed: game, storage: new MemoryStorage() }),
              red: createBot(((level % 5) + 1) as BotLevel, { seed: game + 50, storage: new MemoryStorage() }),
            },
          });
          expect(result.rejected).toBe(0);
          expect(result.winner).not.toBeNull();
          expect(result.match.winReason).toBe('destroyed');
        }
      });
    }
  }

  it('layouts are always legal', () => {
    for (const level of LEVELS) {
      const bot = createBot(level, { seed: level });
      for (let seed = 0; seed < 25; seed++) {
        const match = new Match({ seed, config: seed % 2 ? 'classic' : 'full' });
        expect(match.setLayout('blue', bot.placeLayout(match.viewFor('blue'))).ok).toBe(true);
        expect(match.confirm('blue').ok).toBe(true);
      }
    }
  });
});

describe('determinism and secrecy', () => {
  it('the same seeds replay the same match, level 5 included', () => {
    const play = () =>
      runBotMatch({
        seed: 7,
        config: 'full',
        bots: { blue: createBot(5, { seed: 3 }), red: createBot(4, { seed: 4 }) },
      }).match.log;
    expect(play()).toEqual(play());
  });

  it('bots decide from plain data: a JSON copy of the view gives the same action', () => {
    for (const level of LEVELS) {
      const match = startAutoMatch({ seed: 9 + level });
      const live = createBot(level, { seed: 5 });
      const copy = createBot(level, { seed: 5 });
      for (let i = 0; i < 25 && match.phase === 'playing'; i++) {
        const player = match.turn;
        const view = match.viewFor(player);
        const a = live.decide(view);
        const b = copy.decide(JSON.parse(JSON.stringify(view)) as PlayerView);
        expect(b).toEqual(a);
        if (a.type === 'attack') match.attack(player, a.target);
        else if (a.type === 'special') match.special(player, a.request);
        else if (!match.useAbility(player, a.request).ok) match.attack(player, view.enemy.cells.find((c) => c.state === 'hidden')!);
      }
    }
  });

  it('a bot cannot tell two matches apart when only the hidden enemy layout differs', () => {
    for (const level of LEVELS) {
      const make = (redSeed: number) => {
        const m = new Match({ seed: 21 });
        m.autoPlace('blue', 1);
        m.autoPlace('red', redSeed);
        for (const p of PLAYERS) m.confirm(p);
        return m;
      };
      const a = make(500);
      const b = make(900);
      const botA = createBot(level, { seed: 2 });
      const botB = createBot(level, { seed: 2 });
      // Before anything is uncovered the decision can only depend on public data.
      expect(botB.decide(b.viewFor('blue'))).toEqual(botA.decide(a.viewFor('blue')));
    }
  });
});

describe('personalities', () => {
  function actionsOf(level: BotLevel, preset: PresetId, games = 4): BotAction[] {
    const seen: BotAction[] = [];
    for (let game = 0; game < games; game++) {
      const match = startAutoMatch({ seed: 40 + game, config: preset });
      const bot = createBot(level, { seed: game });
      const rival = createBot(3, { seed: game + 9 });
      for (let guard = 0; guard < 400 && match.phase === 'playing'; guard++) {
        if (match.turn === 'blue') playBotTurn(match, 'blue', bot, (a) => seen.push(a));
        else playBotTurn(match, 'red', rival);
      }
    }
    return seen;
  }
  const abilityIds = (actions: BotAction[]) => new Set(actions.flatMap((a) => (a.type === 'ability' ? [a.request.ability] : [])));

  it('Cabo Pipoca never uses abilities', () => {
    expect(abilityIds(actionsOf(1, 'full'))).toEqual(new Set());
  });

  it('Sargento Rotina only uses the radar', () => {
    expect(abilityIds(actionsOf(2, 'full'))).toEqual(new Set(['radar']));
  });

  it('Capitã Neblina uses spy and bomb', () => {
    const ids = abilityIds(actionsOf(3, 'full'));
    expect(ids.has('spy')).toBe(true);
    expect(ids.has('bomb')).toBe(true);
  });

  it('Major Xadrez and General Abismo use their kit', () => {
    const four = abilityIds(actionsOf(4, 'full'));
    expect(four.has('spy') && four.has('bomb')).toBe(true);
    const five = abilityIds(actionsOf(5, 'full'));
    expect(five.has('spy') && five.has('bomb')).toBe(true);
  });

  it('nobody uses abilities in the classic preset', () => {
    for (const level of LEVELS) expect(abilityIds(actionsOf(level, 'classic', 1))).toEqual(new Set());
  });

  it('Sargento Rotina turns the radar on as soon as it can', () => {
    const match = startAutoMatch({ seed: 3 });
    const action = createBot(2, { seed: 1 }).decide(match.viewFor('blue'));
    expect(action.type === 'ability' && action.request.ability).toBe('radar');
  });

  it('Cabo Pipoca probes around a hit about half of the time', () => {
    const match = startAutoMatch({ seed: 12, config: 'classic' });
    const armor = match.viewFor('red').own.pieces.find((p) => p.role === 'armor')!;
    match.attack('blue', armor.cells[0]!);
    const view = match.viewFor('blue');
    const hit = armor.cells[0]!;
    const near = (a: { col: number; row: number }) => Math.abs(a.col - hit.col) + Math.abs(a.row - hit.row) === 1;
    let probes = 0;
    const tries = 400;
    for (let i = 0; i < tries; i++) {
      const a = createBot(1, { seed: i }).decide(view);
      if (a.type === 'attack' && near(a.target)) probes++;
    }
    expect(probes / tries).toBeGreaterThan(0.4);
    expect(probes / tries).toBeLessThan(0.65);
  });

  it('density bots follow up a hit next to it', () => {
    for (const level of [3, 4, 5] as BotLevel[]) {
      const match = startAutoMatch({ seed: 12, config: 'classic' });
      const artillery = match.viewFor('red').own.pieces.find((p) => p.role === 'artillery')!;
      match.attack('blue', artillery.cells[1]!);
      const a = createBot(level, { seed: 1 }).decide(match.viewFor('blue'));
      const hit = artillery.cells[1]!;
      expect(a.type).toBe('attack');
      if (a.type === 'attack') expect(Math.abs(a.target.col - hit.col) + Math.abs(a.target.row - hit.row)).toBe(1);
    }
  });

  it('Major Xadrez shields a piece the enemy is chasing', () => {
    const match = startAutoMatch({ seed: 30, firstTurn: 'red' });
    const target = match.viewFor('blue').own.pieces.find((p) => p.role === 'artillery')!;
    match.attack('red', target.cells[0]!);
    while (match.turn === 'red') {
      const earth = match.viewFor('blue').own.cells.find((c) => c.terrain === 'earth' && c.role === null && !c.struck)!;
      match.attack('red', earth);
    }
    const a = createBot(4, { seed: 1 }).decide(match.viewFor('blue'));
    expect(a).toEqual({ type: 'ability', request: { ability: 'shield', pieceId: target.id } });
  });
});

describe('thinking budget', () => {
  it('level 5 stays well under 150 ms per decision on average', () => {
    const result = runBotMatch({
      seed: 77,
      config: 'full',
      bots: { blue: createBot(5, { seed: 1 }), red: createBot(5, { seed: 2 }) },
    });
    const avg = (result.thinkMs.blue + result.thinkMs.red) / (result.decisions.blue + result.decisions.red);
    expect(avg).toBeLessThan(150);
  });

  it('a smaller sample budget still plays a legal game', () => {
    const result = runBotMatch({
      seed: 78,
      config: 'classic',
      bots: { blue: createBot(5, { seed: 1, budget: { samples: 20 } }), red: createBot(5, { seed: 2, budget: { samples: 400, maxMs: 30 } }) },
    });
    expect(result.rejected).toBe(0);
    expect(result.winner).not.toBeNull();
  });
});

describe('learning bots', () => {
  it('Major Xadrez and General Abismo persist what they learn in the storage', () => {
    for (const level of [4, 5] as BotLevel[]) {
      const storage = new MemoryStorage();
      runBotMatch({ seed: 5, config: 'classic', bots: { blue: createBot(level, { seed: 1, storage }), red: createBot(1, { seed: 2 }) } });
      const keys = ['xadrez', 'abismo'].map((b) => `riverfront:${b}:habits:classic`);
      const stored = keys.map((k) => storage.getItem(k)).find((v) => v !== null);
      expect(stored).toBeTruthy();
      expect(JSON.parse(stored!).games).toBe(1);
    }
  });

  it('a fresh bot picks up the stored habits', () => {
    const storage = new MemoryStorage();
    for (let g = 0; g < 3; g++) {
      runBotMatch({ seed: g, config: 'classic', bots: { blue: createBot(5, { seed: g, storage }), red: createBot(1, { seed: g }) } });
    }
    expect(JSON.parse(storage.getItem('riverfront:abismo:habits:classic')!).games).toBe(3);
    expect(JSON.parse(storage.getItem('riverfront:abismo:order:classic')!).games).toBe(3);
  });
});

describe('chaves de aprendizado', () => {
  it('migra o que estava salvo com o prefixo antigo do projeto', async () => {
    const { readMigrated } = await import('../src/learning.ts');
    const storage = new MemoryStorage();
    storage.setItem('tower-destroyer:abismo:habits:classic', '{"games":2}');
    expect(readMigrated(storage, 'riverfront:abismo:habits:classic')).toBe('{"games":2}');
    expect(storage.getItem('riverfront:abismo:habits:classic')).toBe('{"games":2}');
    expect(readMigrated(storage, 'riverfront:xadrez:habits:classic')).toBeNull();
  });
});
