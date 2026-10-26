'use client';

/** C8. O-FIRST-ROW-INFO «Що дає «Перший ряд»» (InFlowSlot): список вигод, лічильник, ціна, «Зайняти місце», «Згорнути». */
import { useTranslations } from 'next-intl';
import type { FirstRowInfoProps } from '@/components/firstrow/types';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { formatPrice } from '@/lib/firstrow/format';
import { formatClock } from '@/lib/i18n/time';

const BENEFITS = ['wall', 'animation', 'chatNote', 'greeting', 'room', 'stamp', 'pass'] as const;

export function FirstRowInfo({ city, midnightMs, view, onTake, onCollapse, className }: FirstRowInfoProps) {
  const t = useTranslations('firstRow');
  const { price } = view;
  const current = price.current;
  const discounted = current !== null && price.discountReason === 'pass' && price.discounted !== undefined;
  const titleId = `first-row-info-${view.eventId}`;
  const sep = (
    <span aria-hidden="true" className="text-text-muted">
      ·
    </span>
  );
  return (
    <section
      aria-labelledby={titleId}
      data-window="O-FIRST-ROW-INFO"
      className={cn('flex flex-col gap-3 rounded-lg border border-border bg-surface p-4', className)}
    >
      <div className="flex flex-col gap-1">
        <h3 id={titleId} className="text-headline-sm text-text">
          {t('infoTitle')}
        </h3>
        <p className="text-label-sm text-text-muted">{t('infoWin.meta', { city, time: formatClock(midnightMs) })}</p>
      </div>
      <ul className="flex list-disc flex-col gap-1.5 ps-5 text-body text-text-secondary marker:text-highlight">
        {BENEFITS.map((k) => (
          <li key={k}>{t(`benefits.${k}`)}</li>
        ))}
      </ul>
      {current !== null ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body">
          <span className="text-body-strong text-text">{t('infoWin.left', { free: view.freeCount })}</span>
          {sep}
          {discounted && price.discounted !== undefined ? (
            <>
              <span className="sr-only">
                {t('priceFullSpoken', { full: formatPrice(current), discounted: formatPrice(price.discounted) })}
              </span>
              <span aria-hidden="true" className="inline-flex flex-wrap items-center gap-x-2">
                <s className="text-text-muted">{formatPrice(current)}</s>
                <span className="text-body-strong text-highlight">{formatPrice(price.discounted)}</span>
                <Badge variant="discount">{t('discountBadge')}</Badge>
              </span>
            </>
          ) : (
            <>
              <span>{t('price', { price: formatPrice(current) })}</span>
              {sep}
              <span className="text-text-muted">{t('giftPassShort')}</span>
            </>
          )}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {onTake && current !== null ? (
          <Button variant="coral" size="lg" data-action="take" onClick={onTake}>
            {t('take')}
          </Button>
        ) : null}
        <Button variant="ghost" iconRight="chevron-up" data-action="collapse" onClick={onCollapse}>
          {t('infoWin.collapse')}
        </Button>
      </div>
    </section>
  );
}
