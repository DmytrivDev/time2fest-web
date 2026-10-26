'use client';

/**
 * PlayerProvider (ІНВ 4.1, research.md 3): тримає один екземпляр YouTube IFrame API на весь сеанс
 * `(live)`-макета, поточне джерело ланцюжка, `muted` і «людина вмикала звук у цьому сеансі».
 * Сторінки не рендерять плеєр: вони ставлять `PlayerSlot`, а `PlayerHost` сідає над ним.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { emit } from '@/lib/events/bus';
import { useNow, useTimeSource } from '@/lib/time/TimeProvider';
import { advanceChain, consentEventFor, selectSource, type ChainCause } from './chain';
import type { ChainSelection, PlayerSlotId, PlayerSource, PlayerSourceSwitched } from './types';
import { createYouTubePlayer, YTState, type YouTubePlayerHandle } from './youtubeApi';

const SOUND_KEY = 't2f:session:soundEnabled';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'autoplay-blocked';

export interface PlayerChainInput {
  eventId: string;
  sources: readonly PlayerSource[];
  /**
   * Вибране людиною джерело (сторінка країни, дотик до рядка трансляції): береться першим, якщо придатне
   * й не позначене недоступним; інакше — звичайний порядок ланцюжка.
   */
  preferredSourceId?: string;
}

export interface PlayerState {
  eventId: string | null;
  /** `null` — ланцюжок ще не задано (сторінка без ефіру або дані не завантажені). */
  selection: ChainSelection | null;
  /** Відео, яке зараз має грати хост (YouTube); `null` — хост схований. */
  videoId: string | null;
  status: PlayerStatus;
  muted: boolean;
  soundEnabledInSession: boolean;
  lastSwitch: PlayerSourceSwitched | null;
}

export interface PlayerActions {
  /** Задати ланцюжок події. Той самий `eventId` і ті самі джерела — нічого не змінює. */
  setChain(input: PlayerChainInput | null): void;
  /** `GuestState.consent.facebookVideo` (пише стор гостя; тут лише перерахунок вибору). */
  setFacebookConsent(granted: boolean): void;
  /** Лише в обробнику жесту користувача. */
  unmute(): void;
  mute(): void;
  /** Кнопка «Грати» після `onAutoplayBlocked`. */
  play(): void;
  pause(): void;
  /** Фактичний стан звуку плеєра (кнопка звуку YouTube теж його змінює); кімната стежить, щоб звук був в одному вікні. */
  isMuted(): boolean;
}

interface PlayerInternals {
  slotElement: HTMLElement | null;
  /** Повертає функцію зняття реєстрації (лише свого елемента). */
  registerSlot(id: PlayerSlotId, el: HTMLElement): () => void;
  /** Хост віддає свій контейнер; повертає функцію від’єднання (Strict Mode-безпечну). */
  attachHost(host: HTMLElement): () => void;
}

const StateContext = createContext<PlayerState | null>(null);
const ActionsContext = createContext<PlayerActions | null>(null);
const InternalsContext = createContext<PlayerInternals | null>(null);

function readSoundFlag(): boolean {
  try {
    return sessionStorage.getItem(SOUND_KEY) === '1';
  } catch {
    return false;
  }
}

const noopSubscribe = () => () => {};

function writeSoundFlag(): void {
  try {
    sessionStorage.setItem(SOUND_KEY, '1');
  } catch {
    // без збереження
  }
}

function sameSources(a: readonly PlayerSource[], b: readonly PlayerSource[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => {
    const o = b[i];
    return !!o && s.id === o.id && s.videoId === o.videoId && s.order === o.order && s.embeddable === o.embeddable && s.isLive === o.isLive && s.status === o.status && s.startsAt === o.startsAt;
  });
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const time = useTimeSource();
  const timeRef = useRef(time);
  useLayoutEffect(() => {
    timeRef.current = time;
  }, [time]);
  const now = useCallback(() => timeRef.current.now(), []);

  const [chain, setChainState] = useState<PlayerChainInput | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [facebookConsent, setFacebookConsentState] = useState(false);
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [muted, setMuted] = useState(true);
  const [unmutedHere, setUnmutedHere] = useState(false);
  // sessionStorage читаємо без розбіжності гідратації: на сервері й під час гідратації — false.
  const soundFlag = useSyncExternalStore(noopSubscribe, readSoundFlag, () => false);
  const soundEnabledInSession = soundFlag || unmutedHere;
  const [lastSwitch, setLastSwitch] = useState<PlayerSourceSwitched | null>(null);
  const [slotElement, setSlotElement] = useState<HTMLElement | null>(null);
  const [hostElement, setHostElement] = useState<HTMLElement | null>(null);

  const handleRef = useRef<YouTubePlayerHandle | null>(null);
  const creatingRef = useRef(false);
  const destroyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slotsRef = useRef(new Map<PlayerSlotId, HTMLElement>());

  const chainRef = useRef<PlayerChainInput | null>(null);

  // Очікувані джерела (`startsAt`) стають придатними самі: ключ змінюється, щойно настає `startsAt` котрогось із них,
  // і вибір перераховується без перезавантаження (US2 acc.2). Провайдер перерендерюється щосекунди, але значення
  // контекстів мемоізовані — діти не перерендерюються.
  const clockNow = useNow();
  const startedKey = useMemo(() => {
    if (!chain) return '';
    return chain.sources
      .filter((s) => s.startsAt !== undefined && Date.parse(s.startsAt) <= clockNow)
      .map((s) => s.id)
      .join('|');
  }, [chain, clockNow]);

  // Вибір джерела: зміна ланцюжка, згоди, списку недоступних чи початок очікуваного джерела.
  const selection = useMemo<ChainSelection | null>(() => {
    void startedKey;
    if (!chain) return null;
    const ctx = { slot: 'main' as const, eventId: chain.eventId, sources: chain.sources, failed, facebookConsent, now: time.now() };
    const preferred = chain.preferredSourceId ? chain.sources.find((s) => s.id === chain.preferredSourceId) : undefined;
    if (preferred && !failed.includes(preferred.id)) {
      const picked = selectSource({ ...ctx, sources: [preferred] });
      if (picked.kind !== 'countdown-scene') return picked;
    }
    return selectSource(ctx);
  }, [chain, failed, facebookConsent, time, startedKey]);

  // Стан для обробників IFrame API (вони створюються один раз).
  const live = useRef({ chain, failed, facebookConsent, selection });
  useLayoutEffect(() => {
    live.current = { chain, failed, facebookConsent, selection };
  }, [chain, failed, facebookConsent, selection]);

  // Facebook — єдине придатне джерело, згоди немає → подія для PlayerBlock (картка на місці плеєра).
  useEffect(() => {
    if (!chain || !selection) return;
    const consent = consentEventFor({ slot: 'main', eventId: chain.eventId, now: now() }, selection);
    if (consent) emit('player:facebook-consent-required', consent);
  }, [chain, selection, now]);

  const handleBreak = useCallback(
    (cause: ChainCause) => {
      const { chain: c, failed: f, facebookConsent: fbc, selection: sel } = live.current;
      if (!c || !sel || sel.kind !== 'source') return;
      const t = advanceChain(
        { slot: 'main', eventId: c.eventId, sources: c.sources, failed: f, facebookConsent: fbc, now: now() },
        { currentSourceId: sel.source.id, cause },
      );
      if (t.type === 'config-error') {
        console.error(
          '[player] YouTube помилка 153: немає Referer. Перевір Referrer-Policy (strict-origin-when-cross-origin у public/_headers). Джерело не перемикаємо.',
        );
        return;
      }
      if (t.type === 'ignored') return;
      setFailed(t.failed);
      setLastSwitch(t.switched);
      emit('player:source-switched', t.switched);
      // consentRequired емітує ефект перерахунку вибору вище.
    },
    [now],
  );

  const videoId = selection?.kind === 'source' && selection.source.platform === 'youtube' ? (selection.source.videoId ?? null) : null;
  // TODO(US1 T069): джерело Facebook зі згодою — власне вбудовування; зараз хост лишається схованим.

  // Створення одного плеєра й зміна відео через loadVideoById.
  useEffect(() => {
    if (!hostElement) return;
    const handle = handleRef.current;
    if (!videoId) {
      handle?.pause();
      if (handle) setStatus('paused');
      return;
    }
    if (handle) {
      handle.load(videoId);
      handle.play();
      return;
    }
    if (creatingRef.current) return;
    creatingRef.current = true;
    setStatus('loading');
    const mount = document.createElement('div');
    hostElement.appendChild(mount);
    createYouTubePlayer(mount, {
      videoId,
      handlers: {
        onReady: () => {
          const h = handleRef.current;
          if (!h) return;
          // Новий плеєр зі звуком лише якщо людина вже вмикала звук у цьому сеансі; блокування → без звуку.
          if (readSoundFlag()) {
            h.unMute();
            setMuted(h.isMuted());
          }
        },
        onStateChange: (state) => {
          if (state === YTState.PLAYING) setStatus('playing');
          else if (state === YTState.PAUSED) setStatus('paused');
          else if (state === YTState.ENDED) handleBreak({ type: 'ended' });
        },
        onError: (code) => handleBreak({ type: 'error', code }),
        onAutoplayBlocked: () => {
          const h = handleRef.current;
          if (h && !h.isMuted()) {
            h.mute();
            setMuted(true);
            h.play();
            return;
          }
          setStatus('autoplay-blocked');
        },
      },
    })
      .then((h) => {
        handleRef.current = h;
        // Поки вантажився API, ланцюжок міг змінитись.
        const sel = live.current.selection;
        const wanted = sel?.kind === 'source' ? sel.source.videoId : undefined;
        if (wanted) h.load(wanted);
      })
      .catch((err: unknown) => {
        console.error('[player]', err);
        setStatus('idle');
      })
      .finally(() => {
        creatingRef.current = false;
      });
  }, [hostElement, videoId, handleBreak]);

  // Розмонтування всього макета — єдине місце, де плеєр знищується.
  useEffect(
    () => () => {
      if (destroyTimer.current) clearTimeout(destroyTimer.current);
      handleRef.current?.destroy();
      handleRef.current = null;
    },
    [],
  );

  const actions = useMemo<PlayerActions>(
    () => ({
      setChain(input) {
        const prev = chainRef.current;
        if (!input) {
          if (prev) {
            chainRef.current = null;
            setChainState(null);
          }
          return;
        }
        if (prev && prev.eventId === input.eventId && prev.preferredSourceId === input.preferredSourceId && sameSources(prev.sources, input.sources)) return;
        if (!prev || prev.eventId !== input.eventId) {
          setFailed([]);
          setLastSwitch(null);
        } else if (input.preferredSourceId && input.preferredSourceId !== prev.preferredSourceId) {
          // Людина сама обрала джерело: даємо йому ще одну спробу й прибираємо повідомлення про автоперемикання.
          const id = input.preferredSourceId;
          setFailed((f) => (f.includes(id) ? f.filter((x) => x !== id) : f));
          setLastSwitch(null);
        }
        chainRef.current = input;
        setChainState(input);
      },
      setFacebookConsent(granted) {
        setFacebookConsentState(granted);
      },
      unmute() {
        const h = handleRef.current;
        if (!h) return;
        h.unMute();
        h.play();
        setMuted(false);
        setUnmutedHere(true);
        writeSoundFlag();
      },
      mute() {
        handleRef.current?.mute();
        setMuted(true);
      },
      play() {
        handleRef.current?.play();
      },
      pause() {
        handleRef.current?.pause();
      },
      isMuted() {
        return handleRef.current?.isMuted() ?? true;
      },
    }),
    [],
  );

  const registerSlot = useCallback((id: PlayerSlotId, el: HTMLElement) => {
    slotsRef.current.set(id, el);
    // Хост сидить над слотом `main` (мініплеєр і кімната — та сама позиція іншим місцем, US3/US5).
    setSlotElement(slotsRef.current.get('main') ?? null);
    return () => {
      if (slotsRef.current.get(id) === el) slotsRef.current.delete(id);
      setSlotElement(slotsRef.current.get('main') ?? null);
    };
  }, []);

  const attachHost = useCallback((host: HTMLElement) => {
    if (destroyTimer.current) {
      clearTimeout(destroyTimer.current);
      destroyTimer.current = null;
    }
    setHostElement(host);
    return () => {
      // Strict Mode викликає cleanup і одразу знову effect: відкладаємо, щоб не перестворювати iframe.
      destroyTimer.current = setTimeout(() => {
        destroyTimer.current = null;
        handleRef.current?.destroy();
        handleRef.current = null;
        setHostElement(null);
      }, 0);
    };
  }, []);

  const internals = useMemo<PlayerInternals>(
    () => ({ slotElement, registerSlot, attachHost }),
    [slotElement, registerSlot, attachHost],
  );

  const state = useMemo<PlayerState>(
    () => ({ eventId: chain?.eventId ?? null, selection, videoId, status, muted, soundEnabledInSession, lastSwitch }),
    [chain, selection, videoId, status, muted, soundEnabledInSession, lastSwitch],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <InternalsContext.Provider value={internals}>
        <StateContext.Provider value={state}>{children}</StateContext.Provider>
      </InternalsContext.Provider>
    </ActionsContext.Provider>
  );
}

function need<T>(v: T | null, name: string): T {
  if (!v) throw new Error(`${name}: потрібен <PlayerProvider> (app/(live)/layout.tsx)`);
  return v;
}

export function usePlayer(): PlayerState {
  return need(useContext(StateContext), 'usePlayer');
}

export function usePlayerActions(): PlayerActions {
  return need(useContext(ActionsContext), 'usePlayerActions');
}

/** Лише для PlayerSlot і PlayerHost. */
export function usePlayerInternals(): PlayerInternals {
  return need(useContext(InternalsContext), 'usePlayerInternals');
}

/** Без провайдера — `null` (історії Storybook, сторінки поза `(live)`): слот показує лише fallback. */
export function useOptionalPlayer(): PlayerState | null {
  return useContext(StateContext);
}

export function useOptionalPlayerInternals(): PlayerInternals | null {
  return useContext(InternalsContext);
}

/** Без провайдера — `null` (історії Storybook): кнопки плеєра нічого не роблять. */
export function useOptionalPlayerActions(): PlayerActions | null {
  return useContext(ActionsContext);
}
