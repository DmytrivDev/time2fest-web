'use client';

/**
 * C16 `tips` — «Чайові» (O-TIPS, Phone-/Desk-Tips): SegmentedControl $2 / $5 / $10 (вибране — `surface-raised`
 * + межа `text`), коралова «Підтримати $N», примітка «Входити не треба — email попросить сторінка оплати».
 * Оплата — наступний етап: кнопка показує імітоване «Оплата буде на наступному етапі», без фальшивого чекаута.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { Link } from '@/components/primitives/Link';
import { SegmentedControl } from '@/components/primitives/SegmentedControl';
import { formatUsd, TIP_AMOUNTS, type TipAmount } from '@/lib/offers/format';
import { useRegisterCoral } from '@/lib/overlay/coral';
import { OfferCard, PaymentNotice } from './OfferCard';

export interface TipsProps {
  defaultAmount?: TipAmount;
  onClose?: () => void;
  /** Гість натиснув «Підтримати $N». */
  onSupport?: (amount: TipAmount) => void;
  /** Куди веде «Умови й повернення». */
  termsHref?: string;
  className?: string;
}

export function Tips({ defaultAmount = 2, onClose, onSupport, termsHref = '#', className }: TipsProps) {
  const t = useTranslations('offers');
  const [amount, setAmount] = useState<TipAmount>(defaultAmount);
  const [notice, setNotice] = useState(false);
  useRegisterCoral();

  return (
    <OfferCard variant="tips" title={t('tipsTitle')} closeLabel={t('dismiss')} onClose={onClose} className={className}>
      <p className="text-body text-text-secondary">{t('tipsLead')}</p>
      <SegmentedControl
        label={t('tipsAmount')}
        options={TIP_AMOUNTS.map((n) => ({ value: String(n), label: formatUsd(n) }))}
        value={String(amount)}
        onValueChange={(v) => setAmount(Number(v) as TipAmount)}
        className="self-start"
      />
      <Button
        variant="coral"
        size="lg"
        onClick={() => {
          setNotice(true);
          onSupport?.(amount);
        }}
      >
        {t('tipsAction', { amount: formatUsd(amount) })}
      </Button>
      {notice ? <PaymentNotice>{t('paymentLater')}</PaymentNotice> : null}
      <p className="text-caption text-text-muted">
        {t('tipsNote')}{' '}
        <Link href={termsHref} className="-my-3 inline-flex min-h-touch-min items-center font-semibold">
          {t('tipsTerms')}
        </Link>
      </p>
    </OfferCard>
  );
}
