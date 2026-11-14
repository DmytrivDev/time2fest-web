'use client';

/** Плитки рівнів тосту ($2 / $5 / $10) і перелік того, що дає рівень (галочки) — окремо від вікна, бо їх показує й `/support/`. */
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Emoji } from '@/components/primitives/Emoji';
import { Icon } from '@/components/primitives/Icon';
import { formatUsd, PASS_PRICE } from '@/lib/offers/format';
import { tierBenefits, TOAST_TIERS, type ToastTier } from '@/lib/toast/tiers';
import s from './toastWindow.module.css';

/** Емодзі рівня (фірмові значки). */
export const TIER_EMOJI: Record<ToastTier, string> = { 2: '🥂', 5: '🍾', 10: '🎆' };

/**
 * Плитки рівнів: радіогрупа «$2 · келих», «$5 · пляшка ігристого», «$10 · феєрверк». Без `onChange` — лише показ
 * (список, нічого не обрано): «Тости світу» до свята, коли тост ще не сказати (рішення власника 2026-11-13).
 */
export function ToastTiers({ value, onChange, phone }: { value?: ToastTier; onChange?: (v: ToastTier) => void; phone?: boolean }) {
  const t = useTranslations('toast');
  if (!onChange) {
    return (
      <ul aria-label={t('tiersLabel')} className={s.tiers} data-phone={phone || undefined} data-readonly="">
        {TOAST_TIERS.map((tier) => (
          <li key={tier} className={s.tier} data-tier={tier}>
            <Emoji char={TIER_EMOJI[tier]} size={19} />
            <b className={s.tierPrice}>{formatUsd(tier)}</b>
            <span className={s.tierName}>{t(`tiers.${tier}`)}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div role="radiogroup" aria-label={t('chooseTitle')} className={s.tiers} data-phone={phone || undefined}>
      {TOAST_TIERS.map((tier) => (
        <button
          key={tier}
          type="button"
          role="radio"
          aria-checked={tier === value}
          aria-label={t('tierLabel', { price: formatUsd(tier), name: t(`tiers.${tier}`) })}
          onClick={() => onChange(tier)}
          className={cn('t2f-focus', s.tier)}
          data-tier={tier}
        >
          <Emoji char={TIER_EMOJI[tier]} size={19} />
          <b className={s.tierPrice}>{formatUsd(tier)}</b>
          <span className={s.tierName}>{t(`tiers.${tier}`)}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Що дає обраний рівень (галочки) — під плитками. `readOnly` — без обраного рівня: усі пункти з рівнем, з якого діють
 * («з $2», «з $5», «з $10»), — «Тости світу» до свята.
 */
export function ToastBenefits({ tier, hasPass, readOnly }: { tier?: ToastTier; hasPass: boolean; readOnly?: boolean }) {
  const t = useTranslations('toast.benefits');
  if (readOnly || tier === undefined) {
    return (
      <ul className={s.benefits} aria-label={t('label')} data-toast-benefits="all">
        {tierBenefits(10, false).map((b) => (
          <li key={b.key} className={s.benefit} data-on="" data-benefit={b.key}>
            <span className={s.mark} aria-hidden="true">
              <Icon name="check" size={12} strokeWidth={3} />
            </span>
            <span className={s.benefitText}>{t(b.key)}</span>
            <span className={s.from}>{t('from', { price: formatUsd(b.from) })}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className={s.benefits} aria-label={t('label')} data-toast-benefits={tier}>
      {tierBenefits(tier, hasPass).map((b) =>
        b.owned ? (
          <li key={b.key} className={s.benefit} data-owned="">
            <span className={s.ownedIcon} aria-hidden="true">
              <Icon name="ticket" size={14} />
            </span>
            <span className={s.benefitText}>{t('passOwned')}</span>
          </li>
        ) : (
          <li key={b.key} className={s.benefit} data-on={b.included || undefined} data-benefit={b.key}>
            <span className={s.mark} aria-hidden="true">
              {b.included ? <Icon name="check" size={12} strokeWidth={3} /> : null}
            </span>
            <span className={s.benefitText}>
              {t(b.key)}
              {b.key === 'pass' && b.included ? <span className={s.apart}> {t('passApart', { price: formatUsd(PASS_PRICE) })}</span> : null}
              <span className="sr-only"> — {b.included ? t('included') : t('notIncluded')}</span>
            </span>
            {b.included ? null : (
              <span className={s.from} aria-hidden="true">
                {t('from', { price: formatUsd(b.from) })}
              </span>
            )}
          </li>
        ),
      )}
    </ul>
  );
}
