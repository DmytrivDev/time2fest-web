'use client';

/**
 * TvScreen (S-TV, C22, дошка `TV-Party-New`): склад сторінки `/tv` — ліворуч відео 16:9, «Прогрес свята» і таймлайн
 * (завжди відкритий), праворуч `TvSidebar`. Хедера, футера й чату немає; на відео нічого немає.
 * На телефоні режиму вечірки немає — перехід на інформаційну сторінку сайту `/tv-info/` (`TvPhoneInfo`, рішення 2026-11-06):
 * там шапка, чат і решта сайту, а відео не вантажиться.
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
 * Компактний таймлайн (власник 2026-11-06): коли вікно ширше за 16:9 і відео на всю ширину колонки не влазить по висоті
 * (`data-roomy`), картки таймлайну — лише місто й календарик, а відео більше; ліва колонка тоді рівно такої ширини, як
 * відео (`tvLeftWidth`), — відео на рівні із заголовком і фільтром таймлайну, решту ширини бере права колонка. Людина перейшла до таймлайну (`data-tl-active`) —
 * картки повні, відео нижче й вужче, стоїть по центру місця для відео (сіра рамка на всю ширину). Сцена відліку не звужується,
 * лише стає нижчою. На екрані 16:9 відео й повний таймлайн влазять і так — нічого не змінюється.
 *
 * «На весь екран» (власник 2026-11-06): лише відео чи сцена відліку на весь екран — без колонки й таймлайну; повноекранний
 * режим браузера вмикаємо разом (якщо браузер дозволив). «Назад» / Esc — назад до звичайного вигляду.
 */
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { eventTitle } from '@/components/live/Caption';
import { PHONE_QUERY, useMedia } from '@/lib/hooks/useMedia';
import { FacebookConsentCard } from '@/components/player/FacebookConsentCard';
import { PlayerSlot } from '@/components/player/PlayerSlot';
import { cn } from '@/components/primitives/cn';
import { Skeleton } from '@/components/primitives/Skeleton';
import { useLiveData } from '@/lib/api/hooks/live';
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
import { TvScene } from './TvScene';
import { TvSidebar, type TvPanel } from './TvSidebar';
import { TvTimeline } from './TvTimeline';
import type { TvCardAction } from './TvTimelineCard';
import styles from './tv.module.css';

/** Телефон: інформаційна сторінка замість режиму вечірки. `null` — ще невідомо (статичний рендер і гідратація). */
function useIsPhone(): boolean | null {
  return useMedia(PHONE_QUERY, null);
}

/** Розмір макета дошки, під який зверстано екран. */
export const TV_DESIGN_W = 1920;
export const TV_DESIGN_H = 1080;

/** Поля лівої колонки по вертикалі й по горизонталі (tv.module.css: .left). */
const LEFT_PAD_V = 60;
const LEFT_PAD_H = 64;
/** Висота таймлайну з відступом зверху: повного й компактного (картки 156 і 66 px; .timeline, .strip, .hintRow). */
const TIMELINE_FULL_H = 353;
const TIMELINE_COMPACT_H = 263;
/** Кілька пікселів нестачі не роблять вікно «просторим»: на 16:9 відео лише трохи вужче, розкладка — як на дошці. */
const ROOMY_TOLERANCE = 16;

/** Чи відео на всю ширину лівої колонки (65 %) не влазить по висоті поруч із повним таймлайном. */
export function tvRoomy(width: number, height: number): boolean {
  const inner = width * 0.65 - LEFT_PAD_H;
  return (inner * 9) / 16 > height - LEFT_PAD_V - TIMELINE_FULL_H + ROOMY_TOLERANCE;
}

/** Ширина лівої колонки на просторому вікні: відео над компактним таймлайном займає її всю. */
export function tvLeftWidth(height: number): number {
  return ((height - LEFT_PAD_V - TIMELINE_COMPACT_H) * 16) / 9 + LEFT_PAD_H;
}

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
      const roomy = tvRoomy(width, height);
      el.toggleAttribute('data-roomy', roomy);
      el.style.setProperty('--tv-cols', roomy ? `${tvLeftWidth(height)}px minmax(0, 1fr)` : '65fr 35fr');
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
  const router = useRouter();
  // Плеєр на `/tv` стоїть на паузі, поки не відомо, що це не телефон (`BroadcastController`).
  useEffect(() => {
    if (phone !== null) suspend(phone);
    // Машина часу (`?t=`) переходить разом зі сторінкою.
    if (phone) router.replace(`/tv-info/${window.location.search}`);
  }, [phone, suspend, router]);
  if (phone !== false) return null;
  return <TvParty {...props} />;
}

function TvParty({ online, full: fullProp = false }: TvScreenProps) {
  const t = useTranslations('tv');
  const router = useRouter();
  const { ready, current, air, watching, watch, setPrefer } = useBroadcast();
  const now = useNow();
  const schedule = useGuestStore((s) => s.schedule);
  const hasPass = useGuestStore((s) => s.hasPass);
  const show = useTvPrefs((s) => s.show);
  const rootRef = useRef<HTMLDivElement>(null);
  useTvScale(rootRef);
  const changeRef = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState<TvPanel>('tabs');
  const [full, setFull] = useState(fullProp);
  const [timelineActive, setTimelineActive] = useState(false);

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

  // Присутність для штампа: подія того, що на екрані — обраної вручну трансляції, інакше слота ефіру
  // (2026-11-09: опівночі Парижа з обраним Лондоном штамп Парижа не нараховується).
  const eventId = current?.event.id ?? null;
  const shownId = watching?.event.id ?? eventId;
  useStampGrant(shownId ? { source: 'tv', eventIds: [shownId] } : null);

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
    return false;
  }, [full, leaveFull, panel]);
  useRemoteKeys({ rootRef, onExit: exit, onBack: back, ready });

  const data = useLiveData();
  const minute = Math.floor(now / 60_000) * 60_000;
  const items = useMemo(() => tvTimeline(data, minute, schedule), [data, minute, schedule]);
  const fest = useMemo(() => festProgress(data, minute), [data, minute]);
  const onAirId = watching?.event.id ?? eventId;

  // Графік у режимі вечірки лише показується: додають і прибирають на телефоні чи комп’ютері (рішення власника
  // 2026-11-06). OK на картці наживо — дивитися; на решті — нічого.
  const actionFor = useCallback(
    (it: TvTimelineItem): TvCardAction => (it.stream === 'live' && it.id !== onAirId && !isPastStatus(it.status) ? 'watch' : 'none'),
    [onAirId],
  );
  const onActivate = useCallback(
    (it: TvTimelineItem) => {
      if (actionFor(it) !== 'watch') return;
      watch(it.id === eventId ? null : { eventId: it.id, sourceId: it.liveSourceId });
    },
    [actionFor, watch, eventId],
  );

  const city = (watching ?? current)?.city?.name.uk;
  const stream = !!watching || air?.view === 'stream';
  const heading = !city ? t('pageHeadingNone') : stream ? t('pageHeading', { place: city }) : t('pageHeadingScene', { place: city });

  return (
    <div className={styles.stage}>
      <div ref={rootRef} data-surface="tv" data-full={full ? '' : undefined} data-tl-active={timelineActive ? '' : undefined} data-video={stream ? '' : undefined} className={cn(styles.root)} data-tv-root="">
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
            onActiveChange={setTimelineActive}
          />
        </main>
        <TvSidebar online={online} onFullscreen={enterFull} panel={panel} onPanelChange={setPanel} changeRef={changeRef} />
      </div>
    </div>
  );
}
