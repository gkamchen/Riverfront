import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@riverfront/protocol';
import type { TeamView } from '@riverfront/core';
import { isEvent, playToEnd, startedPair, TestClient, testServer } from './helpers.ts';

// Teste de carga leve: `npm run test:load`. Fica fora do `npm test` por demorar.
const ROOMS = Number(process.env.LOAD_ROOMS ?? 100);

describe('carga', () => {
  it(`${ROOMS} salas jogando ao mesmo tempo até o fim`, async () => {
    const server = await testServer({ accountsPerIpPerHour: 100_000, rate: { burst: 10_000, perSecond: 10_000 }, maxConnectionsPerIp: ROOMS * 2 + 10, maxConnections: ROOMS * 2 + 10 });
    const clients: TestClient[] = [];
    const started = performance.now();
    try {
      const pairs = await Promise.all(
        Array.from({ length: ROOMS }, async () => {
          const pair = await startedPair(server, { mode: 'classic' });
          clients.push(pair.a, pair.b);
          return pair;
        }),
      );
      const setupMs = performance.now() - started;
      expect(server.stats().matches).toBe(ROOMS);

      await Promise.all(pairs.map(({ a, b }) => playToEnd(a, b)));
      const totalMs = performance.now() - started;

      let messages = 0;
      let bytes = 0;
      for (const c of clients) {
        messages += c.raw.length;
        for (const r of c.raw) bytes += r.length;
      }
      for (const { a, b } of pairs) {
        const endA = a.received.find(isEvent('end')) as Extract<ServerMessage, { t: 'match.event' }> | undefined;
        expect(endA?.event.kind).toBe('end');
        expect(b.view?.phase).toBe('finished');
      }
      const mem = process.memoryUsage();
      console.log(
        `[carga] ${ROOMS} salas: preparo ${setupMs.toFixed(0)} ms, total ${(totalMs / 1000).toFixed(1)} s, ` +
          `${messages} mensagens, ${(bytes / 1024 / 1024).toFixed(1)} MiB, heap ${(mem.heapUsed / 1024 / 1024).toFixed(0)} MiB`,
      );
    } finally {
      for (const c of clients) c.ws.terminate();
      await server.close();
    }
  }, 300_000);
});

const DOUBLES = Number(process.env.LOAD_DOUBLES ?? 50);

describe('carga (duplas)', () => {
  it(`${DOUBLES} salas de duplas jogando até o fim`, async () => {
    const server = await testServer({ accountsPerIpPerHour: 100_000, rate: { burst: 10_000, perSecond: 10_000 }, maxConnectionsPerIp: DOUBLES * 4 + 10, maxConnections: DOUBLES * 4 + 10 });
    const clients: TestClient[] = [];
    const started = performance.now();
    const seats = ['blue-1', 'red-1', 'blue-2', 'red-2'] as const;
    const count = (c: TestClient) => c.received.filter((m) => m.t === 'match.event').length;
    try {
      const tables = await Promise.all(
        Array.from({ length: DOUBLES }, async () => {
          const ps: TestClient[] = [];
          for (let i = 0; i < 4; i++) ps.push(await TestClient.connect(server));
          clients.push(...ps);
          const [a] = ps as [TestClient];
          const room = a.waitFor<Extract<ServerMessage, { t: 'room' }>>((m) => m.t === 'room');
          await a.ok({ t: 'room.create', clock: 'unlimited', mode: 'classic', format: 'doubles' });
          const code = (await room).room.code;
          for (const p of ps.slice(1)) await p.ok({ t: 'room.join', code });
          for (const p of ps) await p.ok({ t: 'ready', ready: true });
          for (const p of ps) await p.seen((m) => m.t === 'match.state');
          const go = Promise.all(ps.map((p) => p.waitFor(isEvent('start'))));
          for (const p of ps) await p.ok({ t: 'placement.auto' });
          for (const p of ps) await p.ok({ t: 'placement.submit', placements: [], confirm: true });
          await go;
          return ps;
        }),
      );
      const setupMs = performance.now() - started;
      await Promise.all(
        tables.map(async (ps) => {
          const bySeat = new Map(seats.map((s, i) => [s, ps[i] as TestClient]));
          for (let i = 0; i < 4_000; i++) {
            const v = (ps[0] as TestClient).view as TeamView;
            if (v.phase !== 'playing') break;
            const shooter = bySeat.get(v.doubles.seatOnTurn as (typeof seats)[number]) as TestClient;
            const target = (shooter.view as TeamView).enemy.cells.find((c) => c.state === 'hidden' || c.state === 'spotted');
            if (!target) throw new Error('sem alvo');
            const before = ps.map(count);
            await shooter.ok({ t: 'attack', target: { col: target.col, row: target.row } });
            for (const [k, p] of ps.entries()) if (count(p) <= (before[k] as number)) await p.waitFor((m) => m.t === 'match.event');
          }
          expect(((ps[3] as TestClient).view as TeamView).phase).toBe('finished');
        }),
      );
      let messages = 0;
      let bytes = 0;
      for (const c of clients) {
        messages += c.raw.length;
        for (const r of c.raw) bytes += r.length;
      }
      console.log(
        `[carga duplas] ${DOUBLES} salas (${DOUBLES * 4} jogadores): preparo ${setupMs.toFixed(0)} ms, total ${((performance.now() - started) / 1000).toFixed(1)} s, ` +
          `${messages} mensagens, ${(bytes / 1024 / 1024).toFixed(1)} MiB`,
      );
    } finally {
      for (const c of clients) c.ws.terminate();
      await server.close();
    }
  }, 300_000);
});
