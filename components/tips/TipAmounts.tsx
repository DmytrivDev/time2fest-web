'use client';

/**
 * Суми чайових $2 🥂 келих · $5 🍾 пляшка ігристого · $10 🎆 феєрверк (дошки `Desk-Support-New`, `Desk-Tips-Toast`,
 * рішення власника 2026-11-07) — однаково в блоці під штампом, на сторінці «Підтримати» й у вікні «Чайові».
 */
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Emoji } from '@/components/primitives/Emoji';
import { formatUsd, TIP_AMOUNTS, type TipAmount } from '@/lib/offers/format';
import s from './tipAmounts.module.css';

const EMOJI: Record<TipAmount, string> = { 2: '🥂', 5: '🍾', 10: '🎆' };

export function TipAmounts({
  value,
  onChange,
  compact = false,
  disabled,
  className,
}: {
  value: TipAmount;
  onChange(v: TipAmount): void;
  /** Вікно на місці чату — нижчі плитки. */
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations('offers');
  return (
    <div role="radiogroup" aria-label={t('tipsAmount')} className={cn(s.amounts, compact && s.compact, className)}>
      {TIP_AMOUNTS.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${formatUsd(n)} · ${t(`tipKind.${n}`)}`}
          disabled={disabled}
          onClick={() => onChange(n)}
          className={cn('t2f-focus t2f-transition', s.amount)}
        >
          <Emoji char={EMOJI[n]} size={compact ? 18 : 22} />
          <b className={s.sum}>{formatUsd(n)}</b>
          <span className={s.kind}>{t(`tipKind.${n}`)}</span>
        </button>
      ))}
    </div>
  );
}
