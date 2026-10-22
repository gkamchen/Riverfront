import { describe, expect, it } from 'vitest';
import type { RoomInfo } from '@riverfront/protocol';
import { MemoryKeyValueStore, OnlineSession, ProfileStorage } from '../src/net';
import type { DailyChallenge, TeamView } from '@riverfront/core';
import { LocalHost, RemoteHost, type HostUpdate } from '../src/app/matchHost';
import { modeOfPreset, type MatchSetup } from '../src/app/modes';
import { PlacementEditor } from '../src/app/placement';

/**
 * Two clients against a running server (skipped unless RIVERFRONT_SERVER is set):
 *   RIVERFRONT_SERVER=ws://127.0.0.1:8787/ws npm test -w @riverfront/client
 */
const url = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.RIVERFRONT_SERVER;

function waitFor<T>(check: () => T | null | undefined, ms = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const value = check();
      if (value) resolve(value);
      else if (Date.now() - started > ms) reject(new Error('timeout'));
      else setTimeout(tick, 30);
    };
    tick();
  });
}

describe.skipIf(!url)('partida online pelo RemoteHost', () => {
  it('joga uma partida rápida até o fim e os dois lados veem o mesmo resultado', async () => {
    const make = () => new OnlineSession(url!, { storage: new ProfileStorage(new MemoryKeyValueStore()) });
    const a = make();
    const b = make();
    const rooms: Record<string, RoomInfo | null> = { a: null, b: null };
    a.on('room', (r) => (rooms.a = r));
    b.on('room', (r) => (rooms.b = r));
    await Promise.all([a.connect(), b.connect()]);
    await waitFor(() => a.profile && b.profile);

    expect((await a.createRoom('unlimited', 'rapido')).ok).toBe(true);
    const code = (await waitFor(() => rooms.a)).code;
    expect((await b.joinRoom(code)).ok).toBe(true);
    await a.setReady(true);
    await b.setReady(true);
    await waitFor(() => (rooms.a?.state === 'placing' ? rooms.a : null));

    const hosts = [new RemoteHost(a, a.host, rooms.a!.you), new RemoteHost(b, b.host, rooms.b!.you)];
    const updates: HostUpdate[][] = [[], []];
    hosts.forEach((h, i) => h.onUpdate((u) => updates[i]!.push(u)));
    for (const h of hosts) {
      const view = await waitFor(() => h.view());
      expect(view.config.cols).toBe(15);
      const editor = new PlacementEditor(view);
      editor.auto(view.config.cols * 31 + (h.seat === 'blue' ? 1 : 2));
      expect((await h.submitLayout(editor.placements(), true)).ok).toBe(true);
    }
    await waitFor(() => hosts.every((h) => h.view()?.phase === 'playing'));

    for (let guard = 0; guard < 3000; guard++) {
      const view = hosts[0]!.view()!;
      if (view.phase !== 'playing') break;
      const host = hosts.find((h) => h.view()!.turn === h.seat && h.view()!.phase === 'playing');
      if (!host) {
        await new Promise((r) => setTimeout(r, 30));
        continue;
      }
      const own = host.view()!;
      const cell = own.enemy.cells.find((c) => c.state === 'hidden' && !(own.mutators?.tide?.submerged && c.row === 0));
      if (!cell) break;
      const before = own.history.length;
      // The server rate-limits bursts; humans never get close, a test loop does.
      await new Promise((r) => setTimeout(r, 160));
      let result = await host.attack({ col: cell.col, row: cell.row });
      for (let retry = 0; retry < 10 && !result.ok && result.error === 'rate-limited'; retry++) {
        await new Promise((r) => setTimeout(r, 600));
        result = await host.attack({ col: cell.col, row: cell.row });
      }
      expect(result).toEqual({ ok: true });
      await waitFor(() => (host.view()!.history.length > before || host.view()!.phase !== 'playing' ? true : null));
    }
    await waitFor(() => hosts.every((h) => h.view()?.phase === 'finished'));
    const [va, vb] = hosts.map((h) => h.view()!);
    expect(va!.winner).toBe(vb!.winner);
    expect(va!.enemy.layout).not.toBeNull();
    expect(updates[0]!.some((u) => u.kind === 'event' && u.event?.kind === 'shot')).toBe(true);
    // Each side counts the other's shots the same way.
    expect(va!.history.length).toBe(vb!.history.length);
    a.dispose();
    b.dispose();
  }, 120_000);
});

describe.skipIf(!url)('duplas online, desafio diário e campanha pela camada do app', () => {
  const make = (name: string) => new OnlineSession(url!, { storage: new ProfileStorage(new MemoryKeyValueStore()), name });
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('quatro lugares posicionam as próprias peças e jogam as duplas até o fim', async () => {
    const s = ['Ana', 'Bia', 'Caio', 'Davi'].map(make);
    for (const x of s) await x.connect();
    const [a] = s as [OnlineSession];
    let code = '';
    a.on('room', (r) => (code = r.code));
    expect((await a.createRoom('unlimited', 'rapido', [], undefined, 'doubles')).ok).toBe(true);
    await waitFor(() => code);
    for (const x of s.slice(1)) expect((await x.joinRoom(code)).ok).toBe(true);
    for (const x of s) await x.setReady(true);
    const hosts = s.map((x) => new RemoteHost(x, x.host, 'blue'));
    await waitFor(() => hosts.every((h) => h.view()?.phase === 'placing' && (h.view() as TeamView).doubles));
    // Seat 1 first, so seat 2 places around the partner (pieces of the partner stay locked).
    const second = (h: RemoteHost) => Number((h.remote.seatId ?? '').endsWith('2'));
    const order = [...hosts].sort((x, y) => second(x) - second(y));
    for (const h of order) {
      const view = (await waitFor(() => h.view())) as TeamView;
      const owned = new Set(Object.entries(view.doubles.pieceOwners).filter(([, seat]) => seat === view.doubles.seat).map(([id]) => id));
      const editor = new PlacementEditor(view, owned);
      editor.auto(owned.size * 7 + view.doubles.seat.length);
      expect(editor.issues()).toEqual([]);
      const mine = editor.placements().filter((p) => owned.has(p.pieceId));
      expect((await h.submitLayout(mine, true)).ok).toBe(true);
      await pause(150);
    }
    await waitFor(() => hosts.every((h) => h.view()?.phase === 'playing'), 15_000);
    for (let guard = 0; guard < 4000; guard++) {
      if (hosts[0]!.view()!.phase !== 'playing') break;
      const h = hosts.find((x) => (x.view() as TeamView).doubles.myTurn);
      if (!h) {
        await pause(30);
        continue;
      }
      const v = h.view()!;
      const cell = v.enemy.cells.find((c) => c.state === 'hidden' && !(v.mutators?.tide?.submerged && c.row === 0));
      if (!cell) break;
      const before = v.history.length;
      await pause(160);
      let r = await h.attack({ col: cell.col, row: cell.row });
      for (let k = 0; k < 10 && !r.ok && r.error === 'rate-limited'; k++) {
        await pause(600);
        r = await h.attack({ col: cell.col, row: cell.row });
      }
      expect(r).toEqual({ ok: true });
      await waitFor(() => (h.view()!.history.length > before || h.view()!.phase !== 'playing' ? true : null));
    }
    await waitFor(() => hosts.every((h) => h.view()?.phase === 'finished'), 15_000);
    expect(new Set(hosts.map((h) => h.view()!.winner)).size).toBe(1);
    for (const x of s) x.dispose();
  }, 180_000);

  it('um desafio diário jogado localmente é aceito pelo replay do servidor', async () => {
    const x = make('Elis');
    await x.connect();
    let challenge: DailyChallenge | null = null;
    x.on('daily', (msg) => (challenge = msg.challenge));
    await x.getDaily();
    const c = (await waitFor(() => challenge)) as DailyChallenge;
    const setup: MatchSetup = { play: 'daily', mode: modeOfPreset(c.preset), clock: c.clock, level: c.botLevel, faction: c.playerFaction, botFaction: c.opponentFaction, mutators: c.mutators, seed: c.seed, daily: c.id };
    const ai = await import('@riverfront/ai');
    const host = new LocalHost(setup, ai.createBot(c.botLevel, { seed: c.seed ^ 0x5bd1e995, storage: new ai.MemoryStorage() }));
    host.placeBot();
    const editor = new PlacementEditor(host.view());
    editor.auto(3);
    await host.submitLayout(editor.placements(), true);
    for (let guard = 0; guard < 5000 && host.view().phase === 'playing'; guard++) {
      host.advance(400);
      const v = host.view();
      if (v.turn === 'blue') {
        const cell = v.enemy.cells.find((k) => k.state === 'hidden' && !(v.mutators?.tide?.submerged && k.row === 0));
        if (cell) await host.attack({ col: cell.col, row: cell.row });
      } else host.botStep();
    }
    expect(host.view().phase).toBe('finished');
    let rank: number | null | undefined;
    x.on('dailyResult', (msg) => (rank = msg.rank));
    const sent = await x.submitDaily(c.id, host.match.log);
    expect(sent).toEqual({ ok: true });
    await waitFor(() => (rank !== undefined ? true : null));
    x.dispose();
  }, 60_000);
});