'use client';

/**
 * C15. Rate (RateCard) — «Як тобі шоу?» (O-RATE, EXPERIENCE «Вікна»). Вікно типу `inflow` після штампа.
 *
 * Правила: відкривається через 2 хв після півночі й триває 3 хв (двигун `momentState`); не закривається,
 * поки людина взаємодіє або фокус усередині (WCAG 2.2.1) — компонент повідомляє про це через
 * `onInteractionChange` (сторінка передає у `momentState` як `rateInteracting`), а за `closesAt` сам просить
 * закриття (`onClose('timeout', …)`) щойно взаємодія закінчилась. 5 зірок по 44 px — `RadioGroup variant="stars"`.
 * Стани: відкрито, оцінено («Дякуємо»), помилка надсилання, закрито (нічого не малюється).
 * Коралової кнопки немає.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/primitives/Button';
import rs from './rate.module.css';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { Link } from '@/components/primitives/Link';
import { RadioGroup, type RadioOption } from '@/components/primitives/RadioGroup';
import type { Ms, Stars } from '@/lib/data/types';
import { useNow } from '@/lib/time/TimeProvider';

export interface RateRow {
  eventId: string;
  /** Назва країни в називному відмінку. */
  countryName: string;
  /** Назва міста в називному відмінку. */
  city: string;
  flagCode: string;
}

export type RateStatus = 'open' | 'error' | 'closed';
export type RateCloseReason = 'dismissed' | 'timeout';

export interface RateProps {
  /** Кілька подій одного моменту — кілька рядків. */
  rows: RateRow[];
  /** Поточні оцінки гостя за подіями (керований режим); без нього компонент тримає їх сам. */
  ratings?: Partial<Record<string, Stars>>;
  /** `error` — не вдалося надіслати; `closed` — гість оцінив/закрив: більше не з’являється. */
  status?: RateStatus;
  onRate?: (eventId: string, stars: Stars) => void;
  onRetry?: () => void;
  onClose?: (reason: RateCloseReason, info?: { deferredMs?: number }) => void;
  /** Є взаємодія (фокус усередині, наведення, щойно змінена оцінка). */
  onInteractionChange?: (interacting: boolean) => void;
  /** Коли карта має закритися за часом (+5 хв після півночі). Без значення таймера немає. */
  closesAt?: Ms;
  /** Куди веде «рейтинг міст». */
  ratingHref?: string;
  className?: string;
}

/** Скільки після зміни оцінки картка вважається «в роботі». */
const RECENT_RATE_MS = 4000;
const STARS_VALUES: Stars[] = [1, 2, 3, 4, 5];

function RateTimeout({
  closesAt,
  interacting,
  onClose,
}: {
  closesAt: Ms;
  interacting: boolean;
  onClose: (reason: RateCloseReason, info?: { deferredMs?: number }) => void;
}) {
  const now = useNow();
  const fired = useRef(false);
  const due = now > 0 && now >= closesAt;
  useEffect(() => {
    if (!due || interacting || fired.current) return;
    fired.current = true;
    const deferred = now - closesAt;
    onClose('timeout', deferred > 1500 ? { deferredMs: deferred } : undefined);
  }, [due, interacting, now, closesAt, onClose]);
  return null;
}

export function Rate({
  rows,
  ratings,
  status = 'open',
  onRate,
  onRetry,
  onClose,
  onInteractionChange,
  closesAt,
  ratingHref = '/rating',
  className,
}: RateProps) {
  const t = useTranslations('windows.rate');
  const common = useTranslations('common');
  const titleId = useId();

  const [inner, setInner] = useState<Partial<Record<string, Stars>>>({});
  const values = ratings ?? inner;

  const [focusWithin, setFocusWithin] = useState(false);
  const [hover, setHover] = useState(false);
  const [recent, setRecent] = useState(false);
  const recentTimer = useRef<number | undefined>(undefined);
  const interacting = status === 'open' && (focusWithin || hover || recent);

  const last = useRef<boolean | null>(null);
  useEffect(() => {
    if (last.current === interacting) return;
    last.current = interacting;
    onInteractionChange?.(interacting);
  }, [interacting, onInteractionChange]);
  useEffect(() => () => window.clearTimeout(recentTimer.current), []);

  if (status === 'closed') return null;

  const rate = (eventId: string, stars: Stars) => {
    setInner((prev) => ({ ...prev, [eventId]: stars }));
    setRecent(true);
    window.clearTimeout(recentTimer.current);
    recentTimer.current = window.setTimeout(() => setRecent(false), RECENT_RATE_MS);
    onRate?.(eventId, stars);
  };

  const rated = rows.length > 0 && rows.every((r) => values[r.eventId] !== undefined);
  const options: RadioOption[] = STARS_VALUES.map((n) => ({ value: String(n), label: t('star', { n }) }));

  return (
    <section
      aria-labelledby={titleId}
      data-rate={status === 'error' ? 'error' : rated ? 'rated' : 'open'}
      data-single={rows.length === 1 ? 'true' : undefined}
      className={cn('relative flex flex-col gap-2 rounded-lg border border-border bg-surface-raised px-4 pb-2 pt-3.5', rs.rate, className)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
      }}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      {closesAt !== undefined && onClose ? <RateTimeout closesAt={closesAt} interacting={interacting} onClose={onClose} /> : null}
      <h2 id={titleId} className={cn(rs.title, 'text-text')}>
        {t('title')}
      </h2>
      <IconButton
        icon="close"
        variant="plain"
        iconSize={18}
        aria-label={t('close')}
        className="absolute right-0.5 top-0.5 md:right-1.5 md:top-1.5"
        onClick={() => onClose?.('dismissed')}
      />
      {rows.map((row) => {
        const rowId = `${titleId}-${row.eventId}`;
        const rowText = t('row', { country: row.countryName, city: row.city });
        const value = values[row.eventId];
        return (
          <div key={row.eventId} className={cn('flex flex-col', rs.item)} data-event={row.eventId}>
            <div id={rowId} className={cn('flex items-center gap-2 text-text-secondary', rs.row)}>
              <Flag code={row.flagCode} size="card" decorative />
              {rowText}
            </div>
            <div className={cn('-mx-1.5 mt-0.5 flex flex-col self-start', rs.stars)}>
              <RadioGroup
                variant="stars"
                label={`${t('title')} ${rowText}`}
                options={options}
                value={value === undefined ? '' : String(value)}
                onValueChange={(v) => rate(row.eventId, Number(v) as Stars)}
              />
              <div aria-hidden="true" className="flex justify-between px-1 text-label-badge-chat text-text-muted">
                <span>{t('low')}</span>
                <span>{t('high')}</span>
              </div>
            </div>
            {value !== undefined ? <p className="sr-only">{t('stars', { n: value })}</p> : null}
          </div>
        );
      })}
      {status === 'error' ? (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 text-caption text-text" data-row="error">
          <Icon name="alert" size={16} className="text-primary" />
          <span className="flex-1">{t('error')}</span>
          <Button variant="ghost" compact onClick={onRetry}>
            {common('retry')}
          </Button>
        </div>
      ) : rated ? (
        <p className="flex items-center gap-2 text-body-strong text-text" data-row="thanks">
          <Icon name="check" size={18} className="text-highlight" />
          {t('thanks')}
        </p>
      ) : null}
      <p className="text-caption text-text-muted" data-row="later">
        {t.rich('later', {
          link: (chunks) => (
            <Link href={ratingHref} className="-my-3 inline-flex min-h-touch-min items-center font-semibold">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </section>
  );
}
