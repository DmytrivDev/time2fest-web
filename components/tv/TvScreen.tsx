'use client';

/**
 * TvScreen (S-TV, C22, дошка `TV-Party-New`): склад сторінки `/tv` — ліворуч відео 16:9, «Прогрес свята» і таймлайн
 * (завжди відкритий), праворуч `TvSidebar`. Хедера, футера й чату немає; на відео нічого немає.
 * На телефоні режиму вечірки немає — інформаційна сторінка (`TvPhoneInfo`, рішення 2026-11-06).
 *
 * Дані ефіру — з `useBroadcast()` (один `BroadcastController` у макеті `app/tv/layout.tsx`): «Усе свято» — той самий ефір,
 * що головна; «Мій графік» — ефір бере події графіка (`setPrefer`); обрана з таймлайну чи «Змінити трансляцію» трансляція
 * грає до наступної передачі ефіру (`watch`). Плеєр — один `PlayerHost` макета над `PlayerSlot` цієї сторінки.
 * Сторінка реєструє присутність для штампа (`useStampGrant`, джерело `tv`): штамп з’являється в колонці сам.
 * Керування: стрілки, OK (Enter), «Назад»/Esc — спершу закриває список трансляцій чи картку пасу, потім вихід на головну.
 *
 * Пропорційний масштаб (власник 2026-11-06): екран зверстано під 1920 × 1080 (дошка `TV-Party-New`) і масштабується цілим
 * під будь-яке вікно (`useTvScale`): менший ноутбук чи 4K-телевізор бачать те саме. Зайве місце ширшого екрана дістається
 * правій колонці, вищого — таймлайну (без чорних смуг).
 *
 * «На весь екран» (власник 2026-11-06): лише відео чи сцена відліку на весь екран — без колонки й таймлайну; повноекранний
 * режим браузера вмикаємо разом (якщо браузер дозволив). «Назад» / Esc — назад до звичайного вигляду.
 */
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { eventTitle } from '@/components/live/Caption';
import { FacebookConsentCard } from '@/components/player/FacebookConsentCard';
import { PlayerSlot } from '@/components/player/PlayerSlot';
import { cn } from '@/components/primitives/cn';
import { Skeleton } from '@/components/primitives/Skeleton';
import { getData } from '@/lib/data/load';
import { isPastStatus } from '@/components/live/eventCards';
import { festProgress } from '@/lib/live/homeData';
import { useBroadcast, type AirPlace } from '@/lib/player/BroadcastController';
import { useOptionalPlayer } from '@/lib/player/PlayerProvider';
import { useStampGrant } from '@/lib/presence/useStampGrant';
import { useNow } from '@/lib/time/TimeProvider';
import { tvTimeline, type TvTimelineItem } from '@/lib/tv/tvData';
import { useRemoteKeys } from '@/lib/tv/useRemoteKeys';
import { useGuestStore } from '@/stores/guest';
import { useTvPrefs } from '@/stores/tv';
import { TvKeyHints } from './TvKeyHints';
import { TvPhoneInfo } from './TvPhoneInfo';
import { TvScene } from './TvScene';
import { TvSidebar, type TvPanel } from './TvSidebar';
import { TvTimeline } from './TvTimeline';
import type { TvCardAction } from './TvTimelineCard';
import styles from './tv.module.css';

/** Телефон: інформаційна сторінка замість режиму вечірки. */
const PHONE_QUERY = '(max-width: 767px)';

function subscribePhone(cb: () => void): () => void {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

/** `null` — ще невідомо (статичний рендер і гідратація). */
function useIsPhone(): boolean | null {
  return useSyncExternalStore<boolean | null>(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => null);
}

/** Розмір макета дошки, під який зверстано екран. */
export const TV_DESIGN_W = 1920;
export const TV_DESIGN_H = 1080;

/** Масштаб і розмір макета для вікна: макет цілий уміщується, зайве місце — ширині чи висоті макета. */
export function tvScale(viewW: number, viewH: number): { scale: number; width: number; height: number } {
  const scale = Math.min(viewW / TV_DESIGN_W, viewH / TV_DESIGN_H);
  return { scale, width: viewW / scale, height: viewH / scale };
}

/**
 * Ставить масштаб прямо на елемент (CSS-змінні) у тому самому обробнику `resize`, без рендеру React: хост плеєра
 * міряє слот у `ResizeObserver` документа вже з новим масштабом, тож відео не відстає від слоту.
 */
function useTvScale(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const { scale, width, height } = tvScale(window.innerWidth, window.innerHeight);
      el.style.setProperty('--tv-s', String(scale));
      el.style.setProperty('--tv-w', `${width}px`);
      el.style.setProperty('--tv-h', `${height}px`);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [ref]);
}

/** Що стоїть на місці плеєра, поки хост не показує відео. */
function PlayerFallback({ ready, current, view }: { ready: boolean; current: AirPlace | null; view: string | undefined }) {
  const setConsent = useGuestStore((s) => s.setConsent);
  const player = useOptionalPlayer();
  if (!ready || !current?.country) return <Skeleton variant="player" className="size-full" />;
  if (player?.selection?.kind === 'facebook-consent') {
    return <FacebookConsentCard onAllow={() => setConsent({ facebookVideo: true })} className="size-full" />;
  }
  return (
    <TvScene
      country={current.country}
      cityName={eventTitle(current.city)}
      midnightMs={current.event.midnightMs}
      variant={view === 'expected-scene' ? 'expected' : 'no-stream'}
    />
  );
}

export interface TvScreenProps {
  /** Примусово задати стан мережі (історії). */
  online?: boolean;
  /** Почати з «на весь екран» (історії). */
  full?: boolean;
}

export function TvScreen(props: TvScreenProps = {}) {
  const phone = useIsPhone();
  const { suspend } = useBroadcast();
  // Плеєр на `/tv` стоїть на паузі, поки не відомо, що це не телефон (`BroadcastController`).
  useEffect(() => {
    if (phone !== null) suspend(phone);
  }, [phone, suspend]);
  if (phone === null) return null;
  return phone ? <TvPhoneInfo /> : <TvParty {...props} />;
}

function TvParty({ online, full: fullProp = false }: TvScreenProps) {
  const t = useTranslations('tv');
  const router = useRouter();
  const { ready, current, air, watching, watch, setPrefer } = useBroadcast();
  const now = useNow();
  const schedule = useGuestStore((s) => s.schedule);
  const hasPass = useGuestStore((s) => s.hasPass);
  const toggleSchedule = useGuestStore((s) => s.toggleSchedule);
  const show = useTvPrefs((s) => s.show);
  const rootRef = useRef<HTMLDivElement>(null);
  useTvScale(rootRef);
  const changeRef = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState<TvPanel>('tabs');
  const [askPass, setAskPass] = useState(false);
  const [full, setFull] = useState(fullProp);

  const enterFull = useCallback(() => {
    setFull(true);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);
  const leaveFull = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[data-action="fullscreen"]')?.focus());
  }, []);
  // Браузер сам вийшов із повного екрана (Esc) — повертаємо звичайний вигляд.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const mineReady = hasPass && schedule.length > 0;
  // «Мій графік»: ефір бере подію слота з графіка (поза графіком — головна трансляція).
  useEffect(() => {
    setPrefer(show === 'mine' && mineReady ? schedule : null);
  }, [show, mineReady, schedule, setPrefer]);
  // Картка пасу після календарика — підказка, а не стан: ховається сама за 30 с (або «Назад»).
  useEffect(() => {
    if (!askPass) return;
    const id = setTimeout(() => setAskPass(false), 30_000);
    return () => clearTimeout(id);
  }, [askPass]);

  // Присутність для штампа: ТВ показує подію поточного слота ефіру.
  const eventId = current?.event.id ?? null;
  useStampGrant(eventId ? { source: 'tv', eventIds: [eventId] } : null);

  const exit = useCallback(() => router.push('/'), [router]);
  const back = useCallback(() => {
    if (full) {
      leaveFull();
      return true;
    }
    if (panel === 'streams') {
      setPanel('tabs');
      requestAnimationFrame(() => changeRef.current?.focus());
      return true;
    }
    if (askPass) {
      setAskPass(false);
      return true;
    }
    return false;
  }, [full, leaveFull, panel, askPass]);
  useRemoteKeys({ rootRef, onExit: exit, onBack: back, ready });

  const data = getData();
  const minute = Math.floor(now / 60_000) * 60_000;
  const items = useMemo(() => tvTimeline(data, minute, schedule), [data, minute, schedule]);
  const fest = useMemo(() => festProgress(data, minute), [data, minute]);
  const onAirId = watching?.event.id ?? eventId;

  const actionFor = useCallback(
    (it: TvTimelineItem): TvCardAction => {
      if (it.stream === 'live' && it.id !== onAirId) return 'watch';
      if (isPastStatus(it.status) || it.id === onAirId) return 'none';
      return it.inSchedule ? 'schedule-remove' : 'schedule-add';
    },
    [onAirId],
  );
  const onActivate = useCallback(
    (it: TvTimelineItem) => {
      const action = actionFor(it);
      if (action === 'watch') {
        watch(it.id === eventId ? null : { eventId: it.id, sourceId: it.liveSourceId });
        return;
      }
      if (!hasPass) {
        setAskPass(true);
        return;
      }
      toggleSchedule(it.id);
    },
    [actionFor, watch, eventId, hasPass, toggleSchedule],
  );

  const city = (watching ?? current)?.city?.name.uk;
  const stream = !!watching || air?.view === 'stream';
  const heading = !city ? t('pageHeadingNone') : stream ? t('pageHeading', { place: city }) : t('pageHeadingScene', { place: city });

  return (
    <div className={styles.stage}>
      <div ref={rootRef} data-surface="tv" data-full={full ? '' : undefined} className={cn(styles.root)} data-tv-root="">
        <main id="main" tabIndex={-1} className={cn(styles.left, 'outline-none')}>
          <h1 className="sr-only">{heading}</h1>
          <div className={styles.playerArea}>
            <PlayerSlot id="main" className={styles.playerSlot} fallback={<PlayerFallback ready={ready} current={current} view={air?.view} />} />
          </div>
          <TvTimeline
            items={items}
            onAirId={onAirId}
            dimOutside={show === 'mine' && mineReady}
            zonesDone={fest.zonesDone}
            zonesTotal={fest.zonesTotal}
            actionFor={actionFor}
            onActivate={onActivate}
            hints={<TvKeyHints />}
          />
        </main>
        <TvSidebar online={online} onFullscreen={enterFull} panel={panel} onPanelChange={setPanel} askPass={askPass} changeRef={changeRef} />
      </div>
    </div>
  );
}
