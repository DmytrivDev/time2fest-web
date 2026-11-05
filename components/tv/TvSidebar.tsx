'use client';

/**
 * TvSidebar (C22): права колонка режиму вечірки — безпечна зона 96 / 54 px. Дані ефіру лише читає з `useBroadcast()`.
 *
 * Стани колонки:
 * - `live`: логотип і ваш час · відлік `Countdown tv` «до півночі» (поки до події > 5 хв; далі — «північ о … за вашим часом») ·
 *   «Зараз: Лондон · Головне святкування» + «Наживо» · вкладки `tv` «Далі | Як святкувати | Перший ряд»;
 * - `scene` (немає трансляції, на місці плеєра сцена відліку): «Найближчі трансляції» замість вкладок, «Як святкувати» — у сцені;
 * - `moment` (з «+15 с» до передачі ефіру): «<Країна> зустріла Новий рік» (`metPhrase`), штамп з QR сам, стіна «Першого ряду»
 *   загоряється; «Подивитися північ ще раз», якщо джерело дає повтор; на «+14 хв» — «далі через 0:59».
 * Унизу: смуга керування, «Трансляції феєрверків можуть містити спалахи», `offline`, підказка F11.
 * Чату немає. На відео нічого немає.
 */
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { HowToCard } from '@/components/live/HowToCard';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Countdown } from '@/components/primitives/Countdown';
import { Icon } from '@/components/primitives/Icon';
import { Logo } from '@/components/primitives/Logo';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { getData } from '@/lib/data/load';
import type { PlayerSource } from '@/lib/player/types';
import type { Ms } from '@/lib/data/types';
import { HANDOVER_AFTER, LAST_MINUTE_FROM } from '@/lib/engine/config';
import { joinNamesUk, metPhrase } from '@/lib/engine/metPhrase';
import { formatClock, formatShortCountdown } from '@/lib/i18n/time';
import { useBroadcast, type AirPlace } from '@/lib/player/BroadcastController';
import { useOptionalPlayer, useOptionalPlayerActions } from '@/lib/player/PlayerProvider';
import { useNow } from '@/lib/time/TimeProvider';
import { queueAfter, tvEvents } from '@/lib/tv/tvData';
import { useOnline } from '@/lib/tv/useTvEnv';
import { useGuestStore } from '@/stores/guest';
import { TvFirstRowTab, TvFirstRowWall, useTvFirstRow } from './TvFirstRowTab';
import { TvControlBar } from './TvControlBar';
import { TvFullscreenHint } from './TvKeyHints';
import { TvQueueCard } from './TvQueueCard';
import { TvStampCard } from './TvStampCard';
import styles from './tv.module.css';

/** Відлік у колонці показуємо, поки до події більше 5 хвилин (EXPERIENCE S-TV). */
export const COUNTDOWN_UNTIL_MS = 5 * 60_000;

export type TvSidebarMode = 'loading' | 'over' | 'live' | 'scene' | 'moment';

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
    <div className="flex items-center justify-between gap-3">
      <Logo variant="tv" label={th('logoLabel')} />
      <span className="text-tv-text text-text-secondary" data-tv-clock="">
        {clock > 0 || now > 0 ? t('clock', { time: formatClock(clock || now, { locale }) }) : null}
      </span>
    </div>
  );
}

const TYPE_KEY = { main: 'main', webcam: 'webcam', tv: 'tv', 'countdown-only': 'countdownOnly' } as const;

function NowOnAir({ place, stream }: { place: AirPlace; stream: boolean }) {
  const t = useTranslations('tv');
  const tType = useTranslations('liveCards.eventCard.type');
  const tBadge = useTranslations('primitives.badge');
  const type = stream ? tType(TYPE_KEY[place.event.type]) : null;
  const where = `${place.city?.name.uk ?? place.country?.name.uk ?? ''}${type ? ` · ${type}` : ''}`;
  return (
    <div className="flex flex-col items-start gap-2.5">
      <p className="text-tv-text text-text" data-tv-now="">
        {t('nowOnAir', { place: where })}
      </p>
      {stream ? (
        <Badge variant="live" size="tv" />
      ) : (
        <span className={styles.statusChip} data-tv-status="countdown-only">
          <Icon name="clock" size={22} />
          {tBadge('status.countdownOnly')}
        </span>
      )}
    </div>
  );
}

function MetPhrase({ place }: { place: AirPlace }) {
  const tMet = useTranslations('met');
  if (!place.country) return null;
  const p = metPhrase(place.country);
  const text = p.kind === 'single' ? tMet('single', p.params) : p.kind === 'multi' ? tMet('multi', { names: joinNamesUk(p.params.names) }) : tMet('fallback', p.params);
  return (
    <div role="status" data-tv-met="" className="text-headline-lg text-highlight">
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
  const source = selection && selection.kind !== 'countdown-scene' ? getData().chainsByEventId.get(place.event.id)?.sources.find((s) => s.id === selection.source.id) : undefined;
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
  /** Примусово задати стан повного екрана (історії); за замовчуванням — визначається в браузері. */
  fullscreen?: boolean;
  className?: string;
}

export function TvSidebar({ online: onlineProp, fullscreen, className }: TvSidebarProps) {
  const t = useTranslations('tv');
  const tp = useTranslations('player');
  const tFlash = useTranslations('states');
  const locale = useLocale();
  const broadcast = useBroadcast();
  const { ready, phase, current, next, air } = broadcast;
  const now = useNow();
  const schedule = useGuestStore((s) => s.schedule);
  const stamp = useGuestStore((s) => (current ? s.stamps.find((x) => x.eventId === current.event.id) : undefined));
  const player = useOptionalPlayer();
  const actions = useOptionalPlayerActions();
  const detectedOnline = useOnline();
  const online = onlineProp ?? detectedOnline;
  const [tab, setTab] = useState('next');

  const mode = sidebarMode({ ready, current, momentFired: phase?.flags.momentFired ?? false, view: air?.view });
  const data = getData();
  const minute = Math.floor(now / 60_000) * 60_000;
  const events = useMemo(() => tvEvents(data, minute, schedule), [data, minute, schedule]);
  const midnightMs = current?.event.midnightMs ?? 0;
  const untilMs = midnightMs - now;
  const firstRow = useTvFirstRow(now);

  const queue = useMemo(() => (current ? queueAfter(events, midnightMs, { onlyStreams: mode === 'scene' }) : []), [events, current, midnightMs, mode]);

  const hasVideo = !!player?.videoId;
  const paused = hasVideo && player?.status === 'paused';
  const muted = player?.muted ?? true;
  const sinceMidnight = now - midnightMs;
  const lastMinute = mode === 'moment' && sinceMidnight >= LAST_MINUTE_FROM && sinceMidnight < HANDOVER_AFTER;
  const city = current?.city?.name.uk ?? current?.country?.name.uk ?? '';

  const queueLabel = t('queueLabel', { count: queue.length });
  const queueList = (
    <ol aria-label={queueLabel} className="m-0 flex list-none flex-col gap-3.5 p-0" data-tv-queue="">
      {queue.map((item, i) => (
        <li key={item.id}>
          <TvQueueCard item={item} initial={i === 0} />
        </li>
      ))}
    </ol>
  );

  let body;
  if (mode === 'loading') {
    body = <p className="text-tv-text text-text-secondary">{t('loading')}</p>;
  } else if (mode === 'over' || !current) {
    body = <p className="text-tv-text text-highlight">{t('festOver')}</p>;
  } else if (mode === 'moment') {
    body = (
      <>
        <MetPhrase place={current} />
        {lastMinute && next ? (
          <p className="text-tv-text text-text-secondary" data-tv-next-in="">
            {t('nextIn', { time: formatShortCountdown(HANDOVER_AFTER - sinceMidnight) })} · {t('nextUp', { place: next.city?.name.uk ?? '' })}
          </p>
        ) : null}
        {stamp && current.country ? (
          <TvStampCard
            eventId={stamp.eventId}
            city={stamp.cityName || city}
            countryName={current.country.name.uk}
            illustrationId={stamp.illustrationId}
            firstRowSeat={stamp.firstRowSeat}
          />
        ) : null}
        {firstRow ? (
          <section aria-labelledby="tv-wall-title" className="flex min-h-0 flex-1 flex-col gap-3" data-tv-moment-wall="">
            <div className="flex flex-col">
              <h2 id="tv-wall-title" className="text-tv-title text-highlight">
                {t('firstRowHeading', { city: firstRow.city })}
              </h2>
              {firstRow.view.wall.phase === 'lighting' ? <span className="text-tv-text text-text-secondary">{t('firstRowLighting')}</span> : null}
            </div>
            {/* Прокручувана область має бути досяжною з пульта (WCAG 2.1.1). */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
            <div className={cn('t2f-focus', styles.scroll)} data-tv-scroll="" tabIndex={0} role="region" aria-label={t('firstRowHeading', { city: firstRow.city })}>
              <TvFirstRowWall data={firstRow} />
            </div>
          </section>
        ) : null}
        <ReplayButton place={current} />
      </>
    );
  } else {
    const showCountdown = untilMs > COUNTDOWN_UNTIL_MS;
    const showLine = !showCountdown && mode === 'live';
    body = (
      <>
        <div className="flex flex-col items-start gap-4">
          {showCountdown && mode === 'live' ? (
            <div className={styles.countdown} data-tv-countdown="">
              <span className="text-tv-text text-text-secondary" aria-hidden="true">
                {t('untilMidnight')}
              </span>
              <Countdown target={midnightMs} variant="tv" label={t('countdownTitle', { city })} />
            </div>
          ) : showLine ? (
            <p className="text-tv-text text-text-secondary" data-tv-midnight-at="">
              {tp('lineBefore', { country: current.country?.name.uk ?? city, time: formatClock(midnightMs, { locale }) })}
            </p>
          ) : null}
          <NowOnAir place={current} stream={mode === 'live'} />
        </div>

        {mode === 'scene' ? (
          <section aria-labelledby="tv-nearest-title" className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="tv-nearest-title" className="text-tv-title text-text">
                {t('nearestStreams')}
              </h2>
              <span className="text-tv-text text-text-secondary">{t('nearestCount', { count: queue.length })}</span>
            </div>
            <div className={styles.scroll} data-tv-panel="next">
              {queue.length ? queueList : <p className="text-tv-text text-text-secondary">{t('nearestEmpty')}</p>}
            </div>
          </section>
        ) : (
          <Tabs value={tab} onValueChange={setTab} variant="tv" className={styles.tabs}>
            <TabsList aria-label={t('tabsLabel')}>
              <TabsTrigger value="next">{t('next')}</TabsTrigger>
              <TabsTrigger value="how">{t('howTo')}</TabsTrigger>
              <TabsTrigger value="fr">{t('firstRow')}</TabsTrigger>
            </TabsList>
            <TabsContent value="next" tabIndex={-1} className={cn(styles.scroll, styles.panel)} data-tv-panel="next">
              {queue.length ? queueList : <p className="text-tv-text text-text-secondary">{t('queueEmpty')}</p>}
            </TabsContent>
            <TabsContent value="how" className={cn(styles.scroll, styles.panel)} data-tv-panel="how" data-tv-scroll="" tabIndex={0}>
              {current.country && current.country.howTo.traditions.length ? (
                <HowToCard country={current.country.name.uk} traditions={current.country.howTo.traditions} variant="tv" headingLevel="h2" />
              ) : (
                <p className="text-tv-text text-text-secondary">{t('howToEmpty')}</p>
              )}
            </TabsContent>
            <TabsContent value="fr" className={cn(styles.scroll, styles.panel)} data-tv-panel="fr" data-tv-scroll="" tabIndex={0}>
              <TvFirstRowTab data={firstRow} />
            </TabsContent>
          </Tabs>
        )}
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
      <div className="flex flex-col gap-2.5">
        {online ? null : (
          <p role="status" data-tv-offline="" className="text-tv-text text-highlight">
            {tFlash('offline')}
          </p>
        )}
        <TvControlBar
          paused={paused}
          muted={muted}
          available={hasVideo}
          onTogglePause={() => (paused ? actions?.play() : actions?.pause())}
          onToggleSound={() => (muted ? actions?.unmute() : actions?.mute())}
        />
        <p className="text-tv-text text-text-secondary" data-tv-flash="">
          {t('flashWarning')}
        </p>
        <TvFullscreenHint fullscreen={fullscreen} />
      </div>
    </aside>
  );
}
