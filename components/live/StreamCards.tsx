'use client';

/**
 * Трансляції на сторінці країни картками з мініатюрами (дошки `Desk-Country-Full`, `Phone-Country-Full`, рішення
 * власника 2026-11-05) — «Трансляції · Франція» і «Ще о 01:00 · інші країни поясу».
 * - Натиск на картку — дивитися тут (плеєр перемикається на місці).
 * - «+» на мініатюрі — додати в кімнату перегляду: «Відкриється кімната перегляду з двома вікнами… — Відкрити кімнату /
 *   Скасувати» (десктоп — під «+», телефон — під рядком). На картці «Зараз грає» «+» немає: вона й так грає.
 * - Десктоп: три картки в ряд; більше — стрічка зі стрілками праворуч у рядку заголовка (по одній картці), тягнути мишею
 *   й гортати свайпом. Телефон: рядки (мініатюра ліворуч, «+» угорі праворуч).
 * - `showCountry` — сусіди по поясу: прапор і назва країни на картці; `countdown` — країни поясу без трансляції
 *   обкладинкою з «Відлік» (натиск — сторінка країни); `filter` — «Усі · З трансляціями · Мій графік» у заголовку
 *   (правка власника 2026-11-05); `phoneLimit` — на телефоні стільки рядків і «Ще N країн».
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Badge } from '@/components/primitives/Badge';
import {
  CarouselArrow,
  glideTo,
  slideStops,
  useDragScroll,
} from '@/components/primitives/Carousel';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { formatClock } from '@/lib/i18n/time';
import { PostcardArt } from '@/components/windows/StampArt';
import { EventFilter, type EventFilterValue } from './EventFilter';
import type { StreamRowData } from '@/lib/live/countryData';
import { canAddToRoom, RoomPageContext, useRoomToggle } from '@/components/room/useRoomToggle';
import type { RoomTarget } from '@/stores/room';
import { RoomAddConfirm } from './RoomAddConfirm';
import { usePhone } from './StreamList';
import { thumbOf } from '@/lib/live/thumb';
import s from './streamCards.module.css';

const KIND_KEY = { main: 'main', webcam: 'webcam', tv: 'tv' } as const;
const SLIDE = ':scope > li';

/** Країна поясу без трансляції: обкладинка з «Відлік», посилання на сторінку країни. */
export interface CountdownCountry {
  iso: string;
  name: string;
  flagCode: string;
  illustrationId: string;
  /** Місто головної події («Мадрид»). */
  city: string;
  href: string;
  midnightMs: number;
}

export interface StreamCardsFilter {
  value: EventFilterValue;
  onChange(next: EventFilterValue): void;
  scheduleLocked?: boolean;
  scheduleCount?: number;
  /** Без «З трансляціями» (кімната: тут і так лише те, що наживо). */
  hideLive?: boolean;
}

export interface StreamCardsProps {
  /** id секції (ціль прокрутки). */
  id?: string;
  heading: ReactNode;
  /** Праворуч від заголовка («північ о 01:00 за вашим часом»). */
  sub?: ReactNode;
  rows: readonly StreamRowData[];
  currentStreamId: string | null;
  /** Що грає зараз — друга мініатюра у вікні «Відкриється кімната перегляду». */
  currentRow?: Pick<StreamRowData, 'id' | 'eventId' | 'title'> | null;
  onSelect(row: StreamRowData): void;
  onAddToRoom?(row: StreamRowData): void;
  showCountry?: boolean;
  /** Під картками (посилання «Усі країни поясу ›»). */
  footer?: ReactNode;
  countdown?: readonly CountdownCountry[];
  filter?: StreamCardsFilter;
  /** Телефон: скільки рядків до «Ще N країн». */
  phoneLimit?: number;
  className?: string;
}

function Status({ row }: { row: StreamRowData }) {
  const t = useTranslations('country.streams.status');
  if (row.status === 'live')
    return (
      <Badge variant="stream-status" status="live">
        {t('live')}
      </Badge>
    );
  const icon =
    row.status === 'recording'
      ? 'play'
      : row.status === 'possible'
        ? 'broadcast-dashed'
        : 'broadcast';
  return (
    <span className={s.chip}>
      <Icon name={icon} size={14} />
      {t(row.status)}
    </span>
  );
}

function Thumb({ row, current }: { row: StreamRowData; current: boolean }) {
  const t = useTranslations('player.picker');
  const src = thumbOf(row);
  return (
    <span aria-hidden="true" className={s.thumb}>
      {src ? (
        // Мініатюра YouTube: зовнішня адреса, next/image без оптимізації тут зайвий.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className={s.thumbEmpty}>
          <Icon name="broadcast" size={22} />
        </span>
      )}
      {current ? (
        <span className={s.playing}>{t('playing')}</span>
      ) : (
        <span className={s.play}>
          <Icon name="play" size={16} />
        </span>
      )}
    </span>
  );
}

/**
 * «+» на десктопі (варіант C, рішення 2026-11-05): додає трансляцію у вікна кімнати без переходу — на картці ✓, повторний
 * натиск прибирає; зібране — у панелі кімнати знизу колонки (`RoomTray`). Кімната повна — «+» неактивний.
 */
function PlusToggle({ row, main }: { row: StreamRowData; main: RoomTarget | null }) {
  const t = useTranslations('country.streams');
  const room = useRoomToggle(main);
  // Сторінка кімнати: «+» не буває неактивним — повна кімната відкриває «Що замінити?».
  const roomPage = useContext(RoomPageContext);
  const on = room.has(row.id);
  const disabled = !roomPage && !on && room.full;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={
        on
          ? t('inRoom', { title: row.title })
          : disabled
            ? t('roomFull')
            : t('add', { title: row.title })
      }
      disabled={disabled}
      onClick={() => (roomPage ?? room).toggle({ sourceId: row.id, eventId: row.eventId })}
      className={cn('t2f-focus', s.plus, on && s.plusOn)}
    >
      <Icon name={on ? 'check' : 'plus'} size={18} strokeWidth={on ? 2.6 : 2.2} />
    </button>
  );
}

function DeskCard({ row, current, currentRow, showCountry, onSelect }: CardProps) {
  const tType = useTranslations('liveCards.eventCard.type');
  const kind = tType(KIND_KEY[row.kind]);
  return (
    <li
      data-stream-card={row.id}
      data-stream-row={row.id}
      data-current={current ? '' : undefined}
      className={cn(s.card, current && s.cardOn)}
    >
      <button
        type="button"
        aria-pressed={current}
        onClick={() => onSelect(row)}
        className={cn('t2f-focus', s.cardBtn)}
      >
        <span className={s.thumbWrap}>
          <Thumb row={row} current={current} />
          <span className={s.status}>
            <Status row={row} />
          </span>
        </span>
        <span className={s.text}>
          <span className={s.title}>{row.title}</span>
          {showCountry ? (
            <span className={s.country}>
              <Flag round code={row.flagCode} size="xs" decorative />
              {row.countryName}
            </span>
          ) : (
            <span className={s.meta}>
              {kind} · {formatClock(row.midnightMs)}
            </span>
          )}
        </span>
      </button>
      {current || !canAddToRoom(row.status) ? null : (
        <span className={s.plusSlot}>
          <PlusToggle
            row={row}
            main={currentRow ? { sourceId: currentRow.id, eventId: currentRow.eventId } : null}
          />
        </span>
      )}
    </li>
  );
}

interface CardProps {
  row: StreamRowData;
  current: boolean;
  currentRow?: Pick<StreamRowData, 'id' | 'eventId' | 'title'> | null;
  showCountry: boolean;
  onSelect(row: StreamRowData): void;
  onAddToRoom?(row: StreamRowData): void;
}

function PhoneRow({ row, current, currentRow, showCountry, onSelect, onAddToRoom }: CardProps) {
  const roomPage = useContext(RoomPageContext);
  const t = useTranslations('country.streams');
  const tType = useTranslations('liveCards.eventCard.type');
  const [confirming, setConfirming] = useState(false);
  const confirmId = useId();
  const kind = tType(KIND_KEY[row.kind]);
  return (
    <li
      data-stream-card={row.id}
      data-stream-row={row.id}
      data-current={current ? '' : undefined}
      className={cn(s.row, current && s.cardOn, confirming && s.rowOpen)}
    >
      <div className={s.rowMain}>
        <button
          type="button"
          aria-pressed={current}
          onClick={() => onSelect(row)}
          className={cn('t2f-focus', s.rowBtn)}
        >
          <span className={s.rowThumb}>
            <Thumb row={row} current={current} />
          </span>
          <span className={s.rowText}>
            <span className={s.title}>{row.title}</span>
            <span className={s.statusLine}>
              <Status row={row} />
            </span>
            {showCountry ? (
              <span className={s.country}>
                <Flag round code={row.flagCode} size="xs" decorative />
                {row.countryName}
              </span>
            ) : (
              <span className={s.meta}>
                {kind} · {formatClock(row.midnightMs)}
              </span>
            )}
          </span>
        </button>
        {current || !canAddToRoom(row.status) ? null : roomPage ? (
          <PlusToggle row={row} main={null} />
        ) : (
          <IconButton
            icon="plus"
            variant="ring"
            compact
            iconSize={16}
            aria-label={t('add', { title: row.title })}
            aria-expanded={confirming}
            aria-controls={confirming ? confirmId : undefined}
            onClick={() => setConfirming((v) => !v)}
            className={s.rowPlus}
          />
        )}
      </div>
      {confirming && !current ? (
        <div className={s.rowConfirm}>
          <RoomAddConfirm
            id={confirmId}
            row={row}
            current={currentRow}
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              onAddToRoom?.(row);
            }}
          />
        </div>
      ) : null}
    </li>
  );
}

/** Країна без трансляції: обкладинка країни з «Відлік»; натиск — сторінка країни. */
function CoverCard({ c, phone }: { c: CountdownCountry; phone: boolean }) {
  const t = useTranslations('liveCards.eventCard');
  const cover = (
    <span className={s.thumb} aria-hidden="true">
      <PostcardArt illustrationId={c.illustrationId} fill className={s.coverArt} />
      <span className={s.coverTag}>
        <Icon name="clock" size={14} />
        {t('countdownTag')}
      </span>
    </span>
  );
  const country = (
    <span className={s.country}>
      <Flag round code={c.flagCode} size="xs" decorative />
      {c.name}
    </span>
  );
  if (phone)
    return (
      <li data-countdown-card={c.iso} className={s.row}>
        <NextLink href={c.href} className={cn('t2f-focus', s.rowMain, s.coverLink)}>
          <span className={s.rowThumb}>{cover}</span>
          <span className={s.rowText}>
            <span className={s.title}>{c.city}</span>
            {country}
            <span className={s.meta}>
              {t('type.countdownOnly')} · {formatClock(c.midnightMs)}
            </span>
          </span>
        </NextLink>
      </li>
    );
  return (
    <li data-countdown-card={c.iso} className={s.card}>
      <NextLink href={c.href} className={cn('t2f-focus', s.cardBtn, s.coverLink)}>
        <span className={s.thumbWrap}>{cover}</span>
        <span className={s.text}>
          <span className={s.title}>{c.city}</span>
          {country}
        </span>
      </NextLink>
    </li>
  );
}

export function StreamCards({
  id,
  heading,
  sub,
  rows,
  currentStreamId,
  currentRow,
  onSelect,
  onAddToRoom,
  showCountry = false,
  footer,
  countdown = [],
  filter,
  phoneLimit,
  className,
}: StreamCardsProps) {
  const t = useTranslations('liveMap.panel');
  const tc = useTranslations('country.streams');
  const [expanded, setExpanded] = useState(false);
  const phone = usePhone();
  const headingId = useId();
  const ref = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  useDragScroll(ref as RefObject<HTMLElement | null>, SLIDE);
  useEffect(() => {
    const el = ref.current;
    if (!el || phone) return;
    const upd = () =>
      setEdge({
        start: el.scrollLeft <= 2,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
      });
    upd();
    el.addEventListener('scroll', upd, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(upd) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', upd);
      ro?.disconnect();
    };
  }, [phone, rows.length, countdown.length]);
  if (rows.length === 0 && countdown.length === 0 && !filter) return null;

  const go = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const stops = slideStops(el, SLIDE);
    const cur = el.scrollLeft;
    const target =
      dir > 0
        ? (stops.find((x) => x > cur + 2) ?? stops.at(-1)!)
        : ([...stops].reverse().find((x) => x < cur - 2) ?? 0);
    glideTo(el, target);
  };
  const arrows = !phone && !(edge.start && edge.end);
  const Card = phone ? PhoneRow : DeskCard;
  const total = rows.length + countdown.length;
  const limit = phone && phoneLimit && !expanded ? phoneLimit : Infinity;
  const shownRows = rows.slice(0, limit);
  const shownCountdown = countdown.slice(0, Math.max(0, limit - shownRows.length));
  const hidden = total - shownRows.length - shownCountdown.length;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-stream-cards=""
      className={cn(s.section, className)}
    >
      <div className={s.head}>
        {/* З фільтром у рядку — підзаголовок під назвою (інакше фільтр і стрілки не вміщаються). */}
        <div className={cn(s.titleBlock, filter && s.titleStack)}>
          <h2 id={headingId} className={s.h2}>
            {heading}
          </h2>
          {sub ? <span className={s.sub}>{sub}</span> : null}
        </div>
        {filter && !phone ? (
          <EventFilter
            value={filter.value}
            onValueChange={filter.onChange}
            scheduleLocked={filter.scheduleLocked}
            scheduleCount={filter.scheduleCount}
            hideLive={filter.hideLive}
            className={s.filter}
          />
        ) : null}
        {arrows ? (
          <span className={cn(s.arrows, filter && s.arrowsNext)}>
            <CarouselArrow
              dir="prev"
              size="md"
              label={t('slidePrev')}
              disabled={edge.start}
              onClick={() => go(-1)}
            />
            <CarouselArrow
              dir="next"
              size="md"
              label={t('slideNext')}
              disabled={edge.end}
              onClick={() => go(1)}
            />
          </span>
        ) : null}
      </div>
      {filter && phone ? (
        <EventFilter
          value={filter.value}
          onValueChange={filter.onChange}
          scheduleLocked={filter.scheduleLocked}
          scheduleCount={filter.scheduleCount}
          hideLive={filter.hideLive}
          className={s.filterPhone}
        />
      ) : null}
      {total === 0 ? <p className={s.empty}>{tc('othersEmpty')}</p> : null}
      <ul ref={ref} className={phone ? s.list : s.track}>
        {shownRows.map((row) => (
          <Card
            key={row.id}
            row={row}
            current={row.id === currentStreamId}
            currentRow={currentRow}
            showCountry={showCountry}
            onSelect={onSelect}
            onAddToRoom={onAddToRoom}
          />
        ))}
        {shownCountdown.map((c) => (
          <CoverCard key={c.iso} c={c} phone={phone} />
        ))}
      </ul>
      {hidden > 0 || (expanded && phoneLimit && total > phoneLimit) ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className={cn('t2f-focus t2f-press t2f-transition', s.moreBtn)}
        >
          {expanded ? tc('othersLess') : tc('othersMore', { count: hidden })}
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} strokeWidth={2} />
        </button>
      ) : null}
      {footer}
    </section>
  );
}
