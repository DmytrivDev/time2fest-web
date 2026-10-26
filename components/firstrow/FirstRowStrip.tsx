'use client';

/**
 * C6. FirstRowStrip — модуль / смуга «Перший ряд» (презентаційна): заголовок з лічильником вільних місць, ціна,
 * ступінчаста ціна, кнопки «Зайняти місце» / «Що входить», стіна (C7), примітка стриманого режиму.
 * Стани беремо з `view.state`; знижка пасу — окремий вигляд `pass-discount`. Логіку тримають інші модулі.
 */
import { useTranslations } from 'next-intl';
import { FirstRowWall } from '@/components/live/FirstRowWall';
import { EMOJI_SYMBOLS } from '@/components/live/SeatPill';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { Link } from '@/components/primitives/Link';
import { formatPrice } from '@/lib/firstrow/format';
import { formatClock } from '@/lib/i18n/time';
import type { FirstRowChatRowProps, FirstRowStripProps } from './types';

export function FirstRowStrip({
  city,
  midnightMs,
  view,
  seats,
  takeVariant,
  onTake,
  onInfo,
  infoOpen = false,
  onOpenEmoji,
  onOpenTicket,
  restrainedNote,
  nextSale,
  soldOutAlt,
  countryName,
  layout = 'module',
  headingLevel = 2,
  className,
}: FirstRowStripProps) {
  const t = useTranslations('firstRow');
  const compact = layout === 'compact';
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const { state, price } = view;
  const sellable = price.current !== null && (state === 'empty' || state === 'open' || state === 'last3');
  const discounted = sellable && price.discountReason === 'pass' && price.discounted !== undefined;
  const stateName = discounted ? 'pass-discount' : state;
  const showCounter = state === 'empty' || state === 'open' || state === 'last3' || state === 'mine' || state === 'restrained';
  const showWall = state !== 'empty';
  const mine = view.mySeat;
  const mineSeat = mine ? seats.find((s) => s.state === 'taken' && s.number === mine.number) : undefined;
  const mineName = mineSeat && mineSeat.state === 'taken' ? mineSeat.participant.name : '';
  const headingId = `first-row-strip-${view.eventId}`;
  const sep = (
    <span aria-hidden="true" className="text-text-muted">
      ·
    </span>
  );

  const priceRow =
    sellable && price.current !== null ? (
      <p data-row="price" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body">
        {discounted && price.discounted !== undefined ? (
          <>
            <span className="sr-only">
              {t('priceFullSpoken', { full: formatPrice(price.current), discounted: formatPrice(price.discounted) })}
            </span>
            <span aria-hidden="true" className="inline-flex flex-wrap items-center gap-x-2">
              <s className="text-text-muted">{formatPrice(price.current)}</s>
              <span className="text-body-strong text-highlight">{formatPrice(price.discounted)}</span>
              <Badge variant="discount">{t('discountBadge')}</Badge>
            </span>
          </>
        ) : (
          <>
            <span>{t('price', { price: formatPrice(price.current) })}</span>
            {sep}
            <span>{t('giftPassShort')}</span>
          </>
        )}
        {sep}
        <span className="text-text-muted">{t('saleUntil', { time: formatClock(view.saleClosesAt) })}</span>
      </p>
    ) : null;

  let tierRow = null;
  if (sellable && !discounted) {
    tierRow =
      state === 'last3' ? (
        <p data-row="tier" className="text-label-sm text-text-muted">
          {t('tierLast3', { price: formatPrice(7.99) })}
        </p>
      ) : (
        <p data-row="tier" className="text-label-sm text-text-muted">
          {t('tierHint', { price: formatPrice(7.99) })}
        </p>
      );
  }

  const nextSaleText = nextSale ? t('nextSale', { city: nextSale.city, time: formatClock(nextSale.midnightMs) }) : '';

  return (
    <section
      aria-labelledby={headingId}
      data-first-row-strip=""
      data-state={stateName}
      data-layout={layout}
      data-midnight={midnightMs}
      className={cn('flex flex-col rounded-lg border border-border bg-surface', compact ? 'gap-2 p-3' : 'gap-3 p-4', className)}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Heading id={headingId} className="text-headline-sm text-highlight">
          {t('heading', { city })}
        </Heading>
        {state === 'soldout' ? (
          <span data-row="soldout" className="text-body-strong text-text">
            {t('soldOut')}
          </span>
        ) : null}
        {showCounter ? (
          <span data-row="counter" className="text-label-sm text-text-muted">
            {state === 'empty' ? (
              t('allFree')
            ) : (
              <>
                <span aria-hidden="true">{t('left', { free: view.freeCount, total: view.total })}</span>
                <span className="sr-only">{t('leftSpoken', { free: view.freeCount, total: view.total })}</span>
              </>
            )}
          </span>
        ) : null}
      </div>

      {state === 'empty' ? <p className="text-body text-text-secondary">{t('emptyPitch')}</p> : null}

      {state === 'mine' && mine ? (
        <div className="flex flex-col gap-1">
          <p className="text-body-strong text-text">
            {t('yourSeat')} {mine.number}
            {mineName ? <span className="text-text-secondary"> · {mineName}</span> : null}
            {mine.greeting ? <span className="text-text-secondary"> · «{mine.greeting}»</span> : null}
          </p>
          <p className="text-label-sm text-text-muted">{t('mySeatNote')}</p>
        </div>
      ) : null}

      {state === 'closed' ? (
        <div className="flex flex-col gap-1">
          <p data-row="closed" className="text-body-strong text-text">
            {t('saleClosed')}
          </p>
          {nextSale ? (
            <p data-row="next-sale" className="text-label-sm text-text-secondary">
              {nextSale.href ? (
                <Link href={nextSale.href} variant="inline">
                  {nextSaleText}
                </Link>
              ) : (
                nextSaleText
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      {state === 'soldout' ? (
        <div className="flex flex-col gap-1">
          <p className="text-body text-text-secondary">{t('soldOutNote')}</p>
          {soldOutAlt ? (
            <p className="text-label-sm text-text-secondary">
              <span>{t('moreSeats')} </span>
              {soldOutAlt.href ? (
                <Link href={soldOutAlt.href} variant="inline">
                  {t('heading', { city: soldOutAlt.city })}
                </Link>
              ) : (
                t('heading', { city: soldOutAlt.city })
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      {priceRow}
      {tierRow}

      {sellable || state === 'mine' || state === 'restrained' ? (
        <div className="flex flex-wrap items-center gap-2">
          {sellable ? (
            <Button variant={takeVariant} data-action="take" onClick={onTake}>
              {t('take')}
            </Button>
          ) : null}
          {state === 'mine' ? (
            <>
              <Button variant="tonal" data-action="emotion" onClick={onOpenEmoji}>
                <span aria-hidden="true">{EMOJI_SYMBOLS[mine?.emojiId ?? ''] ?? '✨'}</span>
                {t('myEmotion')}
              </Button>
              <Button variant="secondary" data-action="ticket" iconLeft="ticket" onClick={onOpenTicket}>
                {t('myTicket')}
              </Button>
            </>
          ) : (
            <Button variant="secondary" data-action="info" aria-expanded={infoOpen} onClick={onInfo}>
              {t('infoToggle')}
            </Button>
          )}
        </div>
      ) : null}

      {showWall ? (
        <FirstRowWall
          city={city}
          seats={seats}
          freeCount={view.freeCount}
          phase={view.wall.phase}
          lightingFrom={view.wall.lightingFrom}
          restrained={state === 'restrained'}
          countryName={countryName}
          onOpenEmoji={onOpenEmoji}
        />
      ) : null}

      {state === 'restrained' && restrainedNote ? (
        <p data-row="restrained" className="text-label-sm text-text-muted">
          {restrainedNote}
        </p>
      ) : null}
    </section>
  );
}

/** Рядок у вкладці «Чат» на телефоні: «Перший ряд · Лондон · 8 ›». */
export function FirstRowChatRow({ city, freeCount, onClick, className }: FirstRowChatRowProps) {
  const t = useTranslations('firstRow');
  return (
    <button
      type="button"
      data-first-row-chat-row=""
      aria-label={t('chatRowLabel', { city, free: freeCount, total: 10 })}
      onClick={onClick}
      className={cn(
        't2f-focus t2f-transition flex min-h-touch-min w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-start text-label-sm text-highlight hover:bg-surface-raised',
        className,
      )}
    >
      <span aria-hidden="true">{t('chatRow', { city, free: freeCount })}</span>
      <Icon name="chevron-right" size={16} />
    </button>
  );
}
