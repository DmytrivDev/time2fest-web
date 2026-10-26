'use client';

/**
 * C16 `pass-gate` — «Потрібен пас» (O-PASS-GATE, Phone-/Desk-Pass-Gate): текст залежить від функції пасу, до якої
 * дотягнулась людина без пасу (графік, тихий режим чату, друге нагадування). Дія одна й нейтральна — «Що дає пас»
 * (коралової кнопки немає: це підказка, а не продаж); для графіка й нагадування — «Перше нагадування — безплатно».
 */
import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import { OfferCard } from './OfferCard';

export type PassGateFeature = 'schedule' | 'quiet-mode' | 'second-reminder';

export interface PassGateProps {
  feature?: PassGateFeature;
  onClose?: () => void;
  /** «Що дає пас» → відкрити `pass-info`. */
  onWhatPassGives?: () => void;
  className?: string;
}

export function PassGate({ feature = 'schedule', onClose, onWhatPassGives, className }: PassGateProps) {
  const t = useTranslations('pass');
  const title =
    feature === 'quiet-mode' ? t('gateTitleQuiet') : feature === 'second-reminder' ? t('gateTitleReminder') : t('gateTitleSchedule');
  const text =
    feature === 'quiet-mode' ? t('gateTextQuiet') : feature === 'second-reminder' ? t('gateTextReminder') : t('gateTextSchedule');
  return (
    <OfferCard variant="pass-gate" title={title} closeLabel={t('gateDismiss')} onClose={onClose} className={className}>
      <p className="text-body text-text-secondary">{text}</p>
      {feature !== 'quiet-mode' ? (
        <p className="text-caption text-text-muted" data-row="free">
          <span className="text-body-strong text-text">{t('gateFree')}</span> {t('gateFreeWhere')}
        </p>
      ) : null}
      <Button variant="tonal" size="lg" className="self-start" onClick={onWhatPassGives}>
        {t('gateWhat')}
      </Button>
    </OfferCard>
  );
}
