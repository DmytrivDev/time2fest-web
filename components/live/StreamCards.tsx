'use client';

/**
 * Трансляції на сторінці країни картками з мініатюрами (дошки `Desk-Country-Full`, `Phone-Country-Full`, рішення
 * власника 2026-11-05) — «Трансляції · Франція» і «Ще о 01:00 · інші країни поясу».
 * - Натиск на картку — дивитися тут (плеєр перемикається на місці).
 * - «+» на мініатюрі — додати в кімнату перегляду: «Відкриється кімната перегляду з двома вікнами… — Відкрити кімнату /
 *   Скасувати» (десктоп — під «+», телефон — під рядком). На картці «Зараз грає» «+» немає: вона й так грає.
 * - Десктоп: три картки в ряд; більше — стрічка зі стрілками праворуч у рядку заголовка (по одній картці), тягнути мишею
 *   й гортати свайпом. Телефон: рядки (мініатюра ліворуч, «+» угорі праворуч).
 * - `showCountry` — сусіди по поясу: прапор і назва країни на картці.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/primitives/Popover';
import { formatClock } from '@/lib/i18n/time';
import type { StreamRowData } from '@/lib/live/countryData';
import { PlusConfirm, usePhone } from './StreamList';
import { thumbOf } from './StreamPicker';
import s from './streamCards.module.css';

const KIND_KEY = { main: 'main', webcam: 'webcam', tv: 'tv' } as const;
const SLIDE = ':scope > li';

export interface StreamCardsProps {
  /** id секції (ціль прокрутки). */
  id?: string;
  heading: ReactNode;
  /** Праворуч від заголовка («північ о 01:00 за вашим часом»). */
  sub?: ReactNode;
  rows: readonly StreamRowData[];
  currentStreamId: string | null;
  /** Назва поточної трансляції — для «Відкриється кімната… Сакре-Кер і Сена й Нотр-Дам». */
  currentTitle?: string;
  onSelect(row: StreamRowData): void;
  onAddToRoom?(row: StreamRowData): void;
  showCountry?: boolean;
  /** Під картками (посилання «Усі країни поясу ›»). */
  footer?: ReactNode;
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

/** «+» на десктопі: під кнопкою — підтвердження кімнати перегляду. */
function PlusPopover({
  row,
  currentTitle,
  onAddToRoom,
}: {
  row: StreamRowData;
  currentTitle?: string;
  onAddToRoom?(row: StreamRowData): void;
}) {
  const t = useTranslations('country.streams');
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('add', { title: row.title })}
          aria-haspopup="dialog"
          className={cn('t2f-focus', s.plus)}
        >
          <Icon name="plus" size={18} strokeWidth={2.2} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-80 p-4">
        <PlusConfirm
          id={id}
          row={row}
          currentTitle={currentTitle}
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            onAddToRoom?.(row);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function DeskCard({ row, current, currentTitle, showCountry, onSelect, onAddToRoom }: CardProps) {
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
      {current ? null : (
        <span className={s.plusSlot}>
          <PlusPopover row={row} currentTitle={currentTitle} onAddToRoom={onAddToRoom} />
        </span>
      )}
    </li>
  );
}

interface CardProps {
  row: StreamRowData;
  current: boolean;
  currentTitle?: string;
  showCountry: boolean;
  onSelect(row: StreamRowData): void;
  onAddToRoom?(row: StreamRowData): void;
}

function PhoneRow({ row, current, currentTitle, showCountry, onSelect, onAddToRoom }: CardProps) {
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
      className={cn(s.row, current && s.cardOn)}
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
        {current ? null : (
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
          <PlusConfirm
            id={confirmId}
            row={row}
            currentTitle={currentTitle}
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

export function StreamCards({
  id,
  heading,
  sub,
  rows,
  currentStreamId,
  currentTitle,
  onSelect,
  onAddToRoom,
  showCountry = false,
  footer,
  className,
}: StreamCardsProps) {
  const t = useTranslations('liveMap.panel');
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
  }, [phone, rows.length]);
  if (rows.length === 0) return null;

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

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-stream-cards=""
      className={cn(s.section, className)}
    >
      <div className={s.head}>
        <h2 id={headingId} className={s.h2}>
          {heading}
        </h2>
        {sub ? <span className={s.sub}>{sub}</span> : null}
        {arrows ? (
          <span className={s.arrows}>
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
      <ul ref={ref} className={phone ? s.list : s.track}>
        {rows.map((row) => (
          <Card
            key={row.id}
            row={row}
            current={row.id === currentStreamId}
            currentTitle={currentTitle}
            showCountry={showCountry}
            onSelect={onSelect}
            onAddToRoom={onAddToRoom}
          />
        ))}
      </ul>
      {footer}
    </section>
  );
}
