'use client';

/**
 * C6. FirstRowStrip — модуль / смуга «Перший ряд» (презентаційна) за макетами `Main`, `Desk-Moment`,
 * `Desk-Home-Handover` (модуль: заголовок · лічильник · рядок ціни, праворуч «Що входить» і «Зайняти місце»; стіна
 * одним рядом зі стрілками; після півночі — бігучий рядок) і `Phone-Home-Live` (смуга згортається: стіна двома рядами,
 * мініатюра, «Лишилось N місця», опис, кнопки). Примітка стриманого режиму.
 * Стани беремо з `view.state`; знижка пасу — окремий вигляд `pass-discount`. Логіку тримають інші модулі.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FirstRowWall } from '@/components/live/FirstRowWall';
import { EMOJI_SYMBOLS } from '@/components/live/SeatPill';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { Link } from '@/components/primitives/Link';
import { formatPrice } from '@/lib/firstrow/format';
import { formatClock } from '@/lib/i18n/time';
import home from '@/components/live/home.module.css';
import fr from './firstRow.module.css';
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
  onToggle,
  defaultOpen = true,
  dockBar = false,
  className,
}: FirstRowStripProps) {
  const t = useTranslations('firstRow');
  const compact = layout === 'compact';
  const [open, setOpen] = useState(defaultOpen);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const { state, price } = view;
  const sellable = price.current !== null && (state === 'empty' || state === 'open' || state === 'last3');
  const discounted = sellable && price.discountReason === 'pass' && price.discounted !== undefined;
  const stateName = discounted ? 'pass-discount' : state;
  const showCounter = state === 'empty' || state === 'open' || state === 'last3' || state === 'mine' || state === 'restrained';
  const showWall = state !== 'empty';
  const wallPhase = state === 'restrained' ? 'idle' : view.wall.phase;
  const mine = view.mySeat;
  const mineSeat = mine ? seats.find((s) => s.state === 'taken' && s.number === mine.number) : undefined;
  const mineName = mineSeat && mineSeat.state === 'taken' ? mineSeat.participant.name : '';
  const headingId = `first-row-strip-${view.eventId}`;
  const panelId = `${headingId}-panel`;

  const counter = showCounter ? (
    <span data-row="counter" className={fr.counter}>
      {state === 'empty' ? (
        `· ${t('allFree')}`
      ) : (
        <>
          <span aria-hidden="true">
            · {t('leftPrefix')} <b>{t('leftValue', { free: view.freeCount, total: view.total })}</b>
          </span>
          <span className="sr-only">{t('leftSpoken', { free: view.freeCount, total: view.total })}</span>
        </>
      )}
    </span>
  ) : null;

  const priceText =
    sellable && price.current !== null ? (
      discounted && price.discounted !== undefined ? (
        <span>
          <span className="sr-only">{t('priceFullSpoken', { full: formatPrice(price.current), discounted: formatPrice(price.discounted) })}</span>
          <span aria-hidden="true" className="inline-flex flex-wrap items-center gap-x-2">
            <s>{formatPrice(price.current)}</s>
            <span className="font-semibold text-highlight">{formatPrice(price.discounted)}</span>
            <Badge variant="discount">{t('discountBadge')}</Badge>
          </span>
          {' · '}
          {t('saleUntil', { time: formatClock(view.saleClosesAt) })}
        </span>
      ) : (
        <span>
          {t('pricePrefix')} <span className={fr.price}>{formatPrice(price.current)}</span> · {t('giftPassShort')} ·{' '}
          {t('saleUntil', { time: formatClock(view.saleClosesAt) })}
        </span>
      )
    ) : null;

  const tier =
    sellable && !discounted ? (
      <span data-row="tier" className={fr.tier}>
        {state === 'last3' ? t('tierLast3', { price: formatPrice(7.99) }) : t('tierHint', { price: formatPrice(7.99) })}
      </span>
    ) : null;

  const nextSaleText = nextSale ? t('nextSale', { city: nextSale.city, time: formatClock(nextSale.midnightMs) }) : '';
  const nextSaleNode = nextSale ? (
    <span data-row="next-sale">
      {nextSale.href ? (
        <Link href={nextSale.href} variant="inline">
          {nextSaleText}
        </Link>
      ) : (
        nextSaleText
      )}
    </span>
  ) : null;

  const soldOutNode =
    state === 'soldout' ? (
      <span>
        {t('soldOutNote')}
        {soldOutAlt ? (
          <>
            {' '}
            {t('moreSeats')}{' '}
            {soldOutAlt.href ? (
              <Link href={soldOutAlt.href} variant="inline">
                {t('heading', { city: soldOutAlt.city })}
              </Link>
            ) : (
              t('heading', { city: soldOutAlt.city })
            )}
          </>
        ) : null}
      </span>
    ) : null;

  const mineText =
    state === 'mine' && mine ? (
      <>
        <span className={fr.strong}>
          {t('yourSeat')} {mine.number}
        </span>
        {mineName ? ` · ${mineName}` : ''}
        {mine.greeting ? ` · «${mine.greeting}»` : ''} · {t('mySeatNote')}
      </>
    ) : null;

  const info = (
    <button type="button" data-action="info" aria-expanded={infoOpen} onClick={onInfo} className={cn('t2f-focus t2f-transition', fr.infoBtn)}>
      {t('infoToggle')}
    </button>
  );
  const take = (
    <Button variant={takeVariant} data-action="take" onClick={onTake} className={fr.takeBtn}>
      {t('take')}
    </Button>
  );
  const mineActions =
    state === 'mine' ? (
      <>
        <Button variant="tonal" compact data-action="emotion" onClick={onOpenEmoji}>
          <span aria-hidden="true">{EMOJI_SYMBOLS[mine?.emojiId ?? ''] ?? '✨'}</span>
          {t('myEmotion')}
        </Button>
        <Button variant="secondary" compact data-action="ticket" iconLeft="ticket" onClick={onOpenTicket}>
          {t('myTicket')}
        </Button>
      </>
    ) : null;

  const wall = showWall ? (
    <FirstRowWall
      city={city}
      seats={seats}
      freeCount={view.freeCount}
      phase={view.wall.phase}
      lightingFrom={view.wall.lightingFrom}
      restrained={state === 'restrained'}
      countryName={countryName}
      onOpenEmoji={onOpenEmoji}
      onTakeFree={sellable ? onTake : undefined}
      layout={compact ? 'wrap' : 'row'}
      ticker={!compact}
    />
  ) : null;

  const restrained =
    state === 'restrained' && restrainedNote ? (
      <p data-row="restrained" className={fr.meta}>
        {restrainedNote}
      </p>
    ) : null;

  const common = {
    'aria-labelledby': headingId,
    'data-first-row-strip': '',
    'data-state': stateName,
    'data-layout': layout,
    'data-midnight': midnightMs,
    'data-wall-phase': wallPhase,
  };

  if (compact) {
    return (
      <section {...common} data-open={open} className={cn(fr.strip, fr.compact, dockBar && fr.dockBar, className)}>
        <Heading className="m-0" {...(dockBar ? { 'data-dock-above': '' } : {})}>
          <button
            type="button"
            id={headingId}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => {
              setOpen((v) => !v);
              onToggle?.();
            }}
            className={cn('t2f-focus', fr.toggle)}
          >
            {dockBar ? <Icon name="ticket" size={16} className="text-highlight" /> : null}
            <span className={fr.heading}>{t('heading', { city })}</span>
            {counter}
            {state === 'soldout' ? (
              <span data-row="soldout" className={fr.counter}>
                · {t('soldOut')}
              </span>
            ) : null}
            <span className={fr.spacer} />
            <Icon name={open ? 'chevron-up' : dockBar ? 'chevron-right' : 'chevron-down'} size={18} className="text-text-secondary" />
          </button>
        </Heading>
        {/* Телефон-головна: панель лишається в DOM і згорнутою — стіна загоряється опівночі синхронно (як було з forceMount). */}
        {open || dockBar ? (
          <div id={panelId} className={fr.panel} hidden={!open}>
            {wall}
            {sellable || state === 'mine' || state === 'closed' || state === 'soldout' || restrained ? (
              <div className={cn(fr.details, !wall && 'border-t-0 pt-0')}>
                {sellable ? (
                  <>
                    <div className={fr.thumbRow}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- статичний експорт, мініатюра 80×80 */}
                      <img src="/images/first-row-thumb.jpg" alt="" width={40} height={40} className={fr.thumb} />
                      <div className="min-w-0">
                        <div className={fr.left}>{t.rich('leftCount', { count: view.freeCount, b: (c) => <b>{c}</b> })}</div>
                        <div data-row="price" className={fr.meta}>
                          {priceText}
                        </div>
                      </div>
                    </div>
                    <p className={fr.pitch}>{state === 'empty' ? t('emptyPitch') : t('pitch')}</p>
                    {tier ? <div className={cn(fr.meta, '-mt-1')}>{tier}</div> : null}
                    <div className={fr.phoneActions}>
                      {take}
                      {info}
                    </div>
                  </>
                ) : null}
                {state === 'mine' ? (
                  <>
                    <p className={fr.meta}>{mineText}</p>
                    <div className={cn(fr.phoneActions, 'flex-wrap')}>{mineActions}</div>
                  </>
                ) : null}
                {state === 'closed' ? (
                  <>
                    <div className={fr.thumbRow}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- статичний експорт, мініатюра 80×80 */}
                      <img src="/images/first-row-thumb.jpg" alt="" width={40} height={40} className={fr.thumb} />
                      <div data-row="closed" className={fr.left}>
                        {t('saleClosed')}
                      </div>
                    </div>
                    {nextSaleNode ? <p className={fr.pitch}>{nextSaleNode}</p> : null}
                    <div className={fr.phoneActions}>{info}</div>
                  </>
                ) : null}
                {soldOutNode ? <p className={fr.meta}>{soldOutNode}</p> : null}
                {restrained}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section {...common} className={cn(fr.strip, className)}>
      <div className={fr.head}>
        <Heading id={headingId} className={fr.heading}>
          {t('heading', { city })}
        </Heading>
        {counter}
        {state === 'soldout' ? (
          <span data-row="soldout" className={fr.counter}>
            · {t('soldOut')}
          </span>
        ) : null}
        {priceText || tier ? (
          <div data-row="price" className={fr.priceRow}>
            {priceText}
            {tier}
          </div>
        ) : null}
        {state === 'mine' ? <p className={fr.mineNote}>{mineText}</p> : null}
        {soldOutNode ? <p className={fr.mineNote}>{soldOutNode}</p> : null}
        {state === 'empty' ? <p className={fr.mineNote}>{t('emptyPitch')}</p> : null}
        <span className={fr.spacer} />
        {wallPhase !== 'idle' ? (
          <span className={fr.stateNote}>{t('lightingNote')}</span>
        ) : state === 'closed' ? (
          <span data-row="closed" className={fr.stateNote}>
            {t('saleClosed')}
          </span>
        ) : null}
        {sellable ? (
          <>
            {info}
            {take}
          </>
        ) : null}
        {state === 'restrained' ? info : null}
        {mineActions}
      </div>
      {wall}
      {restrained}
    </section>
  );
}

/** Рядок «Перший ряд» над вкладками у стані «Чат» на телефоні (`Phone-Chat`): «Перший ряд · Лондон · лишилось 2 з 10 ›». */
export function FirstRowChatRow({ city, freeCount, onClick, className }: FirstRowChatRowProps) {
  const t = useTranslations('firstRow');
  return (
    <button
      type="button"
      data-first-row-chat-row=""
      aria-label={t('chatRowLabel', { city, free: freeCount, total: 10 })}
      onClick={onClick}
      className={cn('t2f-focus t2f-transition hover:bg-surface', home.frRow, className)}
    >
      <Icon name="ticket" size={16} className="text-highlight" />
      <span aria-hidden="true" className={home.frRowTitle}>
        {t('heading', { city })}
      </span>
      <span aria-hidden="true" className={home.frRowCount}>
        · {t('leftPrefix')} <b>{t('leftValue', { free: freeCount, total: 10 })}</b>
      </span>
      <span className="flex-1" />
      <Icon name="chevron-right" size={16} className="text-text-secondary" />
    </button>
  );
}
