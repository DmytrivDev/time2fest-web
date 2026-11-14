'use client';

/**
 * Картка трансляції у вікнах під мапою — вікно поясу (`ZonePanel`) і вікно країни (`CountryPanel`) — і її частини, спільні
 * зі списком країн (`CountryList`): кнопка «Додати в графік» (`ScheduleButton`, дія — з `MapScheduleContext`) і знак «▶»
 * (`PlayMark`). Каркас картки однаковий: тип і стан угорі, рядки місця, кнопка «Дивитися» й календар; вікна задають лише
 * свої рядки й підпис кнопки.
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { useSchedule } from '@/lib/api/hooks/auth';
import type { CelebrationType } from '@/lib/data/types';
import { STREAM_TYPE_KEY } from '@/lib/live/streamType';
import nn from '@/components/live/nowNext.module.css';
import m from './zonePanel.module.css';

/**
 * «Додати в графік» з мапи (рішення власника 2026-11-04): та сама дія, що на картках «Зараз і далі» — з пасом перемикає,
 * без пасу відкриває вікно «Графік — у Новорічному пасі» в колонці чату. Мапа отримує її від сторінки.
 */
export const MapScheduleContext = createContext<((eventId: string, next: boolean) => void) | null>(
  null,
);

/**
 * Утримати натиснуту картку на тій самій висоті екрана: якщо колонка чату була схована й відкривається під вікно, мапа й
 * усе під нею звужуються — сторінка підкручується, щоб картка не «втекла» з-під курсора (дошка `Desk-Home-ChatColumn`).
 */
function keepInPlace(el: HTMLElement | null) {
  if (!el || typeof window === 'undefined') return;
  const hold = () => {
    const top = el.getBoundingClientRect().top;
    let frames = 0;
    const tick = () => {
      const d = el.getBoundingClientRect().top - top;
      if (Math.abs(d) > 1) window.scrollBy(0, d);
      if (++frames < 12) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  hold();
  // Колонку повернуло вікно (`data-chat-forced`) — коли вікно закриють і колонка знову сховається, картка теж лишається на
  // місці: позицію «до» оновлюємо при кожній прокрутці, а після зміни атрибута повертаємо картку на неї.
  const aside = document.getElementById('chat');
  if (!aside || typeof MutationObserver === 'undefined') return;
  let last = el.getBoundingClientRect().top;
  const onScroll = () => {
    last = el.getBoundingClientRect().top;
  };
  const stop = () => {
    mo.disconnect();
    window.removeEventListener('scroll', onScroll);
  };
  const mo = new MutationObserver(() => {
    const d = el.getBoundingClientRect().top - last;
    if (Math.abs(d) > 1) window.scrollBy(0, d);
    if (!aside.hasAttribute('data-chat-forced')) stop();
  });
  window.setTimeout(() => {
    if (!aside.hasAttribute('data-chat-forced')) return; // колонка й так була відкрита — стежити нічого
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    mo.observe(aside, { attributes: true, attributeFilter: ['data-chat-forced'] });
  }, 400);
}

/** Кнопка календаря на картці трансляції, що ще попереду (вигляд — як на картках «Зараз і далі»). */
export function ScheduleButton({
  eventId,
  city,
  size = 'md',
}: {
  eventId?: string;
  city: string;
  /** `sm` — коло 26 px у плитці «за регіонами». */
  size?: 'md' | 'sm';
}) {
  const onToggle = useContext(MapScheduleContext);
  const mySchedule = useSchedule();
  const inSchedule = eventId ? mySchedule.includes(eventId) : false;
  const t = useTranslations('liveCards.eventCard');
  const tNav = useTranslations('nav');
  if (!eventId || !onToggle) return null;
  const label = inSchedule ? t('scheduleRemove', { city }) : tNav('addToSchedule', { city });
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={inSchedule}
      data-schedule-toggle={eventId}
      className={cn('t2f-focus t2f-press rounded-full', nn.cal, m.cal, size === 'sm' && m.calSm)}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        keepInPlace(e.currentTarget.closest('li'));
        onToggle(eventId, !inSchedule);
      }}
    >
      <span aria-hidden="true" className={nn.calCircle}>
        <Icon
          name={inSchedule ? 'calendar-check' : 'calendar-add'}
          size={size === 'sm' ? 14 : 16}
          strokeWidth={inSchedule ? 2.2 : 2}
        />
      </span>
    </button>
  );
}

/**
 * Знак «▶» на кнопці картки трансляції (рішення власника 2026-11-03): залитий трикутник (18 px) кольору тексту кнопки,
 * без кола, по центру з текстом.
 */
export function PlayMark({
  tone,
  size = 18,
}: {
  tone: 'live' | 'replay' | 'upcoming';
  size?: 12 | 14 | 18;
}) {
  return (
    <span aria-hidden="true" className={m.playMark} data-play-mark={tone}>
      <svg viewBox="0 0 24 24" width={size} height={size}>
        <path d="M7 4.5l13 7.5-13 7.5z" fill="currentColor" />
      </svg>
    </span>
  );
}

export type MapStreamMode = 'live' | 'upcoming' | 'replay';

export interface MapStreamCardProps {
  /** `data-stream-card` — місто трансляції. */
  cityId: string;
  type: CelebrationType;
  mode: MapStreamMode;
  href: string;
  /** Подія для календаря (лише `upcoming`) і місто для його підпису. */
  eventId?: string | undefined;
  city: string;
  /** Що показати в рядку типу замість «Наживо» / «Запис», коли трансляція попереду (вікно країни — час півночі). */
  upcomingBadge?: ReactNode;
  /** Рядки між верхом і кнопками (місто, країна, час). */
  children: ReactNode;
  /** Підпис кнопки, коли трансляція попереду (для «Наживо» й «Запис» — спільні). */
  upcomingLabel: string;
  /** «▶» на кнопці й тоді, коли трансляція попереду (вікно країни). */
  upcomingPlayMark?: boolean;
}

export function MapStreamCard({
  cityId,
  type,
  mode,
  href,
  eventId,
  city,
  upcomingBadge = null,
  children,
  upcomingLabel,
  upcomingPlayMark = false,
}: MapStreamCardProps) {
  const t = useTranslations('liveMap.panel');
  const tType = useTranslations('liveCards.eventCard.type');
  const live = mode === 'live';
  return (
    <li className={m.card} data-stream-card={cityId}>
      <div className={m.cardTop}>
        <span className={m.cardType}>{tType(STREAM_TYPE_KEY[type])}</span>
        {live ? (
          <span className={m.cardLive}>
            <span aria-hidden="true" className={m.dotLive} />
            {t('live')}
          </span>
        ) : mode === 'replay' ? (
          <span className={m.cardReplay}>
            <PlayMark tone="replay" size={12} />
            {t('replay')}
          </span>
        ) : (
          upcomingBadge
        )}
      </div>
      {children}
      <div className={m.cardActions}>
        <NextLink href={href} className={cn('t2f-focus', m.cardBtn, live && m.cardBtnLive)}>
          {mode === 'upcoming' && !upcomingPlayMark ? null : <PlayMark tone={mode} />}
          {live ? t('watch') : mode === 'replay' ? t('watchReplay') : upcomingLabel}
        </NextLink>
        {mode === 'upcoming' ? <ScheduleButton eventId={eventId} city={city} /> : null}
      </div>
    </li>
  );
}
