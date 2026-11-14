'use client';

import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/primitives/Badge';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { useStreamChains } from '@/lib/api/hooks/live';
import type { CelebrationType, EventStatus, Ms } from '@/lib/data/types';
import { formatClock, formatMidnightAgo } from '@/lib/i18n/time';
import { STREAM_TYPE_KEY } from '@/lib/live/streamType';
import { useNow } from '@/lib/time/TimeProvider';
import { PostcardArt } from '@/components/stamp/StampArt';
import { useContext, useState } from 'react';
import { useAddToRoom } from '@/components/room/useRoomViewport';
import { RoomPageContext, usePlayingTarget, useRoomToggle } from '@/components/room/useRoomToggle';
import type { RoomTarget } from '@/stores/room';
import { Tooltip } from '@/components/primitives/Tooltip';
import { RoomAddConfirm } from './RoomAddConfirm';

/** За скільки до півночі додати в графік уже не можна (правка власника 2026-11-05: «менше 2 хвилин»). */
const SCHEDULE_CLOSE_MS = 2 * 60_000;
import s from './nowNext.module.css';

/** Стан трансляції події для рядка статусу картки (чотири статуси — `Badge stream-status`). */
export type EventCardStream = 'live' | 'expected' | 'possible' | 'countdown-only';

/** Дані картки: усе, що потрібно показати; без відліку (він один на сторінці — ІНВ C4). */
export interface EventCardData {
  id: string;
  /** Місто чи «Париж · Берлін · Рим». Без відмінювання. */
  title: string;
  /** Країна для зчитувача (поруч із назвою міста). */
  countryName?: string;
  flagCode: string;
  /** Північ події, мс epoch UTC. */
  midnightMs: Ms;
  celebrationType: CelebrationType;
  stream: EventCardStream;
  /** Сторінка країни. */
  href: string;
  inSchedule?: boolean;
  /** Це північ глядача («ваша північ»). */
  isOwnMidnight?: boolean;
  /** Мініатюра трансляції (YouTube); немає — обкладинка країни з «Відлік» (правка власника 2026-11-05). */
  thumb?: string;
  /** Обкладинка країни (`PostcardArt`). */
  illustrationId?: string;
  /** Джерело, що йде наживо, — «+» у кімнату перегляду (лише наживо). */
  liveSourceId?: string;
  liveTitle?: string;
  /**
   * Головне святкування північі (2026-11-13): перша картка «Зараз і далі», навіть коли трансляція ще не почалась —
   * статус «Очікується» замість «Наживо»; на головній (картка ефіру) — «В ефірі · очікується».
   */
  main?: boolean;
}

export interface EventCardProps extends EventCardData {
  /** `eventStatus(now, event)`: soon → live → ended → recording. */
  status: EventStatus;
  /**
   * Кнопка графіка. Без обробника вона інертна (неактивна): графік з’являється в US5.
   * Минулим подіям кнопка завжди неактивна.
   */
  onToggleSchedule?: (id: string, next: boolean) => void;
  /** `carousel` — фіксована ширина слайда · `stack` — на всю ширину (телефон). */
  layout?: 'carousel' | 'stack';
  /** Подія зараз у плеєрі ефіру (макет: «В ефірі» й «Наживо» ще до півночі). */
  onAir?: boolean;
  /** Замість переходу на сторінку країни (головна: картка ефіру повертає плеєр до ефіру, 2026-11-13). */
  onSelect?: () => void;
  className?: string;
}

const STATUS_KEY: Record<
  Exclude<EventCardStream, 'live'>,
  'expected' | 'possible' | 'countdownOnly'
> = {
  expected: 'expected',
  possible: 'possible',
  'countdown-only': 'countdownOnly',
};

const STATUS_ICON: Record<EventCardStream, IconName> = {
  live: 'broadcast',
  expected: 'broadcast',
  possible: 'broadcast-dashed',
  'countdown-only': 'clock',
};

/** Підтвердження «+» на телефоні: роутер потрібен лише тут (відкрити кімнату). */
function CardRoomConfirm({
  target,
  row,
  current,
  main,
  onClose,
}: {
  target: RoomTarget;
  row: { id: string; eventId: string; title: string };
  current: { id: string; eventId: string; title: string } | null;
  main: RoomTarget | null;
  onClose(): void;
}) {
  const addRoom = useAddToRoom();
  return (
    <RoomAddConfirm
      row={row}
      current={current}
      onCancel={onClose}
      onConfirm={() => {
        onClose();
        addRoom(target, main);
      }}
    />
  );
}

/** C4. Картка події (макет `Main` / `Phone-Home-Live`): прапор і назва, час за часом глядача, статус трансляції. */
export function EventCard({
  id,
  title,
  countryName,
  flagCode,
  midnightMs,
  celebrationType,
  stream,
  href,
  inSchedule = false,
  isOwnMidnight = false,
  thumb,
  illustrationId,
  liveSourceId,
  liveTitle,
  main = false,
  status,
  onToggleSchedule,
  layout = 'carousel',
  onAir = false,
  onSelect,
  className,
}: EventCardProps) {
  const t = useTranslations('liveCards.eventCard');
  const tBadge = useTranslations('primitives.badge');
  const tNav = useTranslations('nav');
  const tTime = useTranslations('primitives.time');
  const locale = useLocale();
  const now = useNow({ granularity: 'minute' });

  const isPast = (status === 'ended' || status === 'recording') && !onAir;
  const isOnAir = status === 'live' || onAir;
  const typeLabel = t(`type.${STREAM_TYPE_KEY[celebrationType]}`);
  // Головне святкування, що ще не почалось (2026-11-13): без «Наживо» — «Очікується», а картка ефіру на головній —
  // «В ефірі · очікується» (та сама позначка «В ефірі», що й у зчитувача; підпис сусідів «Головне святкування» не повторюємо).
  const mainWaiting = main && stream !== 'live';
  const statusLabel =
    stream === 'live'
      ? typeLabel
      : mainWaiting
        ? isOnAir
          ? t('mainExpectedOnAir', { onAir: tBadge('onAir') })
          : t('mainExpected')
        : tBadge(`status.${STATUS_KEY[stream]}`);
  const scheduleLabel = isPast
    ? t('schedulePast', { city: title })
    : inSchedule
      ? t('scheduleRemove', { city: title })
      : tNav('addToSchedule', { city: title });
  // Календарик — на всіх картках, і в ефірі теж (правка власника 2026-11-05). Північ минула чи до неї менше 2 хв —
  // неактивний з підказкою; був у графіку — лишається жовтим, лише тьмянішим.
  const scheduleClosed = isPast || midnightMs - now < SCHEDULE_CLOSE_MS;
  const scheduleInert = scheduleClosed || !onToggleSchedule;
  const icon: IconName = stream === 'live' && isOnAir ? 'broadcast-live' : STATUS_ICON[stream];
  const iconClass =
    stream === 'live'
      ? isOnAir || !isPast
        ? s.iconLive
        : undefined
      : stream === 'expected'
        ? s.iconExpected
        : undefined;

  // «+» у кімнату (дошка `Desk-Room-Plus-2`): лише трансляція наживо й не та, що вже в ефірі. Десктоп — одразу в кімнату
  // (✓, панель кімнати), телефон — підтвердження під рядком.
  const room = useRoomToggle();
  const roomPage = useContext(RoomPageContext);
  const playing = usePlayingTarget();
  const chains = useStreamChains();
  const [confirming, setConfirming] = useState(false);
  const canPlus = !!liveSourceId && !isOnAir && !isPast;
  const inRoom = !!liveSourceId && room.has(liveSourceId);
  const stack = layout === 'stack';
  // На сторінці кімнати «+» додає одразу й на телефоні (без підтвердження).
  const confirmFirst = stack && !roomPage;
  const plusLabel = inRoom ? t('roomIn', { city: title }) : t('roomAdd', { city: title });
  const playingTitle = playing
    ? (chains
        .get(playing.eventId)
        ?.sources.find((x) => x.id === playing.sourceId)?.title.uk ?? '')
    : '';

  return (
    <article
      data-event-card=""
      data-status={status}
      data-stream={stream}
      data-layout={layout}
      data-open={confirming || undefined}
      className={cn(s.card, confirming && s.cardOpen, className)}
    >
      <NextLink
        href={href}
        onClick={
          onSelect
            ? (e) => {
                e.preventDefault();
                onSelect();
              }
            : undefined
        }
        aria-current={isOnAir ? 'true' : undefined}
        className={cn('t2f-focus t2f-transition', s.link, isOnAir && s.onAir, isPast && s.past)}
      >
        {/* Мініатюра трансляції або обкладинка країни з «Відлік» — як картки трансляцій на сторінці країни. */}
        <span aria-hidden="true" className={cn(s.media, isPast && s.mediaPast)}>
          {thumb ? (
            // Мініатюра YouTube: зовнішня адреса, next/image без оптимізації тут зайвий.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" loading="lazy" decoding="async" />
          ) : (
            <>
              <PostcardArt illustrationId={illustrationId ?? 'generic'} fill className={s.cover} />
              <span className={s.mediaTag}>
                <Icon name="clock" size={14} />
                {t('countdownTag')}
              </span>
            </>
          )}
        </span>
        <span className={s.top}>
          <Flag
            code={flagCode}
            size="card"
            decorative
            className={isPast ? 'opacity-60' : undefined}
          />
          <span className={s.name}>
            {title}
            {countryName ? (
              <span className="sr-only">{t('countryHint', { country: countryName })}</span>
            ) : null}
          </span>
          {/* «В ефірі» прибрано (правка власника 2026-11-05): є «Наживо» й червона смуга; для зчитувача — лишається. */}
          {isOnAir && !mainWaiting ? <span className="sr-only">{tBadge('onAir')}</span> : null}
        </span>

        <span className={s.mid}>
          <span className="sr-only">{t('midnight')}</span>
          <span className={s.timeRow}>
            <time dateTime={new Date(midnightMs).toISOString()} className={s.time}>
              {formatClock(midnightMs, { locale })}
            </time>
            {isOnAir && !mainWaiting ? <Badge variant="live" /> : null}
          </span>
          <span className={s.yours}>
            {isPast ? formatMidnightAgo(Math.max(0, now - midnightMs), locale) : tTime('yourTime')}
            {inSchedule ? <span className={s.inSchedule}>{t('inScheduleShort')}</span> : null}
            {isOwnMidnight ? <span className={s.inSchedule}>{tBadge('yourMidnight')}</span> : null}
          </span>
        </span>

        <span className={cn(s.status, stream === 'live' && !isPast && s.statusLive)}>
          <Icon name={icon} size={16} strokeWidth={2.2} className={iconClass} />
          <span className={mainWaiting ? s.mainWaiting : undefined}>{statusLabel}</span>
        </span>
      </NextLink>

      {/* Кнопки: «+» над календариком (телефон — два постійні місця, щоб «+» і календарики стояли в одну лінію). */}
      <span className={s.btns}>
        {canPlus ? (
          <button
            type="button"
            aria-label={confirmFirst ? t('roomAdd', { city: title }) : plusLabel}
            aria-pressed={confirmFirst ? undefined : inRoom}
            aria-expanded={confirmFirst ? confirming : undefined}
            disabled={!roomPage && !stack && !inRoom && room.full}
            onClick={() =>
              roomPage
                ? roomPage.toggle({ sourceId: liveSourceId!, eventId: id })
                : stack
                  ? setConfirming((v) => !v)
                  : room.toggle({ sourceId: liveSourceId!, eventId: id })
            }
            className={cn('t2f-focus t2f-press rounded-full', s.cal, s.plusBtn)}
          >
            <span
              aria-hidden="true"
              className={cn(s.calCircle, inRoom && !confirmFirst && s.plusOn, confirming && s.plusOpen)}
            >
              <Icon name={inRoom && !confirmFirst ? 'check' : 'plus'} size={16} strokeWidth={2.4} />
            </span>
          </button>
        ) : (
          <span aria-hidden="true" className={s.slotEmpty} />
        )}
        {scheduleClosed ? (
          <Tooltip content={isPast ? t('scheduleClosedPast') : t('scheduleClosedSoon')}>
            {/* `aria-disabled`, а не `disabled`: неактивна кнопка без наведення лишилася б без підказки. */}
            <button
              type="button"
              aria-disabled="true"
              aria-pressed={inSchedule}
              aria-label={`${scheduleLabel}. ${isPast ? t('scheduleClosedPast') : t('scheduleClosedSoon')}`}
              className={cn('t2f-focus rounded-full', s.cal, s.calClosed)}
            >
              <span aria-hidden="true">
                <span className={cn(s.calCircle, inSchedule && s.calWasOn)}>
                  <Icon
                    name={inSchedule ? 'calendar-check' : 'calendar-add'}
                    size={16}
                    strokeWidth={inSchedule ? 2.2 : 2}
                  />
                </span>
              </span>
            </button>
          </Tooltip>
        ) : (
          <button
            type="button"
            aria-label={scheduleLabel}
            aria-pressed={inSchedule}
            disabled={scheduleInert}
            onClick={() => onToggleSchedule?.(id, !inSchedule)}
            className={cn('t2f-focus t2f-press rounded-full', s.cal)}
          >
            <span aria-hidden="true" className={s.calCircle}>
              <Icon
                name={inSchedule ? 'calendar-check' : 'calendar-add'}
                size={16}
                strokeWidth={inSchedule ? 2.2 : 2}
              />
            </span>
          </button>
        )}
      </span>
      {stack && confirming && liveSourceId ? (
        <div className={s.confirm}>
          <CardRoomConfirm
            target={{ sourceId: liveSourceId, eventId: id }}
            row={{ id: liveSourceId, eventId: id, title: liveTitle ?? title }}
            current={
              playing
                ? { id: playing.sourceId, eventId: playing.eventId, title: playingTitle }
                : null
            }
            main={playing}
            onClose={() => setConfirming(false)}
          />
        </div>
      ) : null}
    </article>
  );
}
