/**
 * Тонка обгортка над офіційним YouTube IFrame Player API (research.md 3).
 * - один `YT.Player` на контейнер, створюється один раз;
 * - зміна джерела — `loadVideoById`, не перестворення; той самий `videoId` — нічого не робить;
 * - автозапуск лише без звуку (`autoplay: 1, mute: 1, playsinline: 1`);
 * - `onAutoplayBlocked` → кнопка «Грати» (рішає UI);
 * - `unMute()` викликати лише всередині жесту користувача;
 * - плеєр — з `youtube-nocookie.com` (режим підвищеної приватності): YouTube не ставить cookies, доки людина не
 *   запустить відео; згода на cookies сайту для плеєра не потрібна (рішення 2026-11-02).
 */

/**
 * Завантажувач API — копія `https://www.youtube.com/iframe_api` з нашого домену (`scripts/sync_yt_loader.mjs`, оновлюється
 * перед кожною збіркою): оригінал на youtube.com ставить стежувальні cookies YouTube ще до згоди (рішення 2026-11-02).
 */
export const IFRAME_API_SRC = '/yt/iframe_api.js';
/** Домен самого плеєра (iframe): режим підвищеної приватності. */
export const PLAYER_HOST = 'https://www.youtube-nocookie.com';

/** Стани `onStateChange`. */
export const YTState = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

// --- Мінімальні типи офіційного API (лише те, що використовуємо) ---

interface YTEvent<T = unknown> {
  target: YTPlayer;
  data: T;
}

export interface YTPlayer {
  loadVideoById(videoId: string): void;
  cueVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getVolume?(): number;
  getPlayerState(): number;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
}

interface YTPlayerOptions {
  videoId?: string;
  width?: string | number;
  height?: string | number;
  host?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (e: YTEvent) => void;
    onStateChange?: (e: YTEvent<number>) => void;
    onError?: (e: YTEvent<number>) => void;
    onAutoplayBlocked?: (e: YTEvent) => void;
  };
}

export interface YTNamespace {
  Player: new (el: HTMLElement | string, opts: YTPlayerOptions) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace & { loaded?: number };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/** Завантажує `iframe_api` один раз на сторінку. */
export function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (typeof window === 'undefined') return Promise.reject(new Error('YouTube IFrame API: лише в браузері'));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('YouTube IFrame API: немає YT.Player'));
    };
    const script = document.createElement('script');
    script.src = IFRAME_API_SRC;
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error('YouTube IFrame API: не завантажився'));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

export interface YouTubePlayerHandlers {
  onReady?: () => void;
  onStateChange?: (state: number) => void;
  onError?: (code: number) => void;
  onAutoplayBlocked?: () => void;
}

export interface YouTubePlayerHandle {
  readonly videoId: string | null;
  /** Змінює відео без перестворення; той самий id — нічого не робить. */
  load(videoId: string): void;
  play(): void;
  pause(): void;
  mute(): void;
  /** Лише в обробнику жесту користувача (клік, клавіша). */
  unMute(): void;
  isMuted(): boolean;
  /** Чи справді чути: плеєр готовий, без mute і гучність > 0 (кнопки самого YouTube теж це змінюють). */
  isAudible(): boolean;
  getIframe(): HTMLIFrameElement | null;
  destroy(): void;
}

export interface CreatePlayerOptions {
  videoId?: string;
  /** `location.origin` — захист від перехоплення плеєра сторонніми скриптами. */
  origin?: string;
  /** Без автозапуску (вікна кімнати 2–4 після фасаду теж стартують від кліку). */
  autoplay?: boolean;
  handlers?: YouTubePlayerHandlers;
}

/**
 * Створює один `YT.Player` у `mount`. `mount` має бути вузлом, яким не керує React:
 * API замінює його на iframe.
 */
export async function createYouTubePlayer(mount: HTMLElement, opts: CreatePlayerOptions = {}): Promise<YouTubePlayerHandle> {
  const YT = await loadYouTubeIframeApi();
  const handlers = opts.handlers ?? {};
  let currentId: string | null = opts.videoId ?? null;
  let ready = false;
  let pending: string | null = null;
  let destroyed = false;

  const player = new YT.Player(mount, {
    width: '100%',
    height: '100%',
    host: PLAYER_HOST,
    ...(opts.videoId ? { videoId: opts.videoId } : {}),
    playerVars: {
      autoplay: opts.autoplay === false ? 0 : 1,
      mute: 1,
      playsinline: 1,
      rel: 0,
      origin: opts.origin ?? window.location.origin,
    },
    events: {
      onReady: () => {
        ready = true;
        if (pending && pending !== currentId) {
          currentId = pending;
          player.loadVideoById(pending);
        }
        pending = null;
        handlers.onReady?.();
      },
      onStateChange: (e) => handlers.onStateChange?.(e.data),
      onError: (e) => handlers.onError?.(e.data),
      onAutoplayBlocked: () => handlers.onAutoplayBlocked?.(),
    },
  });

  const safe = (fn: () => void) => {
    if (destroyed || !ready) return;
    fn();
  };

  return {
    get videoId() {
      return currentId;
    },
    load(videoId) {
      if (destroyed) return;
      if (!ready) {
        pending = videoId;
        return;
      }
      if (videoId === currentId) return;
      currentId = videoId;
      player.loadVideoById(videoId);
    },
    play: () => safe(() => player.playVideo()),
    pause: () => safe(() => player.pauseVideo()),
    mute: () => safe(() => player.mute()),
    unMute: () => safe(() => player.unMute()),
    isMuted: () => (ready && !destroyed ? player.isMuted() : true),
    isAudible: () => {
      if (!ready || destroyed) return false;
      try {
        if (player.isMuted()) return false;
        const vol = typeof player.getVolume === 'function' ? player.getVolume() : 100;
        return !(typeof vol === 'number' && vol <= 0);
      } catch {
        return false;
      }
    },
    getIframe: () => (ready && !destroyed ? player.getIframe() : null),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      player.destroy();
    },
  };
}
