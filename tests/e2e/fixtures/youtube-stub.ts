/**
 * Фікстура: підміна `https://www.youtube.com/iframe_api` фейковим `YT.Player`.
 * - `onReady`, `onStateChange`, `onError(n)`, `onAutoplayBlocked` керуються з тесту;
 * - лічильники `new YT.Player` і `loadVideoById`;
 * - ідентичність iframe (`data-stub-id` + перевірка, що той самий вузол досі в документі) —
 *   для SC-003 «відео не перезапускається» під час переходу між сторінками.
 * Мережі YouTube тест не торкається: решта запитів до youtube.com / ytimg.com перехоплюються.
 */
import { test as base, type Page } from '@playwright/test';

export interface YTStubPlayerInfo {
  stubId: string;
  videoId: string | null;
  muted: boolean;
  state: number;
  playerVars: Record<string, unknown>;
  destroyed: boolean;
}

export interface YTStubCounters {
  created: number;
  loadVideoById: number;
  loadedIds: string[];
  unMute: number;
  destroyed: number;
}

/** Скрипт фейкового API (виконується в браузері замість iframe_api). */
const STUB_SOURCE = String.raw`
(function () {
  var stub = window.__ytStub = window.__ytStub || {
    counters: { created: 0, loadVideoById: 0, loadedIds: [], unMute: 0, destroyed: 0 },
    players: [],
    firstIframe: null,
    autoReady: true,
  };
  var seq = 0;

  function Player(el, opts) {
    opts = opts || {};
    var target = typeof el === 'string' ? document.getElementById(el) : el;
    var iframe = document.createElement('iframe');
    seq += 1;
    iframe.dataset.stubId = 'yt-stub-' + seq;
    iframe.dataset.ytStub = '';
    iframe.title = 'YouTube video player';
    iframe.src = 'about:blank';
    iframe.setAttribute('width', String(opts.width || 640));
    iframe.setAttribute('height', String(opts.height || 360));
    iframe.style.border = '0';
    iframe.style.display = 'block';
    if (opts.width === '100%') iframe.style.width = '100%';
    if (opts.height === '100%') iframe.style.height = '100%';
    if (target && target.parentNode) target.parentNode.replaceChild(iframe, target);
    var vars = opts.playerVars || {};
    this._info = {
      stubId: iframe.dataset.stubId,
      videoId: opts.videoId || null,
      muted: vars.mute === 1,
      state: -1,
      playerVars: vars,
      destroyed: false,
    };
    iframe.dataset.videoId = this._info.videoId || '';
    this._iframe = iframe;
    this._events = opts.events || {};
    stub.counters.created += 1;
    stub.players.push(this);
    if (!stub.firstIframe) stub.firstIframe = iframe;
    var self = this;
    if (stub.autoReady) {
      setTimeout(function () {
        self._fire('onReady');
        if (vars.autoplay === 1 && self._info.videoId) self._setState(1);
      }, 0);
    }
  }
  Player.prototype._fire = function (name, data) {
    var h = this._events[name];
    if (typeof h === 'function') h({ target: this, data: data });
  };
  Player.prototype._setState = function (s) {
    this._info.state = s;
    this._fire('onStateChange', s);
  };
  Player.prototype.loadVideoById = function (id) {
    if (typeof id === 'object' && id) id = id.videoId;
    stub.counters.loadVideoById += 1;
    stub.counters.loadedIds.push(id);
    this._info.videoId = id;
    this._iframe.dataset.videoId = id;
    var self = this;
    setTimeout(function () { self._setState(1); }, 0);
  };
  Player.prototype.cueVideoById = function (id) {
    this._info.videoId = id;
    this._iframe.dataset.videoId = id;
    this._setState(5);
  };
  Player.prototype.playVideo = function () { this._setState(1); };
  Player.prototype.pauseVideo = function () { this._setState(2); };
  Player.prototype.mute = function () { this._info.muted = true; };
  Player.prototype.unMute = function () { stub.counters.unMute += 1; this._info.muted = false; };
  Player.prototype.isMuted = function () { return this._info.muted; };
  Player.prototype.getPlayerState = function () { return this._info.state; };
  Player.prototype.getIframe = function () { return this._iframe; };
  Player.prototype.getVideoData = function () { return { video_id: this._info.videoId }; };
  Player.prototype.destroy = function () {
    this._info.destroyed = true;
    stub.counters.destroyed += 1;
    if (this._iframe.parentNode) this._iframe.parentNode.removeChild(this._iframe);
  };

  function current() {
    for (var i = stub.players.length - 1; i >= 0; i--) if (!stub.players[i]._info.destroyed) return stub.players[i];
    return null;
  }
  stub.current = current;
  stub.fireReady = function () { var p = current(); if (p) p._fire('onReady'); };
  stub.fireError = function (code) { var p = current(); if (p) p._fire('onError', code); };
  stub.fireStateChange = function (s) { var p = current(); if (p) p._setState(s); };
  stub.fireAutoplayBlocked = function () { var p = current(); if (p) p._fire('onAutoplayBlocked'); };
  stub.info = function () {
    return stub.players.map(function (p) { return Object.assign({}, p._info); });
  };
  stub.sameIframe = function () {
    var f = stub.firstIframe;
    return !!f && f.isConnected && document.querySelectorAll('iframe[data-yt-stub]').length === 1;
  };

  window.YT = { Player: Player, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }, loaded: 1 };
  if (typeof window.onYouTubeIframeAPIReady === 'function') window.onYouTubeIframeAPIReady();
})();
`;

/** 1×1 прозорий PNG замість мініатюр `i.ytimg.com`. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

export interface InstallOptions {
  /** `false` — `onReady` лише через `fireReady()` (перевірка стану «плеєр вантажиться»). */
  autoReady?: boolean;
}

/** Підключити заглушку до сторінки. Викликати до `page.goto`. */
export async function installYouTubeStub(page: Page, opts: InstallOptions = {}): Promise<void> {
  if (opts.autoReady === false) {
    await page.addInitScript(() => {
      (window as unknown as { __ytStub?: unknown }).__ytStub = {
        counters: { created: 0, loadVideoById: 0, loadedIds: [], unMute: 0, destroyed: 0 },
        players: [],
        firstIframe: null,
        autoReady: false,
      };
    });
  }
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB_SOURCE }),
  );
  await page.route(/^https:\/\/(www\.)?youtube(-nocookie)?\.com\/(?!iframe_api).*/, (route) => route.abort());
  await page.route(/^https:\/\/i\.ytimg\.com\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
  );
}

type StubWindow = {
  __ytStub?: {
    counters: YTStubCounters;
    fireReady(): void;
    fireError(code: number): void;
    fireStateChange(state: number): void;
    fireAutoplayBlocked(): void;
    info(): YTStubPlayerInfo[];
    sameIframe(): boolean;
  };
};

export class YouTubeStub {
  constructor(private readonly page: Page) {}

  install(opts?: InstallOptions) {
    return installYouTubeStub(this.page, opts);
  }

  /** Чекає, поки створено хоча б `n` плеєрів. */
  async waitForPlayer(n = 1, timeout = 10_000): Promise<void> {
    await this.page.waitForFunction(
      (min) => ((window as unknown as StubWindow).__ytStub?.counters.created ?? 0) >= min,
      n,
      { timeout },
    );
  }

  counters(): Promise<YTStubCounters> {
    return this.page.evaluate(
      () =>
        (window as unknown as StubWindow).__ytStub?.counters ?? {
          created: 0,
          loadVideoById: 0,
          loadedIds: [],
          unMute: 0,
          destroyed: 0,
        },
    );
  }

  players(): Promise<YTStubPlayerInfo[]> {
    return this.page.evaluate(() => (window as unknown as StubWindow).__ytStub?.info() ?? []);
  }

  /** `data-stub-id` поточного iframe у хості плеєра. */
  iframeId(): Promise<string | null> {
    return this.page.evaluate(
      () => document.querySelector<HTMLIFrameElement>('[data-player-host] iframe[data-yt-stub]')?.dataset.stubId ?? null,
    );
  }

  /** Той самий вузол iframe, що й першого разу, досі в документі і він один (SC-003). */
  sameIframe(): Promise<boolean> {
    return this.page.evaluate(() => (window as unknown as StubWindow).__ytStub?.sameIframe() ?? false);
  }

  fireReady() {
    return this.page.evaluate(() => (window as unknown as StubWindow).__ytStub?.fireReady());
  }

  fireError(code: number) {
    return this.page.evaluate((c) => (window as unknown as StubWindow).__ytStub?.fireError(c), code);
  }

  fireStateChange(state: number) {
    return this.page.evaluate((s) => (window as unknown as StubWindow).__ytStub?.fireStateChange(s), state);
  }

  fireEnded() {
    return this.fireStateChange(0);
  }

  fireAutoplayBlocked() {
    return this.page.evaluate(() => (window as unknown as StubWindow).__ytStub?.fireAutoplayBlocked());
  }
}

/** `test` з фікстурою `ytStub`: заглушка встановлена до першого `page.goto`. */
export const test = base.extend<{ ytStub: YouTubeStub }>({
  ytStub: async ({ page }, provide) => {
    const stub = new YouTubeStub(page);
    await stub.install();
    await provide(stub);
  },
});

export { expect } from '@playwright/test';
