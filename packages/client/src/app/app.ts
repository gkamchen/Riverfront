import {
  CAMPAIGN,
  addDailyResult,
  campaignMission,
  dailyChallenge,
  dailyRank,
  dailyResultFromMatch,
  dailyScore,
  emptyDailyBoard,
  missionStatus,
  parseDailyBoard,
  partnerOf,
  seatsOf,
  teamOf,
  type CampaignMission,
  type DailyBoard,
  type DailyChallenge,
  type DailyEntry,
  type FactionId,
  type PlayerId,
  type SeatId,
} from '@riverfront/core';
import type { Bot, BotStorage } from '@riverfront/ai';
import { colourById, type RoomInfo, type EmojiId, type TauntId } from '@riverfront/protocol';
import { Group, Raycaster, type Vector2 } from 'three';
import { Tweens } from '../anim/tweens';
import { SoundBoard } from '../audio/sfx';
import { Board } from '../board/board';
import { COLS } from '../board/layout';
import { CameraRig, type ViewPreset } from '../camera/cameraRig';
import { EmojiFloaters } from '../effects/emojis';
import { EffectsDirector } from '../effects/fx';
import { Projectile } from '../effects/projectile';
import { BoardOverlay } from '../hud/boardOverlay';
import { closePopover, confirmDialog, modalOpen, openModal, popoverOpen } from '../hud/dialogs';
import { h } from '../hud/dom';
import { EndScreen } from '../hud/endScreen';
import { openHelp } from '../hud/help';
import { Hud } from '../hud/hud';
import { factionName, setLocale, t } from '../hud/i18n';
import { viewOffsetFor } from '../hud/layout';
import { MainMenu } from '../hud/menu';
import { openSettings } from '../hud/settingsPanel';
import { openSocial } from '../hud/social';
import { Tips } from '../hud/tips';
import { createMaterialLibrary } from '../materials/library';
import { PALETTES } from '../materials/palettes';
import { defaultServerUrl, roomCodeFromLocation, SERVER_QUERY_KEY } from '../net/address';
import { CampaignStore, ProfileStorage } from '../net/storage';
import type { OnlinePanel, OnlineSession, RemoteMatchHost } from '../net';
import type { CampaignData } from '../hud/campaignScreen';
import type { DailyData } from '../hud/dailyScreen';
import { aiModule, loadAi, type AiModule } from './aiLoader';
import { FpsProbe, QUALITY_PRESETS, type QualityTier } from '../scene/quality';
import { Stage } from '../scene/stage';
import { ThemeDirector } from '../scene/themeDirector';
import { flagTime } from '../units/flag';
import { onReducedMotionChange, prefersReducedMotion } from '../util/motion';
import { applyTeamColours, botColour, dressMatch, dressMenu, factionChoices, isPlayable, isThemeSetting, loadFactionArt, portraitUrl, type ThemeSetting } from './factionArt';
import { GameController, type EndSummary, type MatchContext } from './game';
import { LocalHost, LocalTeamHost, RemoteHost } from './matchHost';
import { modeOfPreset, nextLevel, quickSetup, trainingSetup, type BotLevelId, type MatchSetup } from './modes';
import { attachPointer } from './pointer';
import { loadSettings, saveSettings, type Settings } from './settings';

const VIEWS: readonly ViewPreset[] = ['default', 'top', 'side'];
const CLIENT_VERSION = '0.2.0';

const DAILY_KEY = 'riverfront.daily.board';

type DailyServer = { readonly challenge: DailyChallenge; readonly board: readonly DailyEntry[]; readonly rank: number | null };

function botStorage(ai: AiModule): BotStorage {
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {
    // blocked storage: bots just won't remember habits
  }
  return new ai.MemoryStorage();
}

/** Team of a room seat ('blue', 'red' or a doubles seat such as 'blue-2'). */
function seatTeam(seat: string): PlayerId {
  return seat.startsWith('red') ? 'red' : 'blue';
}

/** "Nome#1234" from the last online session on this device, if any. */
function storedTag(): string | null {
  const profile = new ProfileStorage().profile;
  return profile ? `${profile.name}#${profile.tag}` : null;
}

function coarsePointer(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
}

/** Wires the scene, the HUD, the menus and the game controller, and runs the loop. */
export class App {
  readonly #host: HTMLElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #stage: Stage;
  readonly #rig: CameraRig;
  readonly #board: Board;
  readonly #fx: EffectsDirector;
  readonly #emojis: EmojiFloaters;
  readonly #tweens = new Tweens();
  readonly #sound = new SoundBoard();
  readonly #themes: ThemeDirector;
  readonly #overlay: BoardOverlay;
  readonly #hud: Hud;
  readonly #menu: MainMenu;
  readonly #end: EndScreen;
  readonly #tips: Tips;
  readonly #game: GameController;
  readonly #raycaster = new Raycaster();
  readonly #settings: Settings = loadSettings();
  readonly #campaign = new CampaignStore();
  #dailyServer: DailyServer | null = null;
  #systemReduced = prefersReducedMotion();
  #time = 0;
  #lastFrame = performance.now();
  #probe: FpsProbe | null = null;
  #tier: QualityTier = 'high';
  #fps = 60;
  #panel: OnlinePanel | null = null;
  #panelLoading = false;
  /** Online doubles: emotes go to the partner only. */
  #teamOnly = false;
  #mutedPartner = false;
  #session: OnlineSession | null = null;
  #sessionOff: (() => void)[] = [];
  #room: RoomInfo | null = null;
  #onlineMatch = 0;
  #opponentAway: { since: number; graceMs: number | null } | null = null;
  #lastSetup: MatchSetup | null = null;
  #layoutKey = '';
  #soundUnlocked = false;

  constructor(host: HTMLElement, canvas: HTMLCanvasElement) {
    this.#host = host;
    this.#canvas = canvas;
    setLocale(this.#settings.locale);
    document.documentElement.lang = this.#settings.locale === 'en' ? 'en' : 'pt-BR';

    this.#rig = new CameraRig(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.#stage = new Stage(canvas, this.#rig.camera);
    const materials = createMaterialLibrary();
    this.#board = new Board(materials, PALETTES[0]!, () => this.#reduced);
    this.#fx = new EffectsDirector(materials, (strength) => this.#rig.shake(strength));
    this.#board.attachEffects(this.#fx);
    this.#fx.attachWater(this.#board.lake);
    this.#board.wildlife.setSoundHandler((name) => this.#sound.play(name));
    this.#themes = new ThemeDirector({ stage: this.#stage, board: this.#board, sound: this.#sound });

    const dynamic = new Group();
    dynamic.name = 'dynamic';
    this.#emojis = new EmojiFloaters(dynamic);
    const projectile = new Projectile(dynamic, this.#fx);
    this.#stage.scene.add(this.#board.group, this.#fx.group, dynamic);

    this.#overlay = new BoardOverlay(host);
    this.#hud = new Hud(host, {
      openSettings: (anchor) => this.#openSettings(anchor),
      togglePause: () => this.#game.setPaused(!this.#game.flow.paused),
      goHome: () => void this.#leaveMatch(),
      showHelp: () => this.#showHelp(),
      setView: (preset) => this.#setView(preset),
      rotateView: () => this.#rig.rotate180(),
      aimMode: () => this.#hud.toast(t(this.#game.toggleAimMode() ? 'view.aimOn' : 'view.aimOff'), 'neutral', 1.6),
      restart: () => void this.#restart(),
      surrender: () => void this.#surrender(),
      pickPiece: (slot) => this.#game.pickPiece(slot),
      placeRotate: () => this.#game.placeRotate(),
      placeAuto: () => this.#game.placeAuto(),
      placeClear: () => this.#game.placeClear(),
      placeConfirm: () => void this.#game.placeConfirm(),
      selectAbility: (id) => this.#game.selectAbility(id),
      selectSpecial: () => this.#game.selectSpecial(),
      toggleAxis: () => this.#game.toggleAxis(),
      cancelTarget: () => this.#game.cancelTarget(),
      fire: () => this.#game.fire(),
      toggleHeat: () => this.#update({ heatMap: !this.#settings.heatMap }),
      openSocial: (anchor) => this.#openSocial(anchor),
      toggleMute: () => void this.#toggleMute(),
    });
    this.#end = new EndScreen(host);
    this.#tips = new Tips(host, this.#settings.tipsSeen, (seen) => this.#update({ tipsSeen: seen }));

    this.#game = new GameController(
      { board: this.#board, fx: this.#fx, projectile, emojis: this.#emojis, tweens: this.#tweens, sound: this.#sound, hud: this.#hud, camera: this.#rig },
      {
        onEnd: (summary) => this.#onEnd(summary),
        onPhase: (phase) => this.#onPhase(phase),
        reducedMotion: () => this.#reduced,
        confirmShots: () => this.#settings.confirmShots === 'always' || (this.#settings.confirmShots === 'auto' && coarsePointer()),
        layout: () => this.#hud.layout,
        // Lava themes darken rocks and markers; the ✓ ✗ ◆ glyphs keep results readable there too.
        glyphs: () => this.#settings.colorblind || this.#themes.theme.water.mode === 'lava',
        // Smaller fields do not line up with the letters engraved on the 25-column frame.
        coordinates: () => this.#settings.coordinates === 'overlay' || (this.#settings.coordinates === 'engraved' && this.#smallField),
        heatMap: () => this.#settings.heatMap,
        portrait: (expression) => {
          const faction = this.#game.context?.setup?.botFaction;
          return faction && faction !== 'neutra' ? portraitUrl(faction, expression, 96) : null;
        },
      },
    );

    this.#menu = new MainMenu(
      host,
      {
        quickPlay: () => void this.#startLocal(quickSetup(this.#seed(), this.#settings.lastSetup ?? undefined), true),
        training: () => void this.#startLocal(trainingSetup(this.#seed(), this.#ownFaction()), false),
        startBot: (setup) => void this.#startLocal({ ...setup, play: 'bot', seed: this.#seed() }, false),
        startDoubles: (setup) => void this.#startLocal({ ...setup, play: 'doubles', seed: this.#seed() }, false),
        playDaily: () => this.#playDaily(),
        playMission: (mission) => this.#playMission(mission),
        openOnline: (container) => void this.#openOnline(container),
        closeOnline: () => this.#closeOnline(),
        challengeFriend: () => this.#challengeFriend(),
        openSettings: (anchor) => this.#openSettings(anchor),
        showHelp: () => this.#showHelp(),
        saveProfile: (profile) => void this.#saveProfile(profile),
      },
      {
        profile: () => ({
          nickname: this.#settings.nickname,
          tag: this.#session?.displayTag ?? storedTag(),
          colour: this.#settings.colour,
          faction: this.#settings.faction,
        }),
        factions: () => factionChoices(),
        portrait: (id, size) => portraitUrl(id, 'neutral', size),
        artReady: () => loadFactionArt(),
        lastSetup: () => this.#settings.lastSetup,
        loadAi: () => loadAi(),
        daily: () => this.#dailyData(),
        campaign: () => this.#campaignData(),
      },
    );

    this.#applyAll();
    this.#bindInput();
    window.addEventListener('resize', () => this.#resize());
    window.visualViewport?.addEventListener('resize', () => this.#resize());
    onReducedMotionChange((reduced) => {
      this.#systemReduced = reduced;
      this.#applyMotion();
    });
    document.addEventListener('visibilitychange', () => {
      // Local matches stop when the tab is hidden; online ones keep running on the server.
      if (document.hidden && this.#game.canPause) this.#game.setPaused(true);
    });
  }

  /** Handles for poking at the game from the dev console. */
  get debug() {
    return {
      fx: this.#fx,
      rig: this.#rig,
      board: this.#board,
      game: this.#game,
      stage: this.#stage,
      hud: this.#hud,
      tweens: this.#tweens,
      themes: this.#themes,
      settings: this.#settings,
      fps: () => Math.round(this.#fps),
      tier: () => this.#tier,
    };
  }

  start(): void {
    this.#goMenu();
    this.#resize();
    this.#stage.renderer.setAnimationLoop(() => this.#frame());
    // Some embedded views stop animation frames while the page still counts as
    // visible; keep the match moving (at a low rate) until frames come back.
    window.setInterval(() => {
      if (!document.hidden && performance.now() - this.#lastFrame > 500) this.#frame(0.25);
    }, 250);
    if (!this.#settings.helpSeen) {
      this.#update({ helpSeen: true });
      this.#showHelp();
    }
    // Invite links, the desktop app and pages served by the game server open the online panel.
    const params = new URLSearchParams(location.search);
    if (roomCodeFromLocation() !== null || params.has(SERVER_QUERY_KEY) || defaultServerUrl() !== null) this.#menu.go('online');
  }

  // ------------------------------------------------------------ loop

  #frame(maxDt = 0.05): void {
    const now = performance.now();
    const raw = Math.min(maxDt, (now - this.#lastFrame) / 1000);
    this.#lastFrame = now;
    const dt = this.#fx.warp(raw);
    this.#time += dt;
    this.#fps += (1 / Math.max(raw, 1e-3) - this.#fps) * 0.05;

    flagTime.value = this.#reduced ? 0 : this.#time;
    this.#tweens.update(dt);
    this.#rig.update(raw);
    this.#board.update(dt, this.#time, this.#reduced);
    this.#fx.update(dt);
    this.#emojis.update(dt);
    this.#game.update(raw);
    this.#updateOnlineBanners();
    this.#stage.setGloom(this.#fx.rain.level);
    this.#stage.render(dt);
    this.#overlay.draw(this.#rig.camera, this.#game.overlay, raw, this.#reduced);
    this.#checkLayout();
    this.#sampleFps(raw);
  }

  #sampleFps(raw: number): void {
    const probe = this.#probe;
    if (!probe) return;
    const report = probe.sample(raw);
    if (!report) return;
    this.#probe = null;
    if (this.#settings.quality !== 'auto') return;
    if (report.recommendation !== this.#tier) {
      this.#applyQuality(report.recommendation);
      if (report.recommendation === 'low') this.#hud.toast(t('quality.autoLow'), 'neutral');
    }
    this.#update({ autoTier: report.recommendation });
  }

  /** The HUD grid may change size (fonts, panels); keep the camera framed to it. */
  #checkLayout(): void {
    const rect = this.#hud.stageRect();
    const key = `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}:${this.#canvas.clientWidth}:${this.#canvas.clientHeight}`;
    if (key !== this.#layoutKey) this.#resize();
  }

  // ------------------------------------------------------------ settings

  get #reduced(): boolean {
    const motion = this.#settings.motion;
    return motion === 'reduced' || (motion === 'system' && this.#systemReduced);
  }

  #update(patch: Partial<Settings>): void {
    const before = { ...this.#settings };
    Object.assign(this.#settings, patch);
    saveSettings(this.#settings);
    if ('locale' in patch && patch.locale !== before.locale) this.#applyLocale();
    if ('quality' in patch) this.#applyQuality(this.#initialTier(), patch.quality === 'auto');
    if ('muted' in patch || 'volume' in patch) this.#applySound();
    if ('colorblind' in patch) this.#applyColours();
    if ('coordinates' in patch) this.#applyCoordinates();
    if ('motion' in patch) this.#applyMotion();
    if ('theme' in patch) this.#applyTheme();
    if ('heatMap' in patch) this.#hud.setHeatAvailable(this.#game.context?.play === 'training', this.#settings.heatMap);
  }

  #applyAll(): void {
    this.#applyQuality(this.#initialTier(), this.#settings.quality === 'auto');
    this.#applySound();
    this.#applyCoordinates();
    this.#applyMotion();
    document.documentElement.dataset.pointer = coarsePointer() ? 'coarse' : 'fine';
  }

  #initialTier(): QualityTier {
    const q = this.#settings.quality;
    if (q !== 'auto') return q;
    return this.#settings.autoTier ?? (coarsePointer() ? 'low' : 'high');
  }

  #applyQuality(tier: QualityTier, probe = false): void {
    this.#tier = tier;
    this.#stage.setQuality(tier);
    this.#board.setQuality(QUALITY_PRESETS[tier].wildlife);
    document.documentElement.dataset.quality = tier;
    this.#applyDensity();
    this.#resize();
    if (probe && this.#settings.quality === 'auto') this.#probe = new FpsProbe(3, 40);
  }

  #applyDensity(): void {
    this.#fx.setDensity(QUALITY_PRESETS[this.#tier].particles * (this.#reduced ? 0.5 : 1));
  }

  #applySound(): void {
    this.#sound.setVolume(this.#settings.volume);
    // Browsers only start audio after a gesture; until then it stays silent anyway.
    if (this.#soundUnlocked) this.#sound.setMuted(this.#settings.muted);
  }

  #applyMotion(): void {
    const reduced = this.#reduced;
    // Reduced motion: everything plays faster (shorter tweens), no shake, no slow-mo.
    this.#tweens.setTimeScale(reduced ? 0.45 : 1);
    this.#rig.setReducedMotion(reduced);
    this.#fx.autoHitstop = !reduced;
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
    this.#applyDensity();
  }

  get #smallField(): boolean {
    const config = this.#game?.view?.config;
    return !!config && (config.cols < COLS || config.rows < 7);
  }

  #applyCoordinates(): void {
    const mode = this.#settings.coordinates;
    this.#board.setCoordinateMode(mode === 'engraved' && !this.#smallField ? 'engraved' : 'off');
  }

  #applyColours(): void {
    const ctx = this.#game.context;
    if (!ctx) return;
    this.#paintTeams(ctx.host.seat, ctx.teams.own.colour, ctx.teams.enemy.colour);
  }

  #applyTheme(): void {
    const ctx = this.#game.context;
    const theme = this.#themeSetting();
    if (!ctx) dressMenu(this.#themes, theme, this.#settings.faction);
    else this.#hud.toast(t('settings.themeNext'), 'neutral');
  }

  #themeSetting(): ThemeSetting {
    return isThemeSetting(this.#settings.theme) ? this.#settings.theme : 'faccao';
  }

  #applyLocale(): void {
    setLocale(this.#settings.locale);
    document.documentElement.lang = this.#settings.locale === 'en' ? 'en' : 'pt-BR';
    this.#hud.relabel();
    this.#menu.relabel();
    closePopover();
  }

  // ------------------------------------------------------------ menus

  #goMenu(screen: 'home' | 'daily' | 'campaign' = 'home'): void {
    this.#game.stop();
    this.#end.close();
    this.#tips.dismiss();
    this.#board.reset();
    this.#hud.setPhase('menu');
    this.#applyCoordinates();
    this.#menu.show(screen);
    dressMenu(this.#themes, this.#themeSetting(), this.#settings.faction);
    this.#rig.lookAtZ(null);
    this.#rig.setZoom(1.15);
    this.#rig.setPreset('default');
    this.#resize();
  }

  async #leaveMatch(): Promise<void> {
    const ctx = this.#game.context;
    if (ctx && this.#game.flow.phase !== 'ended') {
      const ok = await confirmDialog(this.#host, t('confirm.leaveTitle'), t(ctx.host.online ? 'confirm.leaveOnline' : 'confirm.leave'), 'confirm.leaveYes', { danger: true });
      if (!ok) return;
      if (ctx.host.online) await ctx.host.surrender();
    }
    if (ctx?.host.online) void this.#session?.leaveRoom();
    ctx?.host.dispose();
    this.#goMenu();
  }

  async #restart(): Promise<void> {
    const ctx = this.#game.context;
    if (!ctx || ctx.host.online || !ctx.setup) return;
    const ok = await confirmDialog(this.#host, t('confirm.restartTitle'), t('confirm.restart'), 'confirm.restartYes', { hold: true });
    if (ok) this.#startLocal({ ...ctx.setup, seed: this.#seed() }, ctx.autoLayout);
  }

  async #surrender(): Promise<void> {
    const ok = await confirmDialog(this.#host, t('confirm.surrenderTitle'), t('confirm.surrender'), 'confirm.surrenderYes', { danger: true, hold: true });
    if (ok) await this.#game.surrender();
  }

  #openSettings(anchor: HTMLElement): void {
    openSettings(anchor, this.#settings, (patch) => {
      const reopen = 'locale' in patch;
      this.#update(patch);
      if (reopen) openSettings(anchor, this.#settings, (p) => this.#update(p));
    });
    const surrender = this.#game.context && this.#game.flow.phase !== 'ended' ? this.#matchActions() : null;
    if (surrender) document.querySelector('.settings-pop .settings')?.append(surrender);
  }

  /** Restart / surrender live in the settings popover during a match (both ask first). */
  #matchActions(): HTMLElement {
    const ctx = this.#game.context!;
    return h(
      'section',
      { class: 'match-actions' },
      h('h3', { i18n: 'settings.match' }),
      ctx.host.online ? null : h('button', { type: 'button', class: 'secondary', i18n: 'hud.restart', onclick: () => (closePopover(), void this.#restart()) }),
      h('button', { type: 'button', class: 'secondary danger', i18n: 'hud.surrender', onclick: () => (closePopover(), void this.#surrender()) }),
    );
  }

  #showHelp(): void {
    if (modalOpen()) return;
    const wasPaused = this.#game.flow.paused;
    if (this.#game.canPause) this.#game.setPaused(true);
    const handle = openHelp(this.#host);
    handle.root.addEventListener('close', () => {
      if (!wasPaused && this.#game.canPause) this.#game.setPaused(false);
    });
  }

  async #saveProfile(profile: { nickname: string; colour: string; faction: FactionId }): Promise<void> {
    this.#update({ nickname: profile.nickname, colour: profile.colour, faction: isPlayable(profile.faction) ? profile.faction : 'neutra' });
    dressMenu(this.#themes, this.#themeSetting(), this.#settings.faction);
    const session = this.#session;
    if (session && session.status === 'online') {
      const patch = { colour: profile.colour, ...(profile.nickname ? { name: profile.nickname } : {}) };
      const result = await session.updateProfile(patch);
      if (!result.ok) this.#hud.toast(result.message, 'bad');
      void session.setFaction(this.#settings.faction);
    }
    this.#menu.refreshProfile();
  }

  // ------------------------------------------------------------ local matches

  #seed(): number {
    return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  }

  #ownFaction(): FactionId {
    return isPlayable(this.#settings.faction) ? this.#settings.faction : 'neutra';
  }

  /** Bots and faction art load on demand; a match waits for both. */
  async #prepare(): Promise<AiModule> {
    this.#hud.toast(t('menu.loading'), 'neutral', 1.2);
    const [ai] = await Promise.all([loadAi(), loadFactionArt()]);
    return ai;
  }

  async #startLocal(setup: MatchSetup, autoLayout: boolean): Promise<void> {
    this.#unlockSound();
    if (setup.doubles) {
      await this.#startDoubles(setup);
      return;
    }
    const ai = await this.#prepare();
    this.#end.close();
    this.#menu.hide();
    this.#lastSetup = setup;
    if (setup.play === 'quick' || setup.play === 'bot') this.#update({ lastSetup: { mode: setup.mode, clock: setup.clock, level: setup.level, faction: setup.faction, botFaction: setup.botFaction, mutators: setup.mutators } });
    // Daily and campaign bots must not learn from this device: everyone faces the same opponent.
    const fixed = setup.play === 'daily' || setup.play === 'campaign';
    const bot = ai.createBot(setup.level, { seed: setup.seed ^ 0x5bd1e995, storage: fixed ? new ai.MemoryStorage() : botStorage(ai), faction: setup.botFaction });
    const host = new LocalHost(setup, bot);
    const seat: PlayerId = host.seat;
    const ownColour = this.#settings.colour;
    const enemyColour = botColour(ownColour);
    const ctx: MatchContext = {
      host,
      play: setup.play,
      setup,
      teams: {
        own: { name: this.#playerName(), colour: colourById(ownColour)?.hex ?? '#2f6fde', faction: setup.faction === 'neutra' ? null : factionName(setup.faction) },
        enemy: { name: bot.profile.name, colour: colourById(enemyColour)?.hex ?? '#d63a3a', faction: setup.botFaction === 'neutra' ? null : factionName(setup.botFaction) },
      },
      social: null,
      autoLayout,
      mutatorReason: this.#mutatorReason(setup),
    };
    dressMatch(this.#themes, this.#themeSetting(), seat, setup.faction, setup.botFaction);
    this.#paintTeams(seat, ownColour, enemyColour);
    this.#game.start(ctx);
    const persona = bot.profile.leader;
    if (persona) this.#hud.say(bot.profile.name, persona.dialogue.intro, portraitUrl(setup.botFaction, 'neutral', 96));
    this.#resize();
  }

  /** Doubles: the player and a bot partner against two bots. */
  async #startDoubles(setup: MatchSetup): Promise<void> {
    const doubles = setup.doubles!;
    const ai = await this.#prepare();
    this.#end.close();
    this.#menu.hide();
    this.#lastSetup = setup;
    const seat = doubles.seat;
    const team = teamOf(seat);
    const enemy: PlayerId = team === 'blue' ? 'red' : 'blue';
    const partner = partnerOf(seat);
    const make = (level: BotLevelId, faction: FactionId, salt: number) => ai.createBot(level, { seed: (setup.seed ^ salt) >>> 0, storage: botStorage(ai), faction });
    const bots: Partial<Record<SeatId, Bot>> = {
      [partner]: make(doubles.partnerLevel, setup.faction, 0x1234567),
      [seatsOf(enemy)[0]]: make(setup.level, setup.botFaction, 0x5bd1e995),
      [seatsOf(enemy)[1]]: make(setup.level, setup.botFaction, 0x27d4eb2f),
    };
    const me = this.#playerName();
    const names = {} as Record<SeatId, string>;
    names[seat] = me;
    for (const s of [partner, ...seatsOf(enemy)] as SeatId[]) names[s] = bots[s]!.profile.name;
    // Two bots of the same level would share a name: number them.
    const [e1, e2] = seatsOf(enemy);
    if (names[e1] === names[e2]) {
      names[e1] = `${names[e1]} (1)`;
      names[e2] = `${names[e2]} (2)`;
    }
    if (names[partner] === names[e1] || names[partner] === names[e2]) names[partner] = `${names[partner]} · ${t('doubles.partnerName')}`;
    const host = new LocalTeamHost(setup, { seat, names }, bots, ai);
    const ownColour = this.#settings.colour;
    const enemyColour = botColour(ownColour);
    const ctx: MatchContext = {
      host,
      play: 'doubles',
      setup,
      teams: {
        own: { name: t('doubles.teamName', { a: me, b: names[partner] }), colour: colourById(ownColour)?.hex ?? '#2f6fde', faction: setup.faction === 'neutra' ? null : factionName(setup.faction) },
        enemy: { name: t('doubles.teamName', { a: names[e1], b: names[e2] }), colour: colourById(enemyColour)?.hex ?? '#d63a3a', faction: setup.botFaction === 'neutra' ? null : factionName(setup.botFaction) },
      },
      social: null,
      autoLayout: false,
      seatNames: names,
      mutatorReason: this.#mutatorReason(setup),
    };
    dressMatch(this.#themes, this.#themeSetting(), team, setup.faction, setup.botFaction);
    this.#paintTeams(team, ownColour, enemyColour);
    this.#game.start(ctx);
    this.#resize();
  }

  #playerName(): string {
    return this.#settings.nickname || t('player.you');
  }

  #mutatorReason(setup: MatchSetup): string | undefined {
    if (setup.mutators.length === 0) return undefined;
    if (setup.daily) return t('reason.daily');
    if (setup.mission) {
      const mission = campaignMission(setup.mission);
      const arc = CAMPAIGN.find((a) => a.faction === mission?.arc);
      return t('reason.campaign', { name: arc?.title ?? '' });
    }
    return t('reason.chosen');
  }

  // ------------------------------------------------------------ daily challenge

  /** Today's challenge: from the server when online (with everyone's table), else computed here. */
  async #dailyData(): Promise<DailyData> {
    const session = this.#session;
    if (session && session.status === 'online' && typeof session.getDaily === 'function') {
      const answer = new Promise<DailyServer | null>((resolve) => {
        const off = session.on('daily', (msg) => {
          off();
          resolve(msg);
        });
        window.setTimeout(() => {
          off();
          resolve(null);
        }, 4000);
      });
      const sent = await session.getDaily();
      const server = sent.ok ? await answer : null;
      if (server) this.#dailyServer = server;
    }
    const challenge = this.#dailyServer?.challenge.id === dailyChallenge(new Date()).id ? this.#dailyServer.challenge : dailyChallenge(new Date());
    const server = this.#dailyServer?.challenge.id === challenge.id ? this.#dailyServer : null;
    const local = this.#dailyBoard(challenge.id);
    await loadFactionArt().catch(() => undefined);
    const ai = await loadAi();
    return {
      challenge,
      entries: server ? server.board : local.entries,
      source: server ? 'server' : 'local',
      me: server && this.#session?.displayTag ? this.#session.displayTag : this.#playerName(),
      botName: ai.PROFILES[ai.BOT_IDS[challenge.botLevel - 1]!].name,
      portrait: (id, size) => portraitUrl(id, 'neutral', size),
      played: local.entries.some((e) => e.name === this.#playerName()),
    };
  }

  #dailyBoard(id: string): DailyBoard {
    try {
      const raw = localStorage.getItem(DAILY_KEY);
      const board = raw ? parseDailyBoard(JSON.parse(raw)) : null;
      return board && board.challengeId === id ? board : emptyDailyBoard(id);
    } catch {
      return emptyDailyBoard(id);
    }
  }

  #saveDailyBoard(board: DailyBoard): void {
    try {
      localStorage.setItem(DAILY_KEY, JSON.stringify(board));
    } catch {
      // storage full or blocked: the table just won't persist
    }
  }

  #playDaily(): void {
    const today = dailyChallenge(new Date());
    const c = this.#dailyServer?.challenge.id === today.id ? this.#dailyServer.challenge : today;
    void this.#startLocal(
      { play: 'daily', mode: modeOfPreset(c.preset), clock: c.clock, level: c.botLevel, faction: c.playerFaction, botFaction: c.opponentFaction, mutators: c.mutators, seed: c.seed, daily: c.id },
      false,
    );
  }

  // ------------------------------------------------------------ campaign

  #campaignData(): CampaignData {
    // Commander lines come with the bots; fetch them while the map is open.
    if (!aiModule()) void loadAi().then(() => this.#menu.refreshCampaign(), () => undefined);
    return {
      progress: () => this.#campaign.progress,
      portrait: (id, size) => portraitUrl(id, 'neutral', size),
      artReady: () => loadFactionArt(),
      persona: (id) => {
        const persona = aiModule()?.LEADERS[id];
        return persona ? { intro: persona.dialogue.intro, personality: persona.personality } : null;
      },
      sync:
        this.#session && this.#session.status === 'online'
          ? async () => {
              const result = await this.#session!.syncCampaign();
              return result.ok ? t('campaign.synced') : result.message;
            }
          : null,
    };
  }

  #playMission(mission: CampaignMission): void {
    void this.#startLocal(
      {
        play: 'campaign',
        mode: modeOfPreset(mission.preset),
        clock: 'unlimited',
        level: mission.botLevel,
        faction: mission.playerFaction,
        botFaction: mission.opponentFaction,
        mutators: mission.mutators,
        seed: mission.seed,
        mission: mission.id,
      },
      false,
    );
  }

  /** Daily score or campaign stars for the end screen (and the server, when online). */
  #recordResult(summary: EndSummary): { extra: string | null; next: { label: 'end.nextMission'; action: () => void } | null } {
    const ctx = this.#game.context;
    const setup = summary.setup;
    if (!ctx || !setup || !(ctx.host instanceof LocalHost)) return { extra: null, next: null };
    const match = ctx.host.match;
    if (setup.daily) {
      const result = dailyResultFromMatch(match, this.#playerName(), summary.durationMs);
      const board = addDailyResult(this.#dailyBoard(setup.daily), result);
      this.#saveDailyBoard(board);
      const session = this.#session;
      if (session && session.status === 'online') {
        const off = session.on('dailyResult', (msg) => {
          off();
          this.#end.setRematchState(t('daily.sent', { rank: msg.rank ?? '—' }));
        });
        void session.submitDaily(setup.daily, match.log).then((r) => {
          if (!r.ok) {
            off();
            this.#end.setRematchState(t('daily.sendFailed', { reason: r.message }));
          }
        });
      }
      return { extra: t('end.dailyScore', { score: dailyScore(result), rank: dailyRank(board, result.name) ?? '—' }), next: null };
    }
    if (setup.mission) {
      const shots = dailyResultFromMatch(match, this.#playerName(), summary.durationMs).shots;
      const recorded = this.#campaign.record(setup.mission, { won: summary.victory, shots });
      const session = this.#session;
      if (summary.victory && session && session.status === 'online') void session.submitMission(setup.mission, match.log);
      const stars = recorded.ok ? recorded.stars : 0;
      const mission = campaignMission(setup.mission);
      const arc = CAMPAIGN.find((a) => a.faction === mission?.arc);
      const following = mission && arc ? arc.missions[mission.index + 1] : undefined;
      const next =
        summary.victory && following && missionStatus(this.#campaign.progress, following.id) !== 'locked'
          ? { label: 'end.nextMission' as const, action: () => this.#playMission(following) }
          : null;
      return { extra: t('end.campaignStars', { stars: '★'.repeat(stars) + '☆'.repeat(3 - stars) }), next };
    }
    return { extra: null, next: null };
  }
  #paintTeams(seat: PlayerId, own: string, enemy: string): void {
    // `own` / `enemy` may come as palette ids or as hex (from the context).
    const ownId = own.startsWith('#') ? this.#settings.colour : own;
    const enemyId = enemy.startsWith('#') ? botColour(this.#settings.colour) : enemy;
    const online = this.#game.context?.host.online ? this.#room : null;
    const ids = online
      ? {
          own: online.players.find((p) => p.seat === online.you)?.colour ?? ownId,
          enemy: online.players.find((p) => seatTeam(p.seat) !== seat)?.colour ?? enemyId,
        }
      : { own: ownId, enemy: enemyId };
    const hex = applyTeamColours(seat, ids.own, ids.enemy, this.#settings.colorblind);
    const ctx = this.#game.context;
    if (ctx) this.#hud.setTeams({ ...ctx.teams.own, colour: hex.own }, { ...ctx.teams.enemy, colour: hex.enemy });
  }

  #onPhase(phase: string): void {
    this.#resize();
    this.#applyCoordinates();
    const ctx = this.#game.context;
    if (phase === 'placing' && ctx?.play !== 'quick') this.#tips.show('place', 'bottom');
    if (phase === 'playing') {
      this.#tips.dismiss();
      window.setTimeout(() => {
        if (this.#game.flow.phase !== 'playing') return;
        this.#tips.show('aim', 'stage');
      }, 1200);
      if (this.#game.view?.config.abilities.length) window.setTimeout(() => this.#tips.show('powers', 'actions'), 9000);
    }
    if (phase === 'ended') this.#tips.dismiss();
  }

  #onEnd(summary: EndSummary): void {
    const ctx = this.#game.context;
    const online = ctx?.host.online ?? false;
    const level = summary.setup?.level ?? 1;
    const canLevelUp = !online && summary.victory && (summary.play === 'bot' || summary.play === 'quick') && nextLevel(level) !== null;
    const recorded = online ? { extra: null, next: null } : this.#recordResult(summary);
    window.setTimeout(() => {
      if (this.#game.context !== ctx) return;
      this.#end.show(summary, { canLevelUp, online, rematchWindow: 15, extra: recorded.extra, next: recorded.next }, {
        rematch: () => this.#rematch(),
        levelUp: () => {
          const setup = summary.setup ?? this.#lastSetup;
          const next = nextLevel(level);
          if (setup && next) this.#startLocal({ ...setup, play: 'bot', level: next, seed: this.#seed() }, false);
        },
        home: () => {
          if (online) void this.#session?.leaveRoom();
          this.#goMenu(summary.play === 'daily' ? 'daily' : summary.play === 'campaign' ? 'campaign' : 'home');
        },
        viewBoard: () => undefined,
      });
    }, this.#reduced ? 200 : 1600);
  }

  #rematch(): void {
    const ctx = this.#game.context;
    if (!ctx) return;
    if (ctx.host.online) {
      void this.#session?.rematch(true).then((result) => {
        if (result.ok) this.#end.setRematchState(t('end.rematchSent'));
        else this.#end.setRematchState(result.message);
      });
      return;
    }
    if (ctx.setup) this.#startLocal({ ...ctx.setup, seed: this.#seed() }, ctx.autoLayout);
  }

  // ------------------------------------------------------------ online

  async #openOnline(container: HTMLElement): Promise<void> {
    this.#unlockSound();
    if (this.#panel || this.#panelLoading) return;
    // The online panel (and its styles) is its own chunk.
    this.#panelLoading = true;
    const { mountOnlinePanel } = await import('../net/onlinePanel').finally(() => (this.#panelLoading = false));
    if (this.#panel || !container.isConnected || this.#menu.screen !== 'online') return;
    this.#panel = mountOnlinePanel(container, {
      ...(this.#session ? { session: this.#session } : {}),
      clientVersion: CLIENT_VERSION,
      onSessionChange: (session) => this.#bindSession(session),
      onMatchStart: ({ session, host, room }) => this.#startOnline(session, host, room),
      onClose: () => {
        this.#closeOnline();
        this.#menu.go('home');
      },
    });
    if (this.#panel.session && this.#panel.session !== this.#session) this.#bindSession(this.#panel.session);
  }

  #closeOnline(): void {
    this.#panel?.destroy();
    this.#panel = null;
  }

  #bindSession(session: OnlineSession | null): void {
    if (session === this.#session) return;
    for (const off of this.#sessionOff.splice(0)) off();
    this.#session = session;
    this.#menu.refreshProfile();
    if (!session) return;
    this.#sessionOff.push(
      session.on('room', (room) => {
        this.#room = room;
      }),
      session.on('matchStart', ({ room, host }) => this.#startOnline(session, host, room)),
      session.on('opponent', ({ connected, graceLeftMs }) => {
        if (!this.#game.context?.host.online) return;
        if (connected) {
          if (this.#opponentAway) this.#hud.toast(t('net.opponentBack'), 'good');
          this.#opponentAway = null;
        } else this.#opponentAway = { since: performance.now(), graceMs: graceLeftMs };
      }),
      session.on('status', (status) => {
        if (!this.#game.context?.host.online) return;
        const offline = status === 'reconnecting' || status === 'offline' || status === 'connecting';
        this.#game.setOffline(offline);
        this.#hud.setNetBanner(offline ? t(status === 'reconnecting' || status === 'connecting' ? 'net.reconnecting' : 'net.offline') : null);
        if (status === 'online') void this.#game.context.host.view();
      }),
      session.on('rtt', (ms) => this.#hud.setNetStatus(t('net.ping', { ms: Math.round(ms) }), ms > 250 ? 'warn' : 'neutral')),
      session.on('emote', (msg) => {
        const ctx = this.#game.context;
        if (!ctx) return;
        // Doubles: the partner's emotes show on our side, with their name.
        if (msg.from !== this.#room?.you) this.#game.showEmote(seatTeam(msg.from), msg.kind, msg.emote, ctx.seatNames?.[msg.from as SeatId]);
      }),
      session.on('rematchOffer', (seat) => {
        if (seatTeam(seat) !== this.#game.context?.host.seat) this.#end.opponentWantsRematch();
      }),
      session.on('roomClosed', (reason) => {
        if (!this.#game.context?.host.online) return;
        this.#hud.toast(t(`net.closed.${reason}` as never), 'warn', 5);
        if (this.#game.flow.phase !== 'ended') this.#goMenu();
        else this.#end.setRematchState(t('end.rematchClosed'));
      }),
      session.on('invite', ({ from, code }) => {
        if (this.#panel) return;
        this.#hud.toast(t('net.invite', { name: `${from.name}#${from.tag}`, code }), 'info', 6);
      }),
      session.on('fatal', (reason) => {
        this.#hud.toast(reason, 'bad', 6);
        if (this.#game.context?.host.online) this.#goMenu();
      }),
      session.on('profile', () => this.#menu.refreshProfile()),
    );
  }

  #startOnline(session: OnlineSession, remote: RemoteMatchHost, room: RoomInfo): void {
    if (room.matchNumber === this.#onlineMatch && this.#game.context?.host.online) return;
    this.#onlineMatch = room.matchNumber;
    this.#bindSession(session);
    this.#room = room;
    this.#closeOnline();
    this.#menu.hide();
    this.#end.close();
    this.#opponentAway = null;
    const seat = seatTeam(room.you);
    const me = room.players.find((p) => p.seat === room.you);
    const them = room.players.find((p) => seatTeam(p.seat) !== seat);
    const host = new RemoteHost(session, remote, seat);
    const tagOf = (p: RoomInfo['players'][number] | undefined) => (p ? `${p.profile.name}#${p.profile.tag}` : t('player.opponent'));
    // Doubles rooms: every seat has a name, and each team shows both partners.
    const doubles = room.format === 'doubles';
    const seatNames = doubles ? (Object.fromEntries(room.players.map((p) => [p.seat, tagOf(p)])) as Partial<Record<SeatId, string>>) : undefined;
    const teamName = (team: PlayerId, fallback: string) => {
      const players = room.players.filter((p) => seatTeam(p.seat) === team);
      return doubles && players.length > 1 ? t('doubles.teamName', { a: tagOf(players[0]), b: tagOf(players[1]) }) : fallback;
    };
    const ctx: MatchContext = {
      host,
      play: 'online',
      setup: null,
      ...(seatNames ? { seatNames } : {}),
      mutatorReason: t('reason.room'),
      teams: {
        own: { name: teamName(seat, me ? tagOf(me) : t('player.you')), colour: colourById(me?.colour ?? 'azul')?.hex ?? '#2f6fde', faction: me && me.faction !== 'neutra' ? factionName(me.faction) : null },
        enemy: { name: teamName(seat === 'blue' ? 'red' : 'blue', tagOf(them)), colour: colourById(them?.colour ?? 'vermelho')?.hex ?? '#d63a3a', faction: them && them.faction !== 'neutra' ? factionName(them.faction) : null },
      },
      social: {
        sendEmoji: async (id: EmojiId) => net(await session.sendEmoji(id, this.#teamOnly && doubles ? 'team' : 'all')),
        sendTaunt: async (id: TauntId) => net(await session.sendTaunt(id, this.#teamOnly && doubles ? 'team' : 'all')),
      },
      autoLayout: false,
    };
    dressMatch(this.#themes, this.#themeSetting(), seat, me?.faction ?? 'neutra', them?.faction ?? 'neutra');
    this.#game.start(ctx);
    this.#paintTeams(seat, me?.colour ?? 'azul', them?.colour ?? 'vermelho');
    this.#hud.setMuted(session.storage.mutedEmotes);
    this.#resize();
  }

  #updateOnlineBanners(): void {
    const ctx = this.#game.context;
    if (!ctx?.host.online) return;
    if (this.#game.flow.phase === 'placing' || this.#game.flow.phase === 'waiting') this.#game.setPlacementDeadline(this.#room?.placementDeadline ?? null);
    const away = this.#opponentAway;
    if (away && !this.#game.flow.offline) {
      const left = away.graceMs === null ? null : Math.max(0, away.graceMs - (performance.now() - away.since));
      const time = left === null ? '' : ` ${Math.ceil(left / 1000)} s`;
      this.#hud.setNetBanner(`${t('net.opponentAway')}${time}`);
    } else if (!this.#game.flow.offline) this.#hud.setNetBanner(null);
  }

  async #toggleMute(): Promise<void> {
    const session = this.#session;
    if (!session) return;
    const muted = !session.storage.mutedEmotes;
    await session.muteOpponent(muted);
    this.#hud.setMuted(muted);
    this.#hud.toast(t(muted ? 'social.mutedOn' : 'social.mutedOff'), 'neutral', 1.8);
  }

  async #togglePartnerMute(): Promise<void> {
    const session = this.#session;
    if (!session) return;
    this.#mutedPartner = !this.#mutedPartner;
    await session.mutePartner(this.#mutedPartner);
    this.#hud.toast(t(this.#mutedPartner ? 'social.partnerMutedOn' : 'social.partnerMutedOff'), 'neutral', 1.8);
  }

  #openSocial(anchor: HTMLElement): void {
    const online = this.#game.context?.host.online ?? false;
    openSocial(anchor, {
      emoji: (id) => this.#game.sendEmoji(id),
      taunt: (id) => this.#game.sendTaunt(id),
      cooldowns: () => this.#game.cooldowns(),
      muted: online ? (this.#session?.storage.mutedEmotes ?? false) : null,
      toggleMute: () => void this.#toggleMute(),
      teamOnly: online && this.#room?.format === 'doubles' ? this.#teamOnly : null,
      toggleTeamOnly: () => (this.#teamOnly = !this.#teamOnly),
      mutedPartner: online && this.#room?.format === 'doubles' ? this.#mutedPartner : null,
      togglePartnerMute: () => void this.#togglePartnerMute(),
    });
  }

  #challengeFriend(): void {
    const session = this.#session;
    if (!session || session.status !== 'online') {
      const go = h('button', { type: 'button', class: 'primary', i18n: 'friend.goOnline', onclick: () => {
        handle.close();
        this.#menu.go('online');
      } });
      const handle = openModal(this.#host, h('div', {}, h('p', { i18n: 'friend.needOnline' }), h('div', { class: 'dialog-actions' }, go)), { title: t('menu.friend') });
      return;
    }
    void session.refreshFriends();
    const list = h('ul', { class: 'friends' });
    const draw = () => {
      const friends = session.friends?.friends ?? [];
      list.replaceChildren(
        ...(friends.length === 0
          ? [h('li', { class: 'muted', i18n: 'friend.none' })]
          : friends.map((f) =>
              h(
                'li',
                {},
                h('span', { class: `presence ${f.status}`, 'aria-hidden': 'true' }),
                h('span', { class: 'friend-name' }, `${f.profile.name}#${f.profile.tag}`),
                h('span', { class: 'muted' }, t(`presence.${f.status}` as never)),
                h('button', {
                  type: 'button',
                  class: 'secondary',
                  i18n: 'friend.challenge',
                  disabled: f.status !== 'online',
                  onclick: async () => {
                    const created = session.room ? { ok: true as const } : await session.createRoom('padrao', 'full');
                    if (!created.ok) {
                      this.#hud.toast(created.message, 'bad');
                      return;
                    }
                    const invited = await session.invite(f.profile.userId);
                    this.#hud.toast(invited.ok ? t('friend.sent') : invited.message, invited.ok ? 'good' : 'bad');
                    handle.close();
                    this.#menu.go('online');
                  },
                }),
              ),
            )),
      );
    };
    draw();
    const off = session.on('friends', draw);
    const handle = openModal(this.#host, h('div', {}, h('p', { class: 'muted', i18n: 'friend.hint' }), list), { title: t('menu.friend'), onClose: off });
  }

  // ------------------------------------------------------------ view and input

  #setView(preset: ViewPreset): void {
    this.#rig.setPreset(preset);
    this.#hud.setView(preset);
    this.#game.reframe();
    this.#sound.play('click');
  }

  #resize(): void {
    const width = this.#canvas.clientWidth || window.innerWidth;
    const height = this.#canvas.clientHeight || window.innerHeight;
    this.#stage.resize();
    this.#overlay.resize(width, height);
    const free = this.#hud.updateLayout();
    const offset = this.#menu.visible ? null : viewOffsetFor(width, height, free);
    const camera = this.#rig.camera;
    if (offset) {
      this.#rig.resize(offset.aspect);
      camera.setViewOffset(offset.fullWidth, offset.fullHeight, offset.x, offset.y, offset.width, offset.height);
      this.#fx.setViewport(this.#stage.drawingHeight * (offset.fullHeight / height), camera.fov);
    } else {
      camera.clearViewOffset();
      this.#rig.resize(width / Math.max(1, height));
      this.#fx.setViewport(this.#stage.drawingHeight, camera.fov);
    }
    this.#board.wildlife.setViewport(this.#stage.drawingHeight, camera.fov);
    this.#game.reframe();
    const rect = this.#hud.stageRect();
    this.#layoutKey = `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}:${width}:${height}`;
  }

  #pick(ndc: Vector2): { side: 'own' | 'enemy'; col: number; row: number } | null {
    this.#raycaster.setFromCamera(ndc, this.#rig.camera);
    for (const side of ['enemy', 'own'] as const) {
      const tiles = side === 'enemy' ? this.#board.enemyTiles : this.#board.ownTiles;
      const hit = this.#raycaster.intersectObject(tiles.mesh, false)[0];
      if (hit?.instanceId !== undefined) return { side, col: hit.instanceId % COLS, row: Math.floor(hit.instanceId / COLS) };
    }
    return null;
  }

  #bindInput(): void {
    attachPointer(this.#canvas, {
      hover: (ndc, x, y) => {
        if (!this.#game.active || this.#menu.visible) return;
        this.#game.hover(ndc ? this.#pick(ndc) : null, x, y);
      },
      tap: (ndc) => {
        this.#unlockSound();
        if (!this.#game.active || this.#menu.visible) return;
        const pick = this.#pick(ndc);
        if (pick) this.#game.tap(pick);
      },
      canGrab: (ndc) => this.#game.active && this.#game.canGrab(this.#pick(ndc)),
      grabStart: (ndc) => void this.#game.dragStart(this.#pick(ndc)),
      grabMove: (ndc, x, y) => this.#game.hover(this.#pick(ndc), x, y),
      grabEnd: (ndc) => this.#game.dragEnd(ndc ? this.#pick(ndc) : null),
      orbit: (dx, dy) => this.#rig.orbitBy(-dx * 0.006, -dy * 0.004),
      zoom: (factor) => this.#rig.zoomBy(factor),
    });

    const unlock = () => this.#unlockSound();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    this.#canvas.addEventListener('keydown', (event) => this.#onBoardKey(event));
    window.addEventListener('keydown', (event) => this.#onGlobalKey(event));
  }

  #unlockSound(): void {
    if (this.#soundUnlocked) return;
    this.#soundUnlocked = true;
    this.#sound.unlock();
    this.#sound.setMuted(this.#settings.muted);
  }

  #onBoardKey(event: KeyboardEvent): void {
    if (!this.#game.active) return;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      this.#game.moveCursor(move[0], move[1], this.#rig.flipped);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.#game.activateCursor();
    }
  }

  #onGlobalKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (popoverOpen() || modalOpen()) return;
      if (this.#game.cancelTarget()) {
        event.preventDefault();
        return;
      }
      if (this.#game.flow.paused) this.#game.setPaused(false);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || modalOpen() || popoverOpen()) return;
    const target = event.target as HTMLElement | null;
    if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
    if (!this.#settings.singleKeyShortcuts) return;
    const key = event.key.toLowerCase();
    if (key >= '1' && key <= '3' && this.#game.active) {
      this.#setView(VIEWS[Number(key) - 1]!);
      return;
    }
    switch (key) {
      case 'h':
        this.#showHelp();
        break;
      case 'm':
        this.#update({ muted: !this.#settings.muted });
        this.#hud.toast(t(this.#settings.muted ? 'sound.off' : 'sound.on'), 'neutral', 1.2);
        break;
      case 'e':
        if (this.#game.active) this.#hud.openSocialFromKey();
        break;
      case 'p':
        if (this.#game.canPause) this.#game.setPaused(!this.#game.flow.paused);
        break;
      case 'r':
        if (this.#game.flow.phase === 'placing') this.#game.placeRotate();
        else if (this.#game.active) this.#rig.rotate180();
        break;
    }
  }
}

function net(result: { ok: true } | { ok: false; code: string; message: string }) {
  return result.ok ? ({ ok: true } as const) : ({ ok: false, error: result.code, message: result.message } as const);
}
