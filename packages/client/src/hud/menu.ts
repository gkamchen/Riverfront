import { CLOCK_PRESETS, MUTATOR_IDS, type CampaignMission, type ClockPresetId, type FactionId, type MutatorId, type SeatId } from '@riverfront/core';
import { TEAM_COLOURS, checkName, NAME_PROBLEM_TEXT, colourById } from '@riverfront/protocol';
import type { AiModule } from '../app/aiLoader';
import type { FactionChoice } from '../app/factionArt';
import { GAME_MODE_IDS, type BotLevelId, type GameModeId, type MatchSetup } from '../app/modes';
import { campaignMap, type CampaignData } from './campaignScreen';
import { dailyCard, type DailyData } from './dailyScreen';
import { h, relabel } from './dom';
import { openModal } from './dialogs';
import { factionPicker } from './factionPicker';
import { icon, type IconName } from './icons';
import { factionName, t, type TextKey } from './i18n';

export interface MenuProfile {
  readonly nickname: string;
  /** "Nome#1234" when the server already gave a tag. */
  readonly tag: string | null;
  readonly colour: string;
  readonly faction: FactionId;
}

export type BotSetup = Omit<MatchSetup, 'seed' | 'play'>;

export interface MenuActions {
  quickPlay(): void;
  training(): void;
  startBot(setup: BotSetup): void;
  startDoubles(setup: BotSetup & { readonly doubles: NonNullable<MatchSetup['doubles']> }): void;
  playDaily(): void;
  playMission(mission: CampaignMission): void;
  openOnline(container: HTMLElement): void;
  closeOnline(): void;
  challengeFriend(): void;
  openSettings(anchor: HTMLElement): void;
  showHelp(): void;
  saveProfile(profile: { nickname: string; colour: string; faction: FactionId }): void;
}

export interface MenuData {
  profile(): MenuProfile;
  factions(): readonly FactionChoice[];
  portrait(id: FactionId, size?: number): string | null;
  artReady(): Promise<unknown>;
  lastSetup(): Partial<MatchSetup> | null;
  loadAi(): Promise<AiModule>;
  daily(): Promise<DailyData>;
  campaign(): CampaignData;
}

type Screen = 'home' | 'bot' | 'doubles' | 'daily' | 'campaign' | 'online';

const CLOCK_ORDER: readonly ClockPresetId[] = ['relampago', 'padrao', 'tranquilo', 'unlimited'];

interface SetupState {
  level: BotLevelId;
  mode: GameModeId;
  clock: ClockPresetId;
  faction: FactionId;
  botFaction: FactionId;
  mutators: MutatorId[];
  seat: SeatId;
  partnerLevel: BotLevelId;
}

/** Main menu: home, bot / doubles setup, daily challenge, campaign and the online panel host. */
export class MainMenu {
  readonly root: HTMLElement;
  readonly #actions: MenuActions;
  readonly #data: MenuData;
  readonly #host: HTMLElement;
  readonly #screens: Record<Screen, HTMLElement>;
  readonly #profileChip: HTMLButtonElement;
  readonly #onlineSlot: HTMLElement;
  #screen: Screen = 'home';
  readonly #setup: SetupState;

  constructor(host: HTMLElement, actions: MenuActions, data: MenuData) {
    this.#host = host;
    this.#actions = actions;
    this.#data = data;
    const last = data.lastSetup();
    this.#setup = {
      level: last?.level ?? 2,
      mode: last?.mode ?? 'completo',
      clock: last?.clock ?? 'padrao',
      faction: data.profile().faction,
      botFaction: last?.botFaction ?? 'egito',
      mutators: [...(last?.mutators ?? [])],
      seat: 'blue-1',
      partnerLevel: 3,
    };

    this.#profileChip = h('button', { type: 'button', class: 'profile-chip', onclick: () => this.#editProfile() });
    this.#onlineSlot = h('div', { class: 'online-slot' });
    const card = (extra = '') => h('section', { class: `menu-card wide ${extra}`, hidden: true });
    this.#screens = {
      home: this.#buildHome(),
      bot: card(),
      doubles: card(),
      daily: card(),
      campaign: card('campaign-card'),
      online: h(
        'section',
        { class: 'menu-card wide online-card', hidden: true },
        h('header', { class: 'menu-head' }, this.#back(() => actions.closeOnline()), h('h2', { i18n: 'menu.online' })),
        this.#onlineSlot,
      ),
    };
    this.root = h(
      'div',
      { class: 'menu-screen', role: 'main' },
      h(
        'header',
        { class: 'menu-top' },
        h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '♜'), h('h1', {}, 'Riverfront'), h('p', { class: 'tagline', i18n: 'app.tagline' })),
        this.#profileChip,
      ),
      ...Object.values(this.#screens),
    );
    host.append(this.root);
    this.refreshProfile();
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(screen: Screen = 'home'): void {
    this.root.hidden = false;
    this.go(screen);
  }

  hide(): void {
    this.root.hidden = true;
  }

  go(screen: Screen): void {
    this.#screen = screen;
    for (const [id, node] of Object.entries(this.#screens)) node.hidden = id !== screen;
    if (screen === 'bot') void this.#buildBot();
    if (screen === 'doubles') void this.#buildDoubles();
    if (screen === 'daily') void this.#buildDaily();
    if (screen === 'campaign') this.#buildCampaign();
    if (screen === 'online') this.#actions.openOnline(this.#onlineSlot);
    const first = this.#screens[screen].querySelector<HTMLElement>('button, input, select');
    first?.focus();
  }

  get screen(): Screen {
    return this.#screen;
  }

  relabel(): void {
    relabel(this.root);
    this.refreshProfile();
    if (this.#screen !== 'home' && this.#screen !== 'online') this.go(this.#screen);
  }

  refreshProfile(): void {
    const p = this.#data.profile();
    const colour = colourById(p.colour)?.hex ?? '#2f6fde';
    this.#profileChip.replaceChildren(
      h('span', { class: 'swatch-dot', style: `background:${colour}`, 'aria-hidden': 'true' }),
      h('span', { class: 'profile-name' }, p.tag ?? (p.nickname || t('profile.guest'))),
      h('span', { class: 'profile-faction' }, factionName(p.faction)),
      h('span', { class: 'sr-only', i18n: 'profile.edit' }),
    );
    this.#profileChip.title = t('profile.edit');
  }

  // ------------------------------------------------------------ home

  #buildHome(): HTMLElement {
    const a = this.#actions;
    const big = (iconName: IconName, label: TextKey, hint: TextKey, onclick: (e: Event) => void, primary = false) => {
      const button = h('button', { type: 'button', class: `menu-item${primary ? ' primary-item' : ''}`, onclick });
      button.innerHTML = icon(iconName);
      button.append(h('span', { class: 'menu-item-text' }, h('span', { class: 'menu-item-label', i18n: label }), h('span', { class: 'menu-item-hint', i18n: hint })));
      return button;
    };
    return h(
      'nav',
      { class: 'menu-card home', i18nAria: 'menu.label' },
      big('bolt', 'menu.quick', 'menu.quickHint', () => a.quickPlay(), true),
      h(
        'div',
        { class: 'menu-row' },
        big('book', 'menu.training', 'menu.trainingHint', () => a.training()),
        big('robot', 'menu.bot', 'menu.botHint', () => this.go('bot')),
      ),
      h(
        'div',
        { class: 'menu-row' },
        big('star', 'menu.daily', 'menu.dailyHint', () => this.go('daily')),
        big('flag', 'menu.campaign', 'menu.campaignHint', () => this.go('campaign')),
      ),
      big('users', 'menu.doubles', 'menu.doublesHint', () => this.go('doubles')),
      h(
        'div',
        { class: 'menu-row' },
        big('globe', 'menu.online', 'menu.onlineHint', () => this.go('online')),
        big('swords', 'menu.friend', 'menu.friendHint', () => a.challengeFriend()),
      ),
      h(
        'div',
        { class: 'menu-row' },
        big('gear', 'menu.settings', 'menu.settingsHint', (e) => a.openSettings(e.currentTarget as HTMLElement)),
        big('help', 'menu.help', 'menu.helpHint', () => a.showHelp()),
      ),
    );
  }

  #back(onBack?: () => void): HTMLButtonElement {
    const button = h('button', {
      type: 'button',
      class: 'icon-btn back',
      i18nTitle: 'menu.back',
      onclick: () => {
        onBack?.();
        this.go('home');
      },
    });
    button.innerHTML = icon('back');
    button.append(h('span', { class: 'sr-only', i18n: 'menu.back' }));
    return button;
  }

  #head(title: TextKey): HTMLElement {
    return h('header', { class: 'menu-head' }, this.#back(), h('h2', { i18n: title }));
  }

  #loading(screen: Screen, title: TextKey): void {
    this.#screens[screen].replaceChildren(this.#head(title), h('p', { class: 'muted', i18n: 'menu.loading' }));
  }

  // ------------------------------------------------------------ shared setup widgets

  #levels(ai: AiModule, current: BotLevelId, onPick: (level: BotLevelId) => void, label: TextKey): HTMLElement {
    const levels = h('div', { class: 'choice-grid levels', role: 'radiogroup', i18nAria: label });
    ai.BOT_IDS.forEach((id, i) => {
      const profile = ai.PROFILES[id];
      const level = (i + 1) as BotLevelId;
      levels.append(
        h(
          'button',
          { type: 'button', class: 'choice', role: 'radio', 'aria-checked': String(current === level), onclick: () => onPick(level) },
          h('span', { class: 'choice-badge' }, String(level)),
          h('span', { class: 'choice-title' }, profile.name),
          h('span', { class: 'choice-text' }, profile.personality),
        ),
      );
    });
    return levels;
  }

  #modes(rebuild: () => void): HTMLElement {
    const s = this.#setup;
    const modes = h('div', { class: 'segmented', role: 'radiogroup', i18nAria: 'mode.label' });
    for (const id of GAME_MODE_IDS) {
      modes.append(
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(s.mode === id),
            onclick: () => {
              s.mode = id;
              s.clock = id.startsWith('rapido') ? 'relampago' : s.clock === 'relampago' ? 'padrao' : s.clock;
              rebuild();
            },
          },
          h('span', { i18n: `mode.${id}` as TextKey }),
          h('small', { i18n: `mode.${id}.hint` as TextKey }),
        ),
      );
    }
    return modes;
  }

  #clock(): HTMLElement {
    const s = this.#setup;
    const clock = h('select', { class: 'select', onchange: (e: Event) => (s.clock = (e.target as HTMLSelectElement).value as ClockPresetId) });
    for (const id of CLOCK_ORDER) {
      const preset = CLOCK_PRESETS[id];
      const option = h('option', { value: id }, t(`clock.preset.${id}` as TextKey) + (preset.turnMs ? ` · ${preset.turnMs / 1000} s` : ''));
      if (id === s.clock) option.selected = true;
      clock.append(option);
    }
    return h('div', { class: 'setup-row' }, h('label', { class: 'field' }, h('span', { i18n: 'clock.label' }), clock));
  }

  #mutators(): HTMLElement {
    const s = this.#setup;
    const mutators = h('div', { class: 'toggles' });
    for (const id of MUTATOR_IDS) {
      const input = h('input', {
        type: 'checkbox',
        checked: s.mutators.includes(id),
        onchange: (e: Event) => {
          const on = (e.target as HTMLInputElement).checked;
          s.mutators = on ? [...s.mutators, id] : s.mutators.filter((m) => m !== id);
        },
      });
      mutators.append(h('label', { class: 'toggle' }, input, h('span', {}, h('strong', { i18n: `mutator.name.${id}` as TextKey }), h('small', { i18n: `mutator.desc.${id}` as TextKey }))));
    }
    return mutators;
  }

  #picker(current: FactionId, onPick: (id: FactionId) => void): HTMLElement {
    return factionPicker({ choices: () => this.#data.factions(), portrait: (id, size) => this.#data.portrait(id, size), artReady: () => this.#data.artReady() }, current, onPick);
  }

  // ------------------------------------------------------------ bot setup

  async #buildBot(): Promise<void> {
    const ai = await this.#needAi('bot', 'menu.bot');
    if (!ai || this.#screen !== 'bot') return;
    const s = this.#setup;
    const rebuild = () => void this.#buildBot();
    const leaders = h('div', { class: 'choice-grid leaders', role: 'radiogroup', i18nAria: 'bot.leader' });
    const leaderIds: FactionId[] = ['neutra', ...(Object.keys(ai.LEADERS) as FactionId[])];
    for (const id of leaderIds) {
      const persona = ai.LEADERS[id];
      const portrait = id === 'neutra' ? null : this.#data.portrait(id, 96);
      leaders.append(
        h(
          'button',
          { type: 'button', class: 'choice leader', role: 'radio', 'aria-checked': String(s.botFaction === id), onclick: () => ((s.botFaction = id), rebuild()) },
          portrait ? h('img', { src: portrait, alt: '', width: 56, height: 56, loading: 'lazy' }) : h('span', { class: 'portrait-mono', 'aria-hidden': 'true' }, '?'),
          h('span', { class: 'choice-title' }, persona ? `${persona.title} ${persona.name}` : t('bot.noLeader')),
          h('span', { class: 'choice-text' }, persona ? factionName(id) : t('bot.noLeaderHint')),
        ),
      );
    }
    const start = h('button', {
      type: 'button',
      class: 'primary big',
      i18n: 'bot.start',
      onclick: () => this.#actions.startBot({ mode: s.mode, clock: s.clock, level: s.level, faction: s.faction, botFaction: s.botFaction, mutators: s.mutators }),
    });
    this.#screens.bot.replaceChildren(
      this.#head('menu.bot'),
      h(
        'div',
        { class: 'setup-scroll' },
        h('h3', { i18n: 'bot.level' }),
        this.#levels(ai, s.level, (l) => ((s.level = l), rebuild()), 'bot.level'),
        h('h3', { i18n: 'bot.leader' }),
        leaders,
        h('h3', { i18n: 'bot.yourFaction' }),
        this.#picker(s.faction, (id) => (s.faction = id)),
        h('h3', { i18n: 'mode.label' }),
        this.#modes(rebuild),
        this.#clock(),
        h('h3', { i18n: 'mutator.label' }),
        this.#mutators(),
      ),
      h('footer', { class: 'menu-foot' }, start),
    );
    this.#data.artReady().then(() => this.#screen === 'bot' && leaders.isConnected && rebuild(), () => undefined);
  }

  async #needAi(screen: Screen, title: TextKey): Promise<AiModule | null> {
    if (!this.#screens[screen].firstChild) this.#loading(screen, title);
    try {
      return await this.#data.loadAi();
    } catch {
      this.#screens[screen].replaceChildren(this.#head(title), h('p', { class: 'field-error', i18n: 'menu.loadFailed' }));
      return null;
    }
  }

  // ------------------------------------------------------------ doubles setup

  async #buildDoubles(): Promise<void> {
    const ai = await this.#needAi('doubles', 'menu.doubles');
    if (!ai || this.#screen !== 'doubles') return;
    const s = this.#setup;
    const rebuild = () => void this.#buildDoubles();
    const seats = h('div', { class: 'segmented', role: 'radiogroup', i18nAria: 'doubles.seat' });
    for (const seat of ['blue-1', 'blue-2'] as const) {
      seats.append(
        h(
          'button',
          { type: 'button', role: 'radio', 'aria-checked': String(s.seat === seat), onclick: () => ((s.seat = seat), rebuild()) },
          h('span', { i18n: seat === 'blue-1' ? 'doubles.seat1' : 'doubles.seat2' }),
          h('small', { i18n: seat === 'blue-1' ? 'doubles.seat1Hint' : 'doubles.seat2Hint' }),
        ),
      );
    }
    const enemy = h('select', { class: 'select', onchange: (e: Event) => (s.botFaction = (e.target as HTMLSelectElement).value as FactionId) });
    for (const f of this.#data.factions().filter((f) => f.playable)) {
      const option = h('option', { value: f.id }, f.id === 'neutra' ? t('faction.neutral') : factionName(f.id));
      if (f.id === s.botFaction) option.selected = true;
      enemy.append(option);
    }
    const start = h('button', {
      type: 'button',
      class: 'primary big',
      i18n: 'doubles.start',
      onclick: () =>
        this.#actions.startDoubles({
          mode: s.mode,
          clock: s.clock,
          level: s.level,
          faction: s.faction,
          botFaction: s.botFaction,
          mutators: s.mutators,
          doubles: { seat: s.seat, partnerLevel: s.partnerLevel },
        }),
    });
    this.#screens.doubles.replaceChildren(
      this.#head('menu.doubles'),
      h(
        'div',
        { class: 'setup-scroll' },
        h('p', { class: 'muted', i18n: 'doubles.intro' }),
        h('h3', { i18n: 'doubles.seat' }),
        seats,
        h('h3', { i18n: 'doubles.partner' }),
        this.#levels(ai, s.partnerLevel, (l) => ((s.partnerLevel = l), rebuild()), 'doubles.partner'),
        h('h3', { i18n: 'doubles.enemies' }),
        this.#levels(ai, s.level, (l) => ((s.level = l), rebuild()), 'doubles.enemies'),
        h('h3', { i18n: 'doubles.teamFaction' }),
        this.#picker(s.faction, (id) => (s.faction = id)),
        h('div', { class: 'setup-row' }, h('label', { class: 'field' }, h('span', { i18n: 'doubles.enemyFaction' }), enemy)),
        h('h3', { i18n: 'mode.label' }),
        this.#modes(rebuild),
        this.#clock(),
        h('h3', { i18n: 'mutator.label' }),
        this.#mutators(),
      ),
      h('footer', { class: 'menu-foot' }, start),
    );
  }

  // ------------------------------------------------------------ daily challenge

  async #buildDaily(): Promise<void> {
    this.#loading('daily', 'menu.daily');
    let data: DailyData;
    try {
      data = await this.#data.daily();
    } catch {
      this.#screens.daily.replaceChildren(this.#head('menu.daily'), h('p', { class: 'field-error', i18n: 'menu.loadFailed' }));
      return;
    }
    if (this.#screen !== 'daily') return;
    this.#screens.daily.replaceChildren(this.#head('menu.daily'), dailyCard(data, () => this.#actions.playDaily()));
  }

  /** Redraws the daily screen (after a server answer). */
  refreshDaily(): void {
    if (this.#screen === 'daily' && this.visible) void this.#buildDaily();
  }

  // ------------------------------------------------------------ campaign

  #buildCampaign(): void {
    this.#screens.campaign.replaceChildren(this.#head('menu.campaign'), campaignMap(this.#host, this.#data.campaign(), { play: (m) => this.#actions.playMission(m) }));
  }

  refreshCampaign(): void {
    if (this.#screen === 'campaign' && this.visible) this.#buildCampaign();
  }

  // ------------------------------------------------------------ profile

  #editProfile(): void {
    const p = this.#data.profile();
    let colour = p.colour;
    let faction = p.faction;
    const error = h('p', { class: 'field-error', role: 'alert' });
    const name = h('input', { type: 'text', class: 'input', value: p.nickname, maxlength: 16, autocomplete: 'nickname', i18nAria: 'profile.nickname' });
    const swatches = h('div', { class: 'swatches', role: 'radiogroup', i18nAria: 'profile.colour' });
    const drawSwatches = () => {
      swatches.replaceChildren(
        ...TEAM_COLOURS.map((c) =>
          h(
            'button',
            {
              type: 'button',
              class: `swatch${c.colourBlindSafe ? ' cb' : ''}`,
              role: 'radio',
              'aria-checked': String(colour === c.id),
              title: c.name + (c.colourBlindSafe ? ` · ${t('profile.cbSafe')}` : ''),
              style: `--swatch:${c.hex}`,
              onclick: () => {
                colour = c.id;
                drawSwatches();
              },
            },
            h('span', { class: 'sr-only' }, c.name),
          ),
        ),
      );
    };
    drawSwatches();
    const save = h('button', {
      type: 'button',
      class: 'primary',
      i18n: 'profile.save',
      onclick: () => {
        const raw = name.value.trim();
        if (raw) {
          const checked = checkName(raw);
          if (!checked.ok) {
            error.textContent = NAME_PROBLEM_TEXT[checked.problem];
            name.focus();
            return;
          }
        }
        this.#actions.saveProfile({ nickname: raw, colour, faction });
        handle.close();
        this.refreshProfile();
      },
    });
    const body = h(
      'div',
      { class: 'profile-form' },
      h('label', { class: 'field' }, h('span', { i18n: 'profile.nickname' }), name),
      p.tag ? h('p', { class: 'muted' }, t('profile.tag', { tag: p.tag })) : h('p', { class: 'muted', i18n: 'profile.tagHint' }),
      error,
      h('h3', { i18n: 'profile.colour' }),
      h('p', { class: 'muted', i18n: 'profile.colourHint' }),
      swatches,
      h('h3', { i18n: 'faction.label' }),
      this.#picker(faction, (id) => (faction = id)),
      h('div', { class: 'dialog-actions' }, save),
    );
    const handle = openModal(this.#host, body, { title: t('profile.title'), className: 'profile-dialog' });
  }
}
