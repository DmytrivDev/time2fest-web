'use client';

/**
 * C6. FirstRowStrip — модуль / смуга «Перший ряд» (презентаційна) за дошками `Desk-FR-States` / `Phone-FR-States`
 * (рішення власника 2026-10-31):
 * - десктоп: заголовок · позначка (лічильник чи «Розпродано» / «Продаж закрито») · рядок під ним; праворуч дії
 *   («Що входить» + «Зайняти місце», «Моя емоція» + «Квиток · місце 9», «Ще є місця: … і ще N ›»); нижче стіна —
 *   один ряд, без стрілок, їде по колу. Відступи: 12/16, між рядами 12, у тексті 4.
 * - телефон: картка згортається; заголовок завжди в один рядок — назва (місто з трикрапкою) і коротка пігулка
 *   («8 з 10», «Розпродано», «Закрито», «Місце 9»); тіло з кроком 12: стіна двома рядами, під рискою — купівля,
 *   пояснення чи «Твоє місце».
 * Стани беремо з `view.state`; знижка пасу — окремий вигляд `pass-discount`. Логіку тримають інші модулі.
 */
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { FirstRowWall } from '@/components/live/FirstRowWall';
import { FirstRowPostcard } from './FirstRowPostcard';
import { EMOJI_SYMBOLS } from '@/components/live/SeatPill';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Reveal } from '@/components/primitives/Reveal';
import { Icon } from '@/components/primitives/Icon';
import { FIRSTROW_SALE_CLOSE } from '@/lib/engine/config';
import { formatPrice } from '@/lib/firstrow/format';
import { formatClock } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';
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
  onOpenParticipant,
  onSharePostcard,
  restrainedNote,
  soldOutAlt,
  countryName,
  layout = 'module',
  headingLevel = 2,
  onToggle,
  blocked,
  defaultOpen = true,
  dockBar = false,
  className,
}: FirstRowStripProps) {
  const t = useTranslations('firstRow');
  const now = useNow({ granularity: 'minute' });
  const compact = layout === 'compact';
  const [open, setOpen] = useState(defaultOpen);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const { state, price } = view;
  const sellable = price.current !== null && (state === 'empty' || state === 'open' || state === 'last3');
  const blockedNow = !!blocked && sellable;
  const discounted = sellable && price.discountReason === 'pass' && price.discounted !== undefined;
  const stateName = discounted ? 'pass-discount' : state;
  const wallPhase = state === 'restrained' ? 'idle' : view.wall.phase;
  const after = wallPhase !== 'idle';
  // «Продаж закрито» до півночі: або ще не відкрито (до 1 грудня), або вже закрито за 5 хв до півночі.
  const closedBefore = state === 'closed' && !after;
  const notOpenYet = closedBefore && now < view.saleClosesAt;
  const showWall = state !== 'empty';
  const mine = view.mySeat;
  const mineSeat = mine ? seats.find((s) => s.state === 'taken' && s.number === mine.number) : undefined;
  const mineName = mineSeat && mineSeat.state === 'taken' ? mineSeat.participant.name : '';
  const headingId = `first-row-strip-${view.eventId}`;
  const panelId = `${headingId}-panel`;
  const closeMin = Math.round(FIRSTROW_SALE_CLOSE / 60_000);
  const hot = state === 'last3';
  // Після півночі — листівка замість стіни й бігучого рядка (рішення власника 2026-10-31).
  const postcardOn = after && state !== 'restrained' && seats.some((s) => s.state === 'taken');
  const postcard = (kicker?: ReactNode) => (
    <FirstRowPostcard
      city={city}
      midnightMs={midnightMs}
      seats={seats}
      phase={view.wall.phase}
      lightingFrom={view.wall.lightingFrom}
      kicker={kicker}
      compact={compact}
      countryName={countryName}
      onOpenParticipant={onOpenParticipant}
      onOpenEmoji={onOpenEmoji}
      onShare={onSharePostcard}
    />
  );

  const leftSpoken = <span className="sr-only">{t('leftSpoken', { free: view.freeCount, total: view.total })}</span>;

  // ── Позначка біля назви (десктоп) ──────────────────────────────────────
  let meta: ReactNode = null;
  if (state === 'empty') {
    meta = (
      <span data-row="counter" className={fr.meta}>
        · <b className={fr.strong}>{t('allFreeMeta', { total: view.total })}</b> — {t('allFreeTail')}
      </span>
    );
  } else if (state === 'soldout') {
    meta = (
      <span data-row="soldout" className={fr.badge}>
        {t('soldOut')}
      </span>
    );
  } else if (closedBefore) {
    meta = (
      <span data-row="closed" className={fr.badge}>
        {t('saleClosedBadge')}
      </span>
    );
  } else if (!after && (sellable || state === 'mine' || state === 'restrained')) {
    meta = (
      <span data-row="counter" className={fr.meta}>
        <span aria-hidden="true">
          {t('leftPrefix')} <b className={cn(fr.strong, hot && fr.hot)}>{t('leftValue', { free: view.freeCount, total: view.total })}</b>
        </span>
        {leftSpoken}
        {hot && view.freeCount === 1 ? <b className={cn(fr.hot, 'ms-2.5')}>{t('lastSeat')}</b> : null}
      </span>
    );
  }

  // ── Рядок ціни ──────────────────────────────────────────────────────────
  const tierText = state === 'last3' ? t('tierLast3', { price: formatPrice(7.99) }) : t('tierHint', { price: formatPrice(7.99) });
  const priceNode =
    sellable && !blockedNow && price.current !== null ? (
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

  const mineLine =
    state === 'mine' && mine ? (
      <span>
        <b className={fr.hot}>
          {t('yourSeat')} {mine.number}
        </b>{' '}
        · {t('mySeatShort')}
      </span>
    ) : null;

  const closedLine = closedBefore ? <span>{notOpenYet ? t('saleNotOpen') : t('saleClosedNote', { min: closeMin })}</span> : null;

  // ── Дії ─────────────────────────────────────────────────────────────────
  const info = (
    <button type="button" data-action="info" aria-expanded={infoOpen} onClick={onInfo} className={cn('t2f-focus t2f-transition', fr.infoBtn, infoOpen && fr.infoOn)}>
      {t('infoToggle')}
    </button>
  );
  const take = (
    <Button variant={takeVariant} compact data-action="take" onClick={onTake} className={fr.takeBtn}>
      {t('take')}
    </Button>
  );
  const ownSeatBtn = blockedNow ? (
    <Button variant="secondary" compact data-action="own-seat" onClick={blocked!.onOwn}>
      {t('mySeatButton')}
    </Button>
  ) : null;
  const emotionBtn = (
    <Button variant="secondary" compact data-action="emotion" onClick={onOpenEmoji} className={fr.mineBtn}>
      {t('myEmotion')}
      <span aria-hidden="true" className={fr.emoji}>
        {EMOJI_SYMBOLS[mine?.emojiId ?? ''] ?? '✨'}
      </span>
    </Button>
  );
  const ticketBtn = (
    <Button variant="secondary" compact data-action="ticket" onClick={onOpenTicket} className={fr.mineBtn}>
      {t('myTicketSeat', { n: mine?.number ?? 0 })}
    </Button>
  );
  const moreLink = soldOutAlt ? (
    <button
      type="button"
      data-action="more"
      aria-haspopup="dialog"
      aria-expanded={soldOutAlt.open ?? false}
      onClick={soldOutAlt.onOpen}
      className={cn('t2f-focus t2f-transition', fr.moreBtn, soldOutAlt.open && fr.moreOn)}
    >
      {t('moreSeats')} <b>{t('heading', { city: soldOutAlt.city })}</b>
      {soldOutAlt.more > 0 ? ` ${t('moreCount', { count: soldOutAlt.more })}` : ''}
      <Icon name="chevron-right" size={16} />
    </button>
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
      onOpenParticipant={onOpenParticipant}
      onTakeFree={sellable && !blockedNow ? onTake : undefined}
      layout={compact ? 'wrap' : 'row'}
      ticker={!compact}
      bleed={compact ? 12 : 16}
    />
  ) : null;

  const restrained =
    state === 'restrained' && restrainedNote ? (
      <p data-row="restrained" className={fr.sub}>
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
    'data-postcard-on': postcardOn || undefined,
  };

  if (compact) {
    // Пігулка в заголовку — коротка, щоб назва з нею завжди влазила в один рядок (дошки 2026-10-31).
    let pill: ReactNode = null;
    if (postcardOn) pill = <span className={cn(fr.pill, fr.pillGold)}>{t('postcard.pill')}</span>;
    else if (state === 'empty') pill = <span className={fr.pill}>{t('pillAllFree', { total: view.total })}</span>;
    else if (state === 'soldout') pill = <span className={fr.pill}>{t('soldOut')}</span>;
    else if (closedBefore) pill = <span className={fr.pill}>{t('pillClosed')}</span>;
    else if (state === 'mine' && mine) pill = <span className={cn(fr.pill, fr.pillHot)}>{t('pillSeat', { n: mine.number })}</span>;
    else if (!after && (sellable || state === 'restrained'))
      pill = (
        <span data-row="counter" className={cn(fr.pill, hot && fr.pillHot)}>
          <span aria-hidden="true">{t('leftValue', { free: view.freeCount, total: view.total })}</span>
          {leftSpoken}
        </span>
      );

    const freeTitle =
      view.freeCount === 1 ? t.rich('leftLast', { b: (c) => <b>{c}</b> }) : t.rich('leftCount', { count: view.freeCount, b: (c) => <b>{c}</b> });
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
            {dockBar ? <Icon name="ticket" size={16} className="shrink-0 text-highlight" /> : null}
            <span className={fr.heading}>{t('heading', { city })}</span>
            {pill}
            <span className={fr.spacer} />
            <Icon name={open ? 'chevron-up' : dockBar ? 'chevron-right' : 'chevron-down'} size={18} className="shrink-0 text-text-secondary" />
          </button>
        </Heading>
        {/* Панель завжди в DOM і розгортається плавно (правило 2026-10-30); стіна загоряється опівночі синхронно. */}
        <Reveal open={open} id={panelId}>
          <div className={fr.panel}>
            {postcardOn ? postcard() : null}
            {!postcardOn && state === 'empty' && !blockedNow ? (
              <>
                <p className={fr.pitch}>{t('emptyPitch')}</p>
                <p data-row="price" className={fr.sub}>
                  {priceNode}
                  {!discounted ? (
                    <>
                      <br />
                      {tierText}
                    </>
                  ) : null}
                </p>
                <div className={fr.phoneActions}>
                  {take}
                  {info}
                </div>
              </>
            ) : null}
            {postcardOn ? null : wall}
            {blockedNow ? (
              <div className={fr.details}>
                <p data-row="blocked" className={fr.sub}>
                  {t('blocked', { city: blocked!.city })}
                </p>
                <div className={fr.phoneActions}>{ownSeatBtn}</div>
              </div>
            ) : null}
            {sellable && !blockedNow && state !== 'empty' ? (
              <div className={fr.details}>
                <div className={fr.left}>{freeTitle}</div>
                <p data-row="price" className={fr.sub}>
                  {priceNode}
                  {!discounted ? (
                    <>
                      <br />
                      {tierText}
                    </>
                  ) : null}
                </p>
                <div className={fr.phoneActions}>
                  {take}
                  {info}
                </div>
              </div>
            ) : null}
            {state === 'mine' && mine ? (
              <div className={fr.details}>
                <div className={fr.left}>
                  {t('yourSeat')} <b>{mine.number}</b>
                </div>
                {mineName || mine.greeting ? (
                  <p className={fr.sub}>
                    {mineName}
                    {mine.greeting ? ` · «${mine.greeting}»` : ''}
                  </p>
                ) : null}
                <p className={fr.pitch}>{t('mySeatNote')}</p>
                <div className={fr.phoneActions}>
                  {emotionBtn}
                  {ticketBtn}
                </div>
              </div>
            ) : null}
            {closedBefore ? (
              <div className={fr.details}>
                <p data-row="closed" className={fr.pitch}>
                  {notOpenYet ? t('saleNotOpen') : t('saleClosedNotePhone', { min: closeMin })}
                </p>
              </div>
            ) : null}
            {state === 'soldout' ? (
              <div className={fr.details}>
                <p className={fr.pitch}>{t('soldOutNote')}</p>
                {moreLink}
              </div>
            ) : null}
            {restrained ? <div className={fr.details}>{restrained}</div> : null}
          </div>
        </Reveal>
      </section>
    );
  }

  // ── Десктоп ─────────────────────────────────────────────────────────────
  let sub: ReactNode = null;
  if (blockedNow) sub = <span data-row="blocked">{t('blocked', { city: blocked!.city })}</span>;
  else if (priceNode)
    sub = (
      <>
        {priceNode}
        {!discounted ? <span data-row="tier">{tierText}</span> : null}
      </>
    );
  else if (mineLine) sub = mineLine;
  else if (state === 'soldout') sub = <span>{t('soldOutLine')}</span>;
  else if (closedLine) sub = closedLine;

  let actions: ReactNode = null;
  if (blockedNow) actions = ownSeatBtn;
  else if (sellable)
    actions = (
      <>
        {info}
        {take}
      </>
    );
  else if (state === 'mine')
    actions = (
      <>
        {emotionBtn}
        {ticketBtn}
      </>
    );
  else if (state === 'soldout') actions = moreLink;
  else if (state === 'restrained') actions = info;
  else if (after) actions = <span className={fr.stateNote}>{t('lightingNote')}</span>;

  if (postcardOn)
    return (
      <section {...common} className={cn(fr.strip, className)}>
        {postcard(
          <Heading id={headingId} className={fr.pcKicker}>
            {t('heading', { city })}
          </Heading>,
        )}
      </section>
    );

  return (
    <section {...common} className={cn(fr.strip, className)}>
      <div className={fr.top}>
        <div className={fr.text}>
          <div className={fr.titleLine}>
            <Heading id={headingId} className={fr.heading}>
              {t('heading', { city })}
            </Heading>
            {meta}
          </div>
          {sub ? (
            <div data-row="price" className={fr.subLine}>
              {sub}
            </div>
          ) : null}
        </div>
        {actions ? <div className={fr.actions}>{actions}</div> : null}
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
