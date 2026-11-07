'use client';

/**
 * C16 `tips` — «Чайові · Скажи тост на весь світ». Спрощений блок (дошка `Desk-Tips-Toast`, рішення власника 2026-11-07):
 * поля тосту в блоці немає — приклад золотого тосту, суми $2 🥂 / $5 🍾 / $10 🎆 з підписами, коралова «Підтримати $N»
 * і «Тост напишеш, поки оплачуєш». Тост пишуть у вікні «Чайові» на місці чату / шторкою, поки оплачують (варіант B).
 * Той самий блок — під штампом на головній (з «×») і на сторінці «Підтримати» (без «×»).
 * Десктоп — дві колонки (текст і приклад ліворуч, суми й кнопка праворуч), телефон — стовпчик.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { EmojiText } from '@/components/primitives/Emoji';
import { Flag } from '@/components/primitives/Flag';
import { Link } from '@/components/primitives/Link';
import { TipAmounts } from '@/components/tips/TipAmounts';
import { formatUsd, type TipAmount } from '@/lib/offers/format';
import { useRegisterCoral } from '@/lib/overlay/coral';
import { OfferCard } from './OfferCard';
import s from './tips.module.css';

export interface TipsProps {
  defaultAmount?: TipAmount;
  /** «×» — лише в блоці під штампом; на сторінці «Підтримати» блок не закривається. */
  onClose?: () => void;
  /** «Підтримати $N» — відкриває вікно оплати, де пишуть тост. */
  onSupport?: (amount: TipAmount) => void;
  /** Куди веде «Умови й повернення». */
  termsHref?: string;
  /** Рівень заголовка (на сторінці «Підтримати» — після `h1`). */
  className?: string;
}

export function Tips({ defaultAmount = 5, onClose, onSupport, termsHref = '#', className }: TipsProps) {
  const t = useTranslations('offers');
  const [amount, setAmount] = useState<TipAmount>(defaultAmount);
  useRegisterCoral();

  return (
    <OfferCard variant="tips" kicker={t('tipsTitle')} title={t('toastTitle')} closeLabel={t('dismiss')} onClose={onClose} className={className}>
      <div className={s.grid}>
        <div className={s.left}>
          <p className="text-body text-text-secondary">{t('toastLead')}</p>
          {/* Приклад — як виглядатиме тост у чаті «Світ». */}
          <div className={s.bubble} data-toast-preview="">
            <span className={s.who}>
              <Flag round code="JP" size="xs" decorative />
              <span className={s.nick}>Hiro</span>
              <span className="t2f-toast-badge">{t('toastBadge')}</span>
              <span className={s.example}>{t('toastExample')}</span>
            </span>
            <span className={s.text}>
              <EmojiText text={t('toastExampleText')} />
            </span>
          </div>
        </div>
        <div className={s.right}>
          <TipAmounts value={amount} onChange={setAmount} />
          <Button variant="coral" size="lg" onClick={() => onSupport?.(amount)}>
            {t('tipsAction', { amount: formatUsd(amount) })}
          </Button>
          <p className={cn('text-caption text-text-muted', s.note)}>
            {t('tipsNoteToast')}{' '}
            <Link href={termsHref} className="-my-3 inline-flex min-h-touch-min items-center font-semibold">
              {t('tipsTerms')}
            </Link>
          </p>
        </div>
      </div>
    </OfferCard>
  );
}
