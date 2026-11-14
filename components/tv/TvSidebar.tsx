'use client';

/**
 * TvSidebar (C22, дошка `TV-Party-New`, рішення 2026-11-06): права колонка режиму вечірки. Дані ефіру лише читає з `useBroadcast()`.
 *
 * Закріплені частини (без прокрутки — на ТВ її не видно й незручно): логотип і годинник · відлік «до півночі» (поки до події
 * > 5 хв) · «Зараз: Лондон · Вебкамера ● Наживо» і «Змінити трансляцію» · вкладки «Як святкувати · Рейтинг» · одна область
 * вмісту · «Що показувати» (Усе свято / Мій графік) · «Звук · На весь екран · Вийти».
 *
 * Стани колонки:
 * - `live`: як вище; перший захід — замість вкладок пояснення режиму (`TvWelcome`), «Змінити трансляцію» — список трансляцій поясу;
 * - `scene` (на місці плеєра сцена відліку): великого відліку тут немає, «Зараз: Кабо-Верде · Лише відлік» і одна підказка —
 *   найближча трансляція наживо з «Перемкнути»;
 * - `moment` (з «+15 с» до передачі ефіру): «<Країна> зустріла Новий рік» і штамп з QR сам.
 * Чату немає. На відео нічого немає. Вкладку й привітання «Першого ряду» прибрано разом із рядом (рішення 2026-11-12).
 */
import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type Ref } from 'react';
import { HowToCard } from '@/components/live/HowToCard';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Countdown } from '@/components/primitives/Countdown';
import { Icon } from '@/components/primitives/Icon';
import { Logo } from '@/components/primitives/Logo';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { useStampOf } from '@/lib/api/hooks/passport';
import { useLiveData, useStreamChains } from '@/lib/api/hooks/live';
import type { PlayerSource } from '@/lib/player/types';
import type { Ms } from '@/lib/data/types';
import { HANDOVER_AFTER, LAST_MINUTE_FROM } from '@/lib/engine/config';
import { joinNamesUk, metPhrase } from '@/lib/engine/metPhrase';
import { formatClock, formatShortCountdown } from '@/lib/i18n/time';
import type { StreamRowData } from '@/lib/live/countryData';
import { useBroadcast, type AirPlace } from '@/lib/player/BroadcastController';
import { useOptionalPlayer, useOptionalPlayerActions } from '@/lib/player/PlayerProvider';
import { useNow } from '@/lib/time/TimeProvider';
import { nearestLive, zoneLiveRows } from '@/lib/tv/tvData';
import { useOnline } from '@/lib/tv/useTvEnv';
import { useTvPrefs } from '@/stores/tv';
import { TvControlBar } from './TvControlBar';
import { TvRatingTab } from './TvRatingTab';
import { TvNearest, TvNoPass, TvNow, TvShowSwitch, TvStreamsNow, TvWelcome } from './TvPanels';
import { TvStampCard } from './TvStampCard';
import styles from './tv.module.css';
import { useHasPass, useSchedule } from '@/lib/api/hooks/auth';

/** Відлік у колонці показуємо, поки до події більше 5 хвилин (EXPERIENCE S-TV). */
export const COUNTDOWN_UNTIL_MS = 5 * 60_000;

export type TvSidebarMode = 'loading' | 'over' | 'live' | 'scene' | 'moment';

/** Що в області вмісту: вкладки, список трансляцій поясу. */
export type TvPanel = 'tabs' | 'streams';

/** Режим колонки за ефіром і часом (чиста функція — тестується окремо). */
export function sidebarMode(input: { ready: boolean; current: AirPlace | null; momentFired: boolean; view: string | undefined }): TvSidebarMode {
  if (!input.ready) return 'loading';
  if (!input.current) return 'over';
  if (input.momentFired) return 'moment';
  return input.view === 'stream' ? 'live' : 'scene';
}

function Header({ now }: { now: Ms }) {
  const t = useTranslations('tv');
  const th = useTranslations('header');
  const locale = useLocale();
  const clock = useNow({ granularity: 'minute' });
  return (
    <div className="flex items-center gap-3">
      <Logo variant="tv" label={th('logoLabel')} />
      <span className="flex-1" />
      {/* «Про режим» (власник 2026-11-06): що це й як увімкнути — сторінка сайту `/tv-info/`. */}
      <NextLink href="/tv-info/" aria-label={t('infoLinkLabel')} data-action="tv-info" className={cn('t2f-focus t2f-transition', styles.infoChip)}>
        <Icon name="info" size={16} />
        {t('infoLink')}
      </NextLink>
      <span className={styles.clock} data-tv-clock="">
        {clock > 0 || now > 0 ? t('clock', { time: formatClock(clock || now, { locale }) }) : null}
      </span>
    </div>
  );
}

function MetPhrase({ place }: { place: AirPlace }) {
  const tMet = useTranslations('met');
  if (!place.country) return null;
  const p = metPhrase(place.country);
  const text = p.kind === 'single' ? tMet('single', p.params) : p.kind === 'multi' ? tMet('multi', { names: joinNamesUk(p.params.names) }) : tMet('fallback', p.params);
  return (
    <div role="status" data-tv-met="" className={styles.met}>
      {text}
    </div>
  );
}

/** «Подивитися північ ще раз» (після події, якщо джерело дає повтор). Окремий вигляд — для історій. */
export function TvReplayButton({ onClick }: { onClick?: () => void }) {
  const t = useTranslations('tv');
  return (
    <Button variant="secondary" size="tv" iconLeft="play" data-action="watch-again" onClick={onClick} className="self-start">
      {t('watchAgain')}
    </Button>
  );
}

function ReplayButton({ place }: { place: AirPlace }) {
  const player = useOptionalPlayer();
  const actions = useOptionalPlayerActions();
  const selection = player?.selection;
  const chains = useStreamChains();
  const source = selection && selection.kind !== 'countdown-scene' ? chains.get(place.event.id)?.sources.find((s) => s.id === selection.source.id) : undefined;
  const replay = source?.replay;
  if (!source || !replay?.videoId) return null;
  const watchAgain = () => {
    const src: PlayerSource = {
      id: `${source.id}:replay`,
      platform: 'youtube',
      videoId: replay.videoId,
      url: replay.url,
      order: 0,
      status: 'live',
      embeddable: true,
      isLive: true,
      alwaysOn: true,
    };
    actions?.setChain({ eventId: place.event.id, sources: [src] });
  };
  return <TvReplayButton onClick={watchAgain} />;
}

export interface TvSidebarProps {
  /** Примусово задати стан мережі (історії); за замовчуванням — `navigator.onLine`. */
  online?: boolean;
  /** «На весь екран»: лише відео чи відлік (`TvScreen`). */
  onFullscreen?: () => void;
  panel?: TvPanel;
  onPanelChange?: (panel: TvPanel) => void;
  /** Гість натиснув календарик без пасу — показати картку «Мій графік». */
  askPass?: boolean;
  /** «Змінити трансляцію»: куди повернути фокус, коли список закрили. */
  changeRef?: Ref<HTMLButtonElement>;
  className?: string;
}

export function TvSidebar({ online: onlineProp, onFullscreen, panel = 'tabs', onPanelChange, askPass = false, changeRef, className }: TvSidebarProps) {
  const t = useTranslations('tv');
  const tp = useTranslations('player');
  const tFlash = useTranslations('states');
  const locale = useLocale();
  const broadcast = useBroadcast();
  const { ready, phase, current, next, air, watching, watch } = broadcast;
  const now = useNow();
  const stampId = (watching ?? current)?.event.id;
  const stamp = useStampOf(stampId);
  const hasPass = useHasPass();
  const scheduleCount = useSchedule().length;
  const show = useTvPrefs((s) => s.show);
  const setShow = useTvPrefs((s) => s.setShow);
  const welcomed = useTvPrefs((s) => s.welcomed);
  const setWelcomed = useTvPrefs((s) => s.setWelcomed);
  const player = useOptionalPlayer();
  const actions = useOptionalPlayerActions();
  const detectedOnline = useOnline();
  const online = onlineProp ?? detectedOnline;
  const [tab, setTab] = useState('how');

  // Обрана вручну трансляція: момент «… зустріла Новий рік» — за її північчю, а не за північчю ефіру.
  const watchedSince = watching ? now - watching.event.midnightMs : null;
  const momentFired = watchedSince !== null ? watchedSince >= 0 && watchedSince < HANDOVER_AFTER : (phase?.flags.momentFired ?? false);
  const mode = sidebarMode({ ready, current, momentFired, view: watching ? 'stream' : air?.view });
  const data = useLiveData();
  const minute = Math.floor(now / 60_000) * 60_000;
  // Одне джерело для колонки: обрана вручну трансляція, інакше подія ефіру. Відлік, місто, «Як святкувати» й підпис
  // «північ о …» — того місця, яке зараз на екрані (перевірка сайту 2026-11-09, B14 / A-19).
  const focus = watching ?? current;
  const midnightMs = focus?.event.midnightMs ?? 0;
  const untilMs = midnightMs - now;

  const zoneId = current?.event.zoneId ?? null;
  const liveRows = useMemo(() => (zoneId && ready ? zoneLiveRows(data, zoneId, minute) : []), [data, zoneId, minute, ready]);
  const nearest = useMemo(() => (mode === 'scene' && current ? nearestLive(data, current.event.midnightMs, minute) : null), [data, mode, current, minute]);
  const playingId = player?.selection && player.selection.kind !== 'countdown-scene' ? player.selection.source.id : null;

  const hasVideo = !!player?.videoId;
  const muted = player?.muted ?? true;
  const sinceMidnight = now - midnightMs;
  const lastMinute = mode === 'moment' && sinceMidnight >= LAST_MINUTE_FROM && sinceMidnight < HANDOVER_AFTER;
  const city = focus?.city?.name.uk ?? focus?.country?.name.uk ?? '';
  const mineReady = hasPass && scheduleCount > 0;

  const watchRow = (row: StreamRowData) => {
    // Трансляція поточної події ефіру — це просто ефір: повертаємося до автопілота.
    const onAir = current && row.eventId === current.event.id && air?.source?.id === row.id;
    watch(onAir ? null : { eventId: row.eventId, sourceId: row.id });
    onPanelChange?.('tabs');
  };

  const tabs = (
    <Tabs value={tab} onValueChange={setTab} variant="tv" className={styles.tabs}>
      <TabsList aria-label={t('tabsLabel')}>
        <TabsTrigger value="how">
          <Icon name="party" size={22} />
          {t('howTo')}
        </TabsTrigger>
        <TabsTrigger value="rating">
          <Icon name="star" size={22} />
          {t('rating')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="how" className={styles.panel} data-tv-panel="how">
        {focus?.country && focus.country.howTo.traditions.length ? (
          <HowToCard country={focus.country.name.uk} traditions={focus.country.howTo.traditions.slice(0, 3)} variant="tv" headingLevel="h2" className={styles.how} />
        ) : (
          <p className="text-text-secondary">{t('howToEmpty')}</p>
        )}
      </TabsContent>
      <TabsContent value="rating" className={styles.panel} data-tv-panel="rating">
        <TvRatingTab now={now} />
      </TabsContent>
    </Tabs>
  );

  let content;
  if (!welcomed) content = <TvWelcome onDone={() => setWelcomed(true)} />;
  else if (panel === 'streams' && mode === 'live') {
    content = <TvStreamsNow rows={liveRows} playingId={playingId} onWatch={watchRow} onClose={() => onPanelChange?.('tabs')} />;
  } else if (askPass || (show === 'mine' && !mineReady)) content = <TvNoPass hasPass={hasPass} />;
  else content = tabs;

  let body;
  if (mode === 'loading') {
    body = <p className="text-text-secondary">{t('loading')}</p>;
  } else if (mode === 'over' || !current) {
    body = <p className="text-highlight">{t('festOver')}</p>;
  } else if (mode === 'moment') {
    body = (
      <>
        <MetPhrase place={focus ?? current} />
        {lastMinute && next ? (
          <p className="text-text-secondary" data-tv-next-in="">
            {t('nextIn', { time: formatShortCountdown(HANDOVER_AFTER - sinceMidnight) })} · {t('nextUp', { place: next.city?.name.uk ?? '' })}
          </p>
        ) : null}
        {stamp && (focus ?? current).country ? (
          <TvStampCard
            eventId={stamp.eventId}
            city={stamp.cityName || city}
            countryName={(focus ?? current).country!.name.uk}
            flagCode={(focus ?? current).country!.flagCode}
            illustrationId={stamp.illustrationId}
          />
        ) : null}
        <ReplayButton place={focus ?? current} />
      </>
    );
  } else {
    const place = focus ?? current;
    const watchingTitle = watching?.sourceId ? data.chainsByEventId.get(watching.event.id)?.sources.find((s) => s.id === watching.sourceId)?.title.uk : undefined;
    const showCountdown = untilMs > COUNTDOWN_UNTIL_MS && mode === 'live';
    const showLine = !showCountdown && mode === 'live';
    body = (
      <>
        {showCountdown ? (
          <div className={styles.countdown} data-tv-countdown="">
            <span className={styles.countdownLabel} aria-hidden="true">
              {t('untilMidnight')}
            </span>
            <Countdown target={midnightMs} variant="tv" label={t('countdownTitle', { city })} />
          </div>
        ) : showLine ? (
          <p className="text-text-secondary" data-tv-midnight-at="">
            {tp('lineBefore', { country: place.country?.name.uk ?? city, time: formatClock(midnightMs, { locale }) })}
          </p>
        ) : null}
        <TvNow
          place={place}
          stream={mode === 'live'}
          title={watchingTitle}
          canChange={liveRows.length > 1 || (!!watching && liveRows.length > 0)}
          onChange={() => onPanelChange?.('streams')}
          changeRef={changeRef}
        />
        {mode === 'scene' && nearest ? <TvNearest row={nearest} onWatch={watchRow} /> : null}
        <div className={styles.content}>{content}</div>
      </>
    );
  }

  return (
    <aside
      aria-label={mode === 'moment' ? t('momentLabel') : t('sidebarLabel')}
      data-tv-sidebar=""
      data-tv-mode={mode}
      className={cn(styles.sidebar, className)}
    >
      <Header now={now} />
      <div className={styles.sidebarBody}>{body}</div>
      <div className="flex flex-col gap-3">
        {online ? null : (
          <p role="status" data-tv-offline="" className="text-highlight">
            {tFlash('offline')}
          </p>
        )}
        {mode === 'loading' || mode === 'over' ? null : (
          <>
            <TvShowSwitch show={show} onChange={setShow} />
            {show === 'mine' && mineReady ? (
              <p className={styles.note} data-tv-mine-note="">
                {t('mineNote', { count: scheduleCount })}
              </p>
            ) : null}
          </>
        )}
        <TvControlBar muted={muted} available={hasVideo} onToggleSound={() => (muted ? actions?.unmute() : actions?.mute())} onFullscreen={onFullscreen} />
      </div>
    </aside>
  );
}
