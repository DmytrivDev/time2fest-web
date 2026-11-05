'use client';

/**
 * O-FIRST-ROW-MORE «Ще є місця в «Першому ряду»» за дошками `Desk-FR-More` / `Phone-FR-More` (рішення власника
 * 2026-10-31): відкривається, коли ряд розпродано, — на десктопі на місці чату, на телефоні шторкою. Групи
 * «Та сама північ · 02:00» і «Далі» (порядок дає `otherOpenRows`); рядок відкриває «Що входить» цього ряду, трансляція
 * грає далі. Прапори круглі.
 */
import { useTranslations } from 'next-intl';
import type { FirstRowMoreProps, FirstRowMoreRow } from '@/components/firstrow/types';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { formatPrice } from '@/lib/firstrow/format';
import { formatClock } from '@/lib/i18n/time';
import win from './firstRowWin.module.css';

function Row({ row, now, same, onPick }: { row: FirstRowMoreRow; now: number; same: boolean; onPick(id: string): void }) {
  const t = useTranslations('firstRow');
  const low = row.free <= 2;
  const mins = Math.max(1, Math.round((row.midnightMs - now) / 60_000));
  const when = same
    ? null
    : mins < 60
      ? t('more.midnightInMin', { time: formatClock(row.midnightMs), min: mins })
      : t('more.midnightIn', { time: formatClock(row.midnightMs), hours: Math.round(mins / 60) });
  const note = [same && row.main ? t('more.main') : null, when, row.country].filter(Boolean).join(' · ');
  return (
    <li>
      <button
        type="button"
        data-row-event={row.eventId}
        aria-label={t('more.rowLabel', { city: row.city, free: row.free, total: 10, price: formatPrice(row.price) })}
        onClick={() => onPick(row.eventId)}
        className="t2f-focus t2f-transition flex min-h-16 w-full items-center gap-3 rounded-lg border border-border bg-surface-raised py-2.5 pe-2 ps-3 text-start hover:border-border-strong"
      >
        <Flag code={row.flagCode} size="md" round decorative />
        <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={win.rowTitle}>{t('heading', { city: row.city })}</span>
          <span className="text-caption text-text-muted">{note}</span>
          <span className="text-caption text-text-muted">
            <b className={cn('font-bold tabular-nums', low ? 'text-highlight' : 'text-text')}>{t('more.left', { free: row.free, total: 10 })}</b>
            {' · '}
            {t('more.price', { price: '' })}
            <b className="font-semibold text-text">{formatPrice(row.price)}</b>
          </span>
        </span>
        <Icon name="chevron-right" size={18} className="shrink-0 text-text-muted" />
      </button>
    </li>
  );
}

export function FirstRowMore({ midnightMs, now, rows, onPick, onClose, className }: FirstRowMoreProps) {
  const t = useTranslations('firstRow');
  const same = rows.filter((r) => r.midnightMs === midnightMs);
  const next = rows.filter((r) => r.midnightMs !== midnightMs);
  const group = (title: string, list: readonly FirstRowMoreRow[], isSame: boolean) =>
    list.length ? (
      <div className="flex flex-col gap-2">
        <h3 className="m-0 text-caption font-semibold text-text-muted">{title}</h3>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {list.map((r) => (
            <Row key={r.eventId} row={r} now={now} same={isSame} onPick={onPick} />
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <section data-window="O-FIRST-ROW-MORE" className={cn('flex min-h-full flex-col', className)}>
      <div className="flex flex-1 flex-col gap-4 p-4">
        {rows.length ? (
          <>
            {group(t('more.same', { time: formatClock(midnightMs) }), same, true)}
            {group(t('more.next'), next, false)}
            <p className="m-0 text-caption text-text-muted">{t('more.hint')}</p>
          </>
        ) : (
          <p className={win.plain}>{t('more.empty')}</p>
        )}
      </div>
      <div className="sticky bottom-0 border-t border-border bg-surface px-4 pb-4 pt-3">
        <Button variant="secondary" size="lg" data-action="close" onClick={onClose} className="w-full">
          {t('more.close')}
        </Button>
      </div>
    </section>
  );
}
