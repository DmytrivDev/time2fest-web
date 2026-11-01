'use client';

/**
 * C16 `tips` — «Чайові · Скажи тост на весь світ» (дошка `Desk-Offers-Concepts`, варіант C, рішення власника 2026-11-01):
 * чайові дають щось видиме — золотий тост від імені гостя в чаті «Світ». Тост можна написати самому (поле — у самому
 * «повідомленні»-прев’ю), суми $2 / $5 / $10 — великі сегменти, коралова «Підтримати $N».
 * Десктоп — дві колонки (текст і тост ліворуч, суми й кнопка праворуч), телефон — стовпчик.
 * Оплата — наступний етап: після «Підтримати» тост одразу з’являється в чаті, а рядок пояснює, що оплата через
 * PayPro підключиться пізніше (без фальшивого чекаута).
 */
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Link } from '@/components/primitives/Link';
import { formatUsd, TIP_AMOUNTS, type TipAmount } from '@/lib/offers/format';
import { useRegisterCoral } from '@/lib/overlay/coral';
import { OfferCard, PaymentNotice } from './OfferCard';
import s from './tips.module.css';

/** Найдовший тост — як підпис у чаті, коротко. */
export const TOAST_MAX = 120;
const LINK = /(https?:\/\/|www\.)/i;

export interface TipsProps {
  defaultAmount?: TipAmount;
  /** Хто піднімає тост (нік і прапор гостя) — для прев’ю; без ніка — «Гість». */
  nick?: string;
  flagCode?: string;
  onClose?: () => void;
  /** «Підтримати $N»: сума й текст тосту. */
  onSupport?: (amount: TipAmount, toast: string) => void;
  /** Куди веде «Умови й повернення». */
  termsHref?: string;
  className?: string;
}

export function Tips({ defaultAmount = 5, nick, flagCode, onClose, onSupport, termsHref = '#', className }: TipsProps) {
  const t = useTranslations('offers');
  const [amount, setAmount] = useState<TipAmount>(defaultAmount);
  const [text, setText] = useState(() => t('toastDefault'));
  const [sent, setSent] = useState(false);
  const fieldId = useId();
  useRegisterCoral(!sent);

  const clean = text.trim();
  const bad = !clean || LINK.test(clean);

  return (
    <OfferCard variant="tips" kicker={t('tipsTitle')} title={t('toastTitle')} closeLabel={t('dismiss')} onClose={onClose} className={className}>
      <div className={s.grid}>
        <div className={s.left}>
          <p className="text-body text-text-secondary">{t('toastLead')}</p>
          {/* Прев’ю тосту — це й є поле: що написано, те й з’явиться в чаті. */}
          <div className={s.bubble} data-toast-preview="">
            <span className={s.who}>
              {flagCode ? <Flag round code={flagCode} size="xs" decorative /> : null}
              <span className={s.nick}>{nick || t('toastGuest')}</span>
              <span className="t2f-toast-badge">{t('toastBadge')}</span>
            </span>
            <label htmlFor={fieldId} className="sr-only">
              {t('toastField')}
            </label>
            <textarea
              id={fieldId}
              value={text}
              maxLength={TOAST_MAX}
              rows={2}
              disabled={sent}
              onChange={(e) => setText(e.target.value)}
              className={cn('t2f-focus', s.field)}
            />
          </div>
          {LINK.test(clean) ? <p className="text-caption text-primary">{t('toastNoLinks')}</p> : null}
        </div>
        <div className={s.right}>
          <div role="radiogroup" aria-label={t('tipsAmount')} className={s.amounts}>
            {TIP_AMOUNTS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={amount === n}
                disabled={sent}
                onClick={() => setAmount(n)}
                className={cn('t2f-focus t2f-transition', s.amount)}
              >
                {formatUsd(n)}
              </button>
            ))}
          </div>
          <Button
            variant={sent ? 'secondary' : 'coral'}
            size="lg"
            iconLeft={sent ? 'check' : undefined}
            disabled={sent || bad}
            onClick={() => {
              setSent(true);
              onSupport?.(amount, clean);
            }}
          >
            {sent ? t('toastSent') : t('tipsAction', { amount: formatUsd(amount) })}
          </Button>
          {sent ? <PaymentNotice>{t('toastThanks')}</PaymentNotice> : null}
          <p className="text-caption text-text-muted">
            {t('tipsNote')}{' '}
            <Link href={termsHref} className="-my-3 inline-flex min-h-touch-min items-center font-semibold">
              {t('tipsTerms')}
            </Link>
          </p>
        </div>
      </div>
    </OfferCard>
  );
}
