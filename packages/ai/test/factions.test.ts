import { describe, expect, it } from 'vitest';
import {
  FACTION_IDS,
  Match,
  PLAYERS,
  RAPID_CONFIG,
  sizedConfig,
  startAutoMatch,
  type FactionId,
  type MutatorId,
  type PresetId,
} from '@riverfront/core';
import {
  LEADERS,
  MemoryStorage,
  PriorBuilder,
  coach,
  createBot,
  factionMeta,
  playBotTurn,
  runBotMatch,
  tauntTier,
  trainedShotPrior,
  type BotAction,
  type BotLevel,
} from '../src/index.ts';

const LEVELS: BotLevel[] = [1, 2, 3, 4, 5];
const EVENTS = ['onHit', 'onMiss', 'onLostPiece', 'onWin', 'onLose', 'onIdle'] as const;

describe('faction commanders', () => {
  it('every faction has a leader with six lines per event', () => {
    expect(Object.keys(LEADERS).sort()).toEqual(FACTION_IDS.filter((id) => id !== 'neutra').sort());
    expect(LEADERS.vikings!.name).toBe('Hallvard Steinsson');
    for (const persona of Object.values(LEADERS)) {
      expect(persona!.name.length).toBeGreaterThan(3);
      for (const event of EVENTS) {
        expect(persona!.taunts[event]).toHaveLength(6);
        for (const line of persona!.taunts[event]) expect(line.length).toBeGreaterThan(5);
      }
      expect(Object.keys(persona!.dialogue).sort()).toEqual(['defeat', 'intro', 'special', 'victory']);
    }
  });

  it('a bot plays as a commander at any level; the tone follows the level', () => {
    for (const level of LEVELS) {
      const bot = createBot(level, { seed: 3, faction: 'egito' });
      expect(bot.profile.level).toBe(level);
      expect(bot.profile.name).toBe('Faraó do Nilo Amenkhet');
      expect(bot.profile.faction).toBe('egito');
      const [a, b] = tauntTier(level);
      const allowed = [LEADERS.egito!.taunts.onHit[a], LEADERS.egito!.taunts.onHit[b]];
      for (let i = 0; i < 6; i++) expect(allowed).toContain(bot.taunt('onHit'));
    }
    expect(tauntTier(1)).toEqual([0, 1]);
    expect(tauntTier(5)).toEqual([4, 5]);
  });

  it('the persona never changes the moves', () => {
    for (const level of LEVELS) {
      const match = startAutoMatch({ seed: 30 + level, factions: { blue: 'roma' } });
      const plain = createBot(level, { seed: 8 });
      const roman = createBot(level, { seed: 8, faction: 'roma' });
      roman.taunt('onIdle');
      expect(roman.decide(match.viewFor('blue'))).toEqual(plain.decide(match.viewFor('blue')));
    }
  });

  it('metadata for every faction, for the UI', () => {
    for (const id of FACTION_IDS) {
      const meta = factionMeta(id);
      expect(meta.id).toBe(id);
      expect(meta.leader.title.length).toBeGreaterThan(2);
      if (id !== 'neutra') expect(meta.special?.description.length).toBeGreaterThan(10);
    }
    expect(factionMeta('grecia').leader.hasPersona).toBe(true);
    expect(factionMeta('neutra').leader.hasPersona).toBe(false);
  });
});

function specialsUsed(level: BotLevel, faction: FactionId, games = 3): Set<string> {
  const used = new Set<string>();
  for (let g = 0; g < games; g++) {
    const match = startAutoMatch({ seed: 60 + g, factions: { blue: faction } });
    const bot = createBot(level, { seed: g, faction });
    const rival = createBot(3, { seed: g + 5 });
    for (let guard = 0; guard < 400 && match.phase === 'playing'; guard++) {
      if (match.turn === 'blue') {
        playBotTurn(match, 'blue', bot, (a: BotAction) => {
          if (a.type === 'special') used.add(match.factionOf('blue').specialShot!.kind);
        });
      } else playBotTurn(match, 'red', rival);
    }
  }
  return used;
}

describe('bots use the faction kit', () => {
  it('wave-1 special shots are fired from level 2 up, never by level 1', () => {
    for (const faction of ['egito', 'roma', 'grecia'] as const) {
      expect(specialsUsed(4, faction).size).toBe(1);
      expect(specialsUsed(1, faction, 1).size).toBe(0);
    }
    expect(specialsUsed(2, 'egito', 2).has('probe')).toBe(true);
  });

  it('no refused action with every faction, mutator and preset', () => {
    const presets: PresetId[] = ['full', 'classic', 'rapido', 'rapido-poderes'];
    const mutators: MutatorId[][] = [['mare'], ['neblina'], ['tiro-duplo'], ['mare', 'neblina', 'tiro-duplo']];
    const factions: FactionId[] = ['egito', 'roma', 'grecia', 'chineses', 'partos', 'hunos'];
    let n = 0;
    for (const level of LEVELS) {
      for (let g = 0; g < 4; g++) {
        const preset = presets[(g + level) % presets.length]!;
        const result = runBotMatch({
          seed: 900 + level * 10 + g,
          config: preset,
          bots: { blue: createBot(level, { seed: g, storage: new MemoryStorage() }), red: createBot(((level % 5) + 1) as BotLevel, { seed: g + 1 }) },
          factions: { blue: factions[n % factions.length]!, red: factions[(n + 2) % factions.length]! },
          mutators: mutators[g]!,
        });
        n++;
        expect(result.rejected).toBe(0);
        expect(result.match.winReason).toBe('destroyed');
      }
    }
  });

  it('from level 3 up, bots do not shoot twice at a miss the fog hid', () => {
    for (const level of [3, 4, 5] as BotLevel[]) {
      const result = runBotMatch({
        seed: 70 + level,
        config: 'full',
        bots: { blue: createBot(level, { seed: 1 }), red: createBot(level, { seed: 2 }) },
        mutators: ['neblina'],
      });
      // A second shot at a cell that already showed earth or rock (a shield-absorbed cell may be shot again).
      const misses = new Set<string>();
      let repeats = 0;
      // Shots are public, so one history has all of them.
      for (const h of result.match.viewFor('blue').history) {
        if (h.kind !== 'shot') continue;
        const key = `${h.by}:${h.report.target.col},${h.report.target.row}`;
        if (h.report.result === 'earth' || h.report.result === 'rock') {
          if (misses.has(key)) repeats++;
          misses.add(key);
        }
      }
      expect(repeats).toBe(0);
    }
  });

  it('bots never pick a submerged cell while dry cells are left', () => {
    for (const level of LEVELS) {
      const match = startAutoMatch({ seed: 40 + level, mutators: ['mare'] });
      const bots = { blue: createBot(level, { seed: 1 }), red: createBot(level, { seed: 2 }) };
      for (let guard = 0; guard < 300 && match.phase === 'playing'; guard++) {
        const p = match.turn;
        const view = match.viewFor(p);
        const action = bots[p].decide(view);
        if (action.type === 'attack' && view.mutators?.tide?.submerged) {
          const dry = view.enemy.cells.some((c) => c.row > 0 && (c.state === 'hidden' || c.state === 'spotted'));
          if (dry) expect(action.target.row).toBeGreaterThan(0);
        }
        playBotTurn(match, p, bots[p]);
      }
    }
  });

  it('a bot cannot tell two matches apart when only the hidden layout differs (factions and tide)', () => {
    for (const level of LEVELS) {
      const make = (redSeed: number) => {
        const m = new Match({ seed: 21, factions: { blue: 'egito', red: 'grecia' }, mutators: ['mare'] });
        m.autoPlace('blue', 1);
        m.autoPlace('red', redSeed);
        for (const p of PLAYERS) m.confirm(p);
        return m;
      };
      const a = createBot(level, { seed: 2, faction: 'egito' }).decide(make(500).viewFor('blue'));
      const b = createBot(level, { seed: 2, faction: 'egito' }).decide(make(900).viewFor('blue'));
      expect(b).toEqual(a);
    }
  });
});

describe('quick presets and other sizes', () => {
  it('every level plays the quick presets and a resized field', () => {
    for (const level of LEVELS) {
      for (const config of [RAPID_CONFIG, 'rapido-poderes' as const, sizedConfig('full', 18, 6)]) {
        const result = runBotMatch({
          seed: 5 + level,
          config,
          bots: { blue: createBot(level, { seed: 1 }), red: createBot(level, { seed: 2 }) },
          factions: { blue: 'grecia', red: 'roma' },
        });
        expect(result.rejected).toBe(0);
        expect(result.winner).not.toBeNull();
      }
    }
  });
});

describe('coach with factions and mutators', () => {
  it('warns about the tide and suggests the special shot', () => {
    const match = startAutoMatch({ seed: 3, factions: { blue: 'egito', red: 'grecia' }, mutators: ['mare'] });
    // Turn 3: the water rises in two turns.
    for (let i = 0; i < 2; i++) {
      const p = match.turn;
      const target = match.viewFor(p).enemy.cells.find((c) => c.row > 1 && c.state === 'hidden')!;
      match.attack(p, target);
      while (match.turn === p && match.phase === 'playing') {
        const t = match.viewFor(p).enemy.cells.find((c) => c.row > 1 && c.state === 'hidden')!;
        match.attack(p, t);
      }
    }
    const advice = coach(match.viewFor(match.turn));
    expect(advice.tips?.some((t) => t.includes('maré sobe'))).toBe(true);
    expect(advice.explanation).toContain('maré');
    if (match.turn === 'blue') expect(advice.tips?.some((t) => t.includes('Sonda'))).toBe(true);
    else expect(advice.tips?.some((t) => t.toLowerCase().includes('torre'))).toBe(true);
  });
});

describe('trained priors', () => {
  it('the builder turns finished matches into per-cell factors with mean near 1', () => {
    const builder = new PriorBuilder();
    for (let g = 0; g < 6; g++) {
      const result = runBotMatch({
        seed: g,
        config: 'rapido',
        bots: { blue: createBot(3, { seed: g }), red: createBot(3, { seed: g + 1 }) },
      });
      for (const p of PLAYERS) builder.add(result.match.viewFor(p));
    }
    const copy = new PriorBuilder();
    copy.merge(JSON.parse(JSON.stringify(builder.export())));
    const file = copy.build(1);
    expect(file).toEqual(builder.build(1));
    const shot = file.shot['rapido/neutra']!;
    expect(shot.games).toBe(12);
    expect(shot.values).toHaveLength(75);
    const search = file.search.rapido!.values;
    expect(search.reduce((a, b) => a + b, 0) / search.length).toBeCloseTo(1, 1);
    expect(trainedShotPrior(sizedConfig('full', 19, 6))).toBeNull();
  });

  it('a bot can play with the hand-made defaults (trained: false)', () => {
    const result = runBotMatch({
      seed: 4,
      config: 'full',
      bots: { blue: createBot(5, { seed: 1, trained: false }), red: createBot(4, { seed: 2, trained: false }) },
    });
    expect(result.rejected).toBe(0);
  });
});
