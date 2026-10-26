'use client';

/**
 * C8 O-FIRST-ROW — форма покупки місця в «Першому ряду» (і її стани `declined`, `expired`). Лише тіло вікна:
 * заголовок і «Закрити» дає контейнер (Sheet на телефоні, ChatSlotPanel `accent` на десктопі).
 * Логіку (утримання, оплату, стор) тримають інші; тут тільки показ і колбеки (`components/firstrow/types.ts`).
 */
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { FirstRowFormProps } from '@/components/firstrow/types';
import { EMOJI_SYMBOLS } from '@/components/live/SeatPill';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { Link } from '@/components/primitives/Link';
import { RadioGroup } from '@/components/primitives/RadioGroup';
import { TextField } from '@/components/primitives/TextField';
import { Textarea } from '@/components/primitives/Textarea';
import { EMOJI_PICKER_IDS } from '@/components/windows/Emoji';
import type { Ms } from '@/lib/data/types';
import { PRICE_LAST3 } from '@/lib/engine/config';
import { formatHoldLeft, formatPrice } from '@/lib/firstrow/format';
import { GREETING_MAX, NAME_MAX } from '@/lib/firstrow/pay';
import { formatClock } from '@/lib/i18n/time';

/** Вісім емодзі, які показує форма «Першого ряду» (решта набору — у O-EMOJI). */
export const FIRST_ROW_EMOJI_IDS = EMOJI_PICKER_IDS.slice(0, 8);

/** Рядок «Північ о 22:00 за вашим часом · лишилось 4 з 10»; лічильник — ввічлива жива область. */
export function FirstRowHeaderLines({
  midnightMs,
  freeCount,
  total,
  className,
}: {
  midnightMs: Ms;
  freeCount: number;
  total: number;
  className?: string;
}) {
  const t = useTranslations('firstRow');
  return (
    <p className={cn('text-label-sm text-text-secondary', className)} data-row="header">
      {t('midnightAt', { time: formatClock(midnightMs) })} ·{' '}
      <span data-row="counter" aria-live="polite" aria-atomic="true" className="text-text">
        {t('left', { free: freeCount, total })}
      </span>
    </p>
  );
}

/** Прев’ю «Так тебе побачать на стіні»: ім’я й емоція в таблетці, як на стіні. */
export function FirstRowPreview({ name, emojiId, className }: { name: string; emojiId: string; className?: string }) {
  const t = useTranslations('firstRow');
  const names = useTranslations('windows.emoji.names');
  const known = names.has(emojiId as never);
  return (
    <section
      aria-label={t('form.preview')}
      className={cn('flex flex-col gap-2 rounded-md bg-surface px-3 py-2', className)}
      data-row="preview"
    >
      <p className="text-caption text-text-muted">{t('form.preview')}</p>
      <p className="inline-flex min-h-touch-min w-fit max-w-full items-center gap-2 rounded-full border border-highlight/40 bg-highlight-tint px-3.5 text-label-sm text-text">
        <span className="truncate">{name.trim() || t('form.name')}</span>
        {known ? (
          <span role="img" aria-label={names(emojiId as never)} className="leading-none">
            {EMOJI_SYMBOLS[emojiId] ?? '✨'}
          </span>
        ) : null}
      </p>
    </section>
  );
}

/** Вибір емоції (8 емодзі, сітка 4×2) з підписом і підказкою. */
export function FirstRowEmojiPick({
  value,
  onValueChange,
  disabled,
  hint,
  className,
  children,
}: {
  value: string;
  onValueChange(id: string): void;
  disabled?: boolean;
  hint?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const t = useTranslations('firstRow');
  const names = useTranslations('windows.emoji.names');
  return (
    <div className={cn('flex flex-col gap-1', className)} data-row="emoji">
      <p className="text-label-sm text-text-secondary">
        {t('form.emotion')} <span className="text-text-muted">· {hint ?? t('form.emotionHint')}</span>
      </p>
      <RadioGroup
        variant="grid"
        label={t('form.emotion')}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        options={FIRST_ROW_EMOJI_IDS.map((id) => ({ value: id, label: names(id), symbol: EMOJI_SYMBOLS[id] ?? '✨' }))}
      />
      {children}
    </div>
  );
}

export function FirstRowForm({
  city,
  midnightMs,
  freeCount,
  total,
  view,
  payPrice,
  holdUntil,
  holdBoard,
  holdWarning,
  extendedUntil,
  onExtend,
  announce,
  notice,
  values,
  onChange,
  errors,
  onPay,
  submitting = false,
  giftPass,
  onLoginForPass,
  onHelp,
  className,
}: FirstRowFormProps) {
  const t = useTranslations('firstRow');
  const discounted = view.price.discounted;
  const current = view.price.current;

  return (
    <form
      noValidate
      data-window="O-FIRST-ROW"
      data-phase={notice?.kind ?? 'form'}
      aria-label={t('heading', { city })}
      className={cn('flex flex-col gap-4', className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (!submitting) onPay();
      }}
    >
      <FirstRowHeaderLines midnightMs={midnightMs} freeCount={freeCount} total={total} />

      {notice?.kind === 'declined' ? (
        <div role="alert" data-row="notice" className="flex flex-col gap-1 rounded-md border border-primary bg-surface px-3 py-2">
          <p className="flex items-start gap-2 text-body-strong text-text">
            <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-primary" />
            {t('form.declined')}
          </p>
          <p className="ps-7 text-body text-text-secondary">{t('form.declinedHint')}</p>
          {onHelp ? (
            <Button type="button" variant="ghost" compact className="ms-7 w-fit" onClick={onHelp}>
              {t('form.help')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {notice?.kind === 'expired' ? (
        <div role="status" data-row="notice" className="flex flex-col gap-1 rounded-md border border-border-strong bg-surface px-3 py-2">
          <p className="flex items-start gap-2 text-body-strong text-text">
            <Icon name="clock" size={20} className="mt-0.5 shrink-0 text-text-secondary" />
            {t('form.expired')}
          </p>
          <p className="ps-7 text-body text-text-secondary">
            {notice.priceChanged
              ? t('form.expiredHint', { free: notice.free, price: formatPrice(notice.price), time: formatClock(notice.holdUntil) })
              : t('form.expiredSamePrice', { time: formatClock(notice.holdUntil) })}
          </p>
        </div>
      ) : null}

      <TextField
        label={t('form.email')}
        requiredMark={t('form.required')}
        type="email"
        value={values.email}
        onChange={(e) => onChange({ email: e.target.value })}
        autoComplete="email"
        inputMode="email"
        required
        hint={t('form.emailHint')}
        error={errors?.email ? t('form.emailError') : undefined}
      />
      {onLoginForPass ? (
        <p className="text-body text-text-secondary" data-row="login-pass">
          {t('form.passQuestion')}{' '}
          <button
            type="button"
            onClick={onLoginForPass}
            className="t2f-focus t2f-transition min-h-touch-min rounded-sm text-text underline underline-offset-2 hover:text-text-secondary"
          >
            {t('form.passLogin')}
          </button>{' '}
          {t('form.passTail')}
        </p>
      ) : null}

      <TextField
        label={t('form.name')}
        value={values.name}
        onChange={(e) => onChange({ name: e.target.value })}
        maxLength={NAME_MAX}
        counter
        autoComplete="nickname"
        hint={t('form.nameHint')}
        error={errors?.name ? t('form.nameError') : undefined}
      />
      <Textarea
        label={t('form.greeting')}
        value={values.greeting}
        onChange={(e) => onChange({ greeting: e.target.value })}
        maxLength={GREETING_MAX}
        counter
        hint={t('form.greetingHint')}
        error={errors?.greeting ? t('moderation') : undefined}
      />

      <FirstRowEmojiPick value={values.emojiId} onValueChange={(emojiId) => onChange({ emojiId })} />
      <FirstRowPreview name={values.name} emojiId={values.emojiId} />

      <div className="flex flex-col gap-2 rounded-md bg-surface px-3 py-2" data-row="hold">
        <p className="text-body-strong text-text" data-row="hold-until">
          {t('holdUntil', { time: formatClock(holdUntil) })}
        </p>
        {holdBoard ? (
          <p className="text-caption text-text-secondary" data-row="hold-board">
            {t('form.holdLeftOf', { time: formatHoldLeft(holdBoard.remainingMs), total: holdBoard.totalMin })}
          </p>
        ) : null}
        {holdWarning ? (
          <div className="flex flex-wrap items-center justify-between gap-2" data-row="hold-warning">
            <p className="text-body-strong text-primary">{t('extendNote')}</p>
            {holdWarning.canExtend ? (
              <Button type="button" variant="secondary" data-action="extend" onClick={onExtend}>
                {t('extend')}
              </Button>
            ) : null}
          </div>
        ) : null}
        {extendedUntil !== undefined ? (
          <p className="text-caption text-text-secondary" data-row="extended">
            {t('form.extended', { time: formatClock(extendedUntil) })}
          </p>
        ) : null}
        <p className="sr-only" aria-live="polite" aria-atomic="true" data-row="announce">
          {announce ?? ''}
        </p>
      </div>

      {view.priceChanged ? (
        <p role="status" data-row="price-changed" className="flex items-start gap-2 rounded-md border border-primary px-3 py-2 text-body-strong text-text">
          <Icon name="info" size={20} className="mt-0.5 shrink-0 text-primary" />
          {t('priceChanged', { newPrice: formatPrice(view.priceChanged.to), oldPrice: formatPrice(view.priceChanged.from) })}
        </p>
      ) : null}

      <div className="flex flex-col gap-1" data-row="price">
        {giftPass ? (
          <p className="flex items-center gap-2 text-body-strong text-text" data-row="gift-pass">
            <Icon name="ticket" size={18} className="text-highlight" />
            {t('giftPassShort')}
          </p>
        ) : null}
        {discounted !== undefined && current !== null ? (
          <p className="flex flex-wrap items-center gap-2 text-body text-text" data-row="discount">
            <span className="sr-only">{t('priceFullSpoken', { full: formatPrice(current), discounted: formatPrice(discounted) })}</span>
            <span aria-hidden="true" className="flex flex-wrap items-center gap-2">
              <s className="text-text-muted">{formatPrice(current)}</s>
              <strong className="text-body-strong">{formatPrice(discounted)}</strong>
              <Badge variant="discount">{t('discountWithPass')}</Badge>
            </span>
          </p>
        ) : null}
        {view.price.tier === 'base' ? (
          <p className="text-caption text-text-muted" data-row="tier-hint">
            {t('tierHint', { price: formatPrice(PRICE_LAST3) })}
          </p>
        ) : null}
      </div>

      <Button type="submit" variant="coral" size="lg" className="w-full" data-action="pay" loading={submitting}>
        {submitting ? t('form.submitting') : t('payAmount', { price: formatPrice(payPrice) })}
      </Button>
      <p className="text-caption text-text-muted">{t('form.payNote')}</p>
      <Link href="/legal/terms" variant="footer">
        {t('form.terms')}
      </Link>
    </form>
  );
}
