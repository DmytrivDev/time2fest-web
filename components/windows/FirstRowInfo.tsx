'use client';

/**
 * C8. O-FIRST-ROW-INFO «Що дає «Перший ряд»» за дошками `Desk-FR-Info` / `Phone-FR-Info` (рішення власника 2026-10-31):
 * на десктопі — на місці чату, на телефоні — шторкою, як решта вікон. Переваги з іконками, блок «Новорічний пас у
 * подарунок» (з пасом — −50% на кожне місце), унизу — лишилось місць (крапки), ціна, «Зайняти місце» і «Закрити».
 * Шапку (заголовок, місто й північ, «×») дає вікно; `onBack` — «‹ До списку», коли вікно відкрите зі «Ще є місця».
 */
import { useTranslations } from 'next-intl';
import type { FirstRowInfoProps } from '@/components/firstrow/types';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { formatPrice } from '@/lib/firstrow/format';
import { formatClock } from '@/lib/i18n/time';
import win from './firstRowWin.module.css';

const BENEFITS: { key: 'wall' | 'animation' | 'chatNote' | 'greeting' | 'room' | 'stamp'; icon: IconName }[] = [
  { key: 'wall', icon: 'seat' },
  { key: 'animation', icon: 'sparkles' },
  { key: 'chatNote', icon: 'message' },
  { key: 'greeting', icon: 'clock' },
  { key: 'room', icon: 'users' },
  { key: 'stamp', icon: 'stamp' },
];

const TILE = 'flex size-8 shrink-0 items-center justify-center rounded-md bg-highlight-tint text-highlight';

export function FirstRowInfo({ city, view, hasPass = false, onTake, onClose, onBack, className }: FirstRowInfoProps) {
  const t = useTranslations('firstRow');
  const { price } = view;
  const current = price.current;
  const full = current ?? price.full;
  const half = Math.floor(full * 50) / 100;
  const taken = view.total - view.freeCount;
  const b = (c: React.ReactNode) => <b className="font-bold text-highlight">{c}</b>;
  return (
    <section data-window="O-FIRST-ROW-INFO" className={cn('flex min-h-full flex-col', className)}>
      <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-3.5">
        {onBack ? (
          <Button variant="ghost" compact iconLeft="chevron-left" data-action="back" onClick={onBack} className="-ms-3 self-start">
            {t('infoWin.back')}
          </Button>
        ) : null}
        <ul aria-label={t('infoTitle')} className="m-0 flex list-none flex-col gap-3 p-0">
          {BENEFITS.map(({ key, icon }) => (
            <li key={key} className="flex items-start gap-3">
              <span aria-hidden="true" className={TILE}>
                <Icon name={icon} size={18} />
              </span>
              <span className={win.perk}>{t(`benefits.${key}`, { city })}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-start gap-3 rounded-lg border border-highlight/20 bg-highlight-tint p-3" data-row="pass">
          <span aria-hidden="true" className={TILE}>
            <Icon name="ticket" size={18} />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-label-sm font-bold text-text">{hasPass ? t('infoWin.passHave') : t('infoWin.passTitle')}</span>
            <span className="text-caption text-text-secondary">
              {t.rich(hasPass ? 'infoWin.passHaveBody' : 'infoWin.passBody', { b, discounted: formatPrice(half), price: formatPrice(full) })}
            </span>
          </span>
        </div>
      </div>
      <div className="sticky bottom-0 flex flex-col gap-2.5 border-t border-border bg-surface px-4 pb-4 pt-3.5" data-row="buy">
        {current !== null ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-body-strong text-text">{t.rich('infoWin.leftOf', { b, free: view.freeCount, total: view.total })}</span>
              <span className="text-caption text-text-muted">{t('saleUntil', { time: formatClock(view.saleClosesAt) })}</span>
            </div>
            <div role="img" aria-label={t('infoWin.seatsSpoken', { taken, total: view.total })} className={win.dots}>
              {Array.from({ length: view.total }, (_, i) => (
                <span key={i} className={cn(win.dot, i < taken && win.dotTaken)} />
              ))}
            </div>
            <div className="flex flex-col gap-0.5 text-caption text-text-muted">
              <span>
                {t.rich('infoWin.priceLine', {
                  b: (c) => <b className="font-bold text-text">{c}</b>,
                  price: formatPrice(current),
                  discounted: formatPrice(Math.floor(current * 50) / 100),
                })}
              </span>
              <span>{view.state === 'last3' ? t('tierLast3', { price: formatPrice(7.99) }) : t('tierHint', { price: formatPrice(7.99) })}</span>
            </div>
          </>
        ) : (
          <p className={win.plain}>{t('infoWin.noSale')}</p>
        )}
        <div className="mt-0.5 flex gap-2">
          {onTake && current !== null ? (
            <Button variant="coral" size="lg" data-action="take" onClick={onTake} className="flex-1">
              {t('take')}
            </Button>
          ) : null}
          <Button variant="secondary" size="lg" data-action="close" onClick={onClose} className={cn(!(onTake && current !== null) && 'flex-1')}>
            {t('infoWin.close')}
          </Button>
        </div>
      </div>
    </section>
  );
}
