'use client';

/**
 * C8 O-FIRST-ROW — форма покупки місця в «Першому ряду» (і її стани `declined`, `expired`). Лише тіло вікна:
 * заголовок, підрядок «Північ о … · лишилось N з 10» і «Закрити» дає контейнер (Sheet на телефоні, ChatSlotPanel `accent`
 * на десктопі). Вигляд — макети `Desk-FR-Form` / `Phone-FR-Form` (`firstRowWindow.module.css`).
 * Логіку (утримання, оплату, стор) тримають інші; тут тільки показ і колбеки (`components/firstrow/types.ts`).
 */
import { RadioGroup as Radix } from 'radix-ui';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { FirstRowFormProps } from '@/components/firstrow/types';
import { EMOJI_SYMBOLS } from '@/components/live/SeatPill';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { Link } from '@/components/primitives/Link';
import { EMOJI_PICKER_IDS } from '@/components/windows/Emoji';
import { FlagField } from '@/components/windows/FlagField';
import s from '@/components/windows/firstRowWindow.module.css';
import { canonicalEmotion } from '@/lib/firstrow/emotions';
import { PRICE_LAST3 } from '@/lib/engine/config';
import { formatHoldLeft, formatPrice } from '@/lib/firstrow/format';
import { GREETING_MAX, NAME_MAX } from '@/lib/firstrow/pay';
import { getData } from '@/lib/data/load';
import { formatClock } from '@/lib/i18n/time';

/** Країни для вибору прапора (той самий список, що в O-NICK). */
let flagOptions: { code: string; name: string }[] | null = null;
function FLAG_OPTIONS() {
  flagOptions ??= getData().countries.map((c) => ({ code: c.flagCode, name: c.name.uk }));
  return flagOptions;
}

/** Вісім емодзі, які показує форма «Першого ряду» (решта набору — у O-EMOJI). */
export const FIRST_ROW_EMOJI_IDS = EMOJI_PICKER_IDS.slice(0, 8);

/** Поле форми за макетом: підпис `· уточнення`, лічильник праворуч, підказка й помилка під полем. */
export function FirstRowField({
  label,
  qualifier,
  value,
  onValueChange,
  max,
  counter,
  liveCounter,
  hint,
  error,
  extra,
  type = 'text',
  className,
  ...rest
}: {
  label: string;
  qualifier?: string;
  value: string;
  onValueChange(value: string): void;
  max?: number;
  counter?: boolean;
  liveCounter?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  /** Додатковий рядок під підказкою (напр. «Маєш Новорічний пас? Увійди»). */
  extra?: ReactNode;
  type?: 'text' | 'email';
  className?: string;
  required?: boolean;
  autoComplete?: string;
  inputMode?: 'email';
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-error`;
  const countId = `${id}-count`;
  const describedBy = [error ? errId : null, hint ? hintId : null, counter ? countId : null].filter(Boolean).join(' ') || undefined;
  const len = value.length;
  const state = max !== undefined && len >= max ? 'limit' : max !== undefined && len >= max - 5 ? 'near' : 'ok';
  return (
    <div className={cn(s.field, className)}>
      <div className={s.labelRow}>
        <label htmlFor={id} className={s.label}>
          {label}
          {qualifier ? <span className={s.qualifier}> · {qualifier}</span> : null}
        </label>
        {counter && max !== undefined ? (
          <span id={countId} className={s.counter} data-state={state} aria-live={liveCounter ? 'polite' : undefined}>
            {len}/{max}
          </span>
        ) : null}
      </div>
      <input
        id={id}
        type={type}
        value={value}
        maxLength={max}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onValueChange(e.target.value)}
        className={cn(s.input, 't2f-focus t2f-transition')}
        {...rest}
      />
      {error ? (
        <p id={errId} className={s.error}>
          <Icon name="alert" size={16} />
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className={s.hint}>
          {hint}
        </p>
      ) : null}
      {extra}
    </div>
  );
}

/** Прев’ю «Так тебе побачать на стіні»: прапор, ім’я й емоція в таблетці, як на стіні. */
export function FirstRowPreview({
  name,
  emojiId,
  flagCode,
  className,
  loose,
  children,
}: {
  name: string;
  emojiId: string;
  flagCode?: string;
  className?: string;
  /** Просторіший варіант (екран очікування): усередині ще рядок утримання. */
  loose?: boolean;
  children?: ReactNode;
}) {
  const t = useTranslations('firstRow');
  const names = useTranslations('windows.emoji.names');
  const id = canonicalEmotion(emojiId);
  const known = names.has(id);
  return (
    <section aria-label={t('form.preview')} className={cn(s.preview, loose && s.previewLoose, className)} data-row="preview">
      <p className={s.previewLabel}>{t('form.preview')}</p>
      <p className={s.pill}>
        {flagCode ? <Flag round code={flagCode} size="pill" decorative /> : null}
        <span className={s.pillName}>{name.trim() || t('form.name')}</span>
        {known ? (
          <span role="img" aria-label={names(id)} className={s.pillEmoji}>
            {EMOJI_SYMBOLS[id] ?? '✨'}
          </span>
        ) : null}
      </p>
      {children}
    </section>
  );
}

/** Вибір емоції (8 емодзі, сітка 4×2, круглі кнопки з підписами) і підпис `Емоція · підказка`. */
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
  /** Уточнення після «Емоція ·»; `null` — без нього. */
  hint?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const t = useTranslations('firstRow');
  const names = useTranslations('windows.emoji.names');
  const qualifier = hint === undefined ? t('form.emotionHint') : hint;
  return (
    <div className={cn(s.emotion, className)} data-row="emoji">
      <p className={s.legend}>
        {t('form.emotion')}
        {qualifier ? <span className={s.qualifier}> · {qualifier}</span> : null}
      </p>
      <Radix.Root aria-label={t('form.emotion')} value={value} disabled={disabled} onValueChange={onValueChange} orientation="horizontal" className={s.grid}>
        {FIRST_ROW_EMOJI_IDS.map((id) => (
          <Radix.Item key={id} value={id} aria-label={names(id)} className={cn(s.emo, 't2f-focus')}>
            <span aria-hidden="true" className={s.emoDot}>
              {EMOJI_SYMBOLS[id] ?? '✨'}
            </span>
            <span aria-hidden="true" className={s.emoName}>
              {names(id)}
            </span>
          </Radix.Item>
        ))}
      </Radix.Root>
      {children}
    </div>
  );
}

export function FirstRowForm({
  city,
  flagCode,
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
  flag,
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
  const formRef = useRef<HTMLFormElement>(null);
  // Після «Оплатити» з помилками — прокрутити до першого поля з помилкою й поставити в нього фокус (помилку вгорі
  // форми інакше не видно); під кнопкою — рядок «Перевір поля форми: …».
  const focusError = useRef(false);
  const errorKeys = (['email', 'name', 'greeting'] as const).filter((k) => errors?.[k]);
  const errorSig = errorKeys.join(',');
  useEffect(() => {
    if (!focusError.current || !errorSig) return;
    focusError.current = false;
    const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    first?.focus({ preventScroll: true });
    first?.scrollIntoView?.({ block: 'center' });
  }, [errorSig, errors]);
  const fieldName = { email: t('form.email'), name: t('form.name'), greeting: t('form.greeting') };

  return (
    <form
      ref={formRef}
      noValidate
      data-window="O-FIRST-ROW"
      data-phase={notice?.kind ?? 'form'}
      aria-label={t('heading', { city })}
      className={cn(s.body, className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (submitting) return;
        focusError.current = true;
        onPay();
      }}
    >
      {notice?.kind === 'declined' ? (
        <div role="alert" data-row="notice" className={s.alert}>
          <Icon name="alert" size={20} />
          <span className={s.alertText}>
            <strong>{t('form.declined')}</strong> {t('form.declinedHint')}
            {onHelp ? (
              <>
                <br />
                <button type="button" className={s.alertAction} onClick={onHelp}>
                  {t('form.help')}
                </button>
              </>
            ) : null}
          </span>
        </div>
      ) : null}
      {notice?.kind === 'expired' ? (
        <div role="alert" data-row="notice" className={s.alert}>
          <Icon name="clock" size={20} />
          <span className={s.alertText}>
            <strong>{t('form.expired')}</strong>
            <br />
            {notice.priceChanged ? (
              <>
                {t('form.expiredHint', { free: notice.free, price: formatPrice(notice.price) })}
                <br />
                {t('form.expiredHold', { time: formatClock(notice.holdUntil) })}
              </>
            ) : (
              t('form.expiredSamePrice', { time: formatClock(notice.holdUntil) })
            )}
          </span>
        </div>
      ) : null}

      <FirstRowField
        label={t('form.email')}
        qualifier={t('form.required')}
        type="email"
        value={values.email}
        onValueChange={(email) => onChange({ email })}
        autoComplete="email"
        inputMode="email"
        required
        hint={t('form.emailHint')}
        error={errors?.email ? t('form.emailError') : undefined}
        extra={
          onLoginForPass ? (
            <p className={s.hintStrong} data-row="login-pass">
              {t('form.passQuestion')}{' '}
              <button type="button" onClick={onLoginForPass} className={cn(s.passLink, 't2f-focus')}>
                {t('form.passLogin')}
              </button>{' '}
              {t('form.passTail')}
            </p>
          ) : null
        }
      />

      <FirstRowField
        label={t('form.name')}
        qualifier={t('form.nameHint')}
        value={values.name}
        onValueChange={(name) => onChange({ name })}
        max={NAME_MAX}
        counter
        liveCounter
        autoComplete="nickname"
        error={errors?.name ? t('form.nameError') : undefined}
      />
      {flag ? (
        <FlagField
          value={flagCode ?? 'earth'}
          onChange={flag.onChange}
          detectedFlag={flag.detected}
          undetected={flag.undetected}
          flags={FLAG_OPTIONS()}
        />
      ) : null}
      <FirstRowField
        label={t('form.greeting')}
        qualifier={t('form.greetingHint')}
        value={values.greeting}
        onValueChange={(greeting) => onChange({ greeting })}
        max={GREETING_MAX}
        counter
        error={errors?.greeting ? t('moderation') : undefined}
      />

      <FirstRowEmojiPick value={values.emojiId} onValueChange={(emojiId) => onChange({ emojiId })} />
      <FirstRowPreview name={values.name} emojiId={values.emojiId} flagCode={flagCode} />

      {view.priceChanged ? (
        <p role="status" data-row="price-changed" className={s.alert}>
          <Icon name="info" size={20} />
          <span className={s.alertText}>
            <strong>{t('priceChanged', { newPrice: formatPrice(view.priceChanged.to), oldPrice: formatPrice(view.priceChanged.from) })}</strong>
          </span>
        </p>
      ) : null}

      <div className={s.payGroup}>
        <div className={s.info} data-row="hold">
          <p className={s.holdLine} data-row="hold-until">
            <Icon name="clock" size={16} />
            {t('holdUntil', { time: formatClock(holdUntil) })}
          </p>
          {holdBoard ? (
            <p className={s.infoSecondary} data-row="hold-board">
              {t('form.holdLeftOf', { time: formatHoldLeft(holdBoard.remainingMs), total: holdBoard.totalMin })}
            </p>
          ) : null}
          {holdWarning ? (
            <div className={s.warn} data-row="hold-warning">
              <p className={s.warnText}>{t('extendNote')}</p>
              {holdWarning.canExtend ? (
                <Button type="button" variant="secondary" compact data-action="extend" onClick={onExtend}>
                  {t('extend')}
                </Button>
              ) : null}
            </div>
          ) : null}
          {extendedUntil !== undefined ? (
            <p className={s.infoSecondary} data-row="extended">
              {t('form.extended', { time: formatClock(extendedUntil) })}
            </p>
          ) : null}
          <p className="sr-only" aria-live="polite" aria-atomic="true" data-row="announce">
            {announce ?? ''}
          </p>
          {giftPass ? (
            <p className={s.infoSecondary} data-row="gift-pass">
              {t('giftPassShort')}
            </p>
          ) : null}
          {discounted !== undefined && current !== null ? (
            <p className={s.discount} data-row="discount">
              <span className="sr-only">{t('priceFullSpoken', { full: formatPrice(current), discounted: formatPrice(discounted) })}</span>
              <span aria-hidden="true" className={s.discount}>
                <s className="text-text-muted">{formatPrice(current)}</s>
                <strong className="text-body-strong">{formatPrice(discounted)}</strong>
                <Badge variant="discount">{t('discountWithPass')}</Badge>
              </span>
            </p>
          ) : null}
          <p className={s.infoMuted} data-row="tier-hint">
            {view.price.tier === 'base' ? t('tierHint', { price: formatPrice(PRICE_LAST3) }) : t('tierLast3', { price: formatPrice(PRICE_LAST3) })}
          </p>
        </div>

        <Button type="submit" variant="coral" size="lg" className="w-full" data-action="pay" loading={submitting}>
          {submitting ? t('form.submitting') : t('payAmount', { price: formatPrice(payPrice) })}
        </Button>
        <div aria-live="polite" data-row="fix-errors">
          {errorKeys.length ? (
            <p className={s.error}>
              <Icon name="alert" size={16} />
              {t('form.fixErrors', { fields: errorKeys.map((k) => fieldName[k]).join(', ') })}
            </p>
          ) : null}
        </div>
        <p className={s.centerNote}>
          <Icon name="lock" size={14} />
          {t('form.payNote')}
        </p>
        <div className={s.termsRow}>
          <Link href="/legal/terms" className={s.terms}>
            {t('form.terms')}
          </Link>
        </div>
      </div>
    </form>
  );
}
