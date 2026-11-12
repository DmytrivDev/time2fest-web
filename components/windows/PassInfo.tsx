'use client';

/**
 * C16 `pass-info` — «Що дає Новорічний пас» (O-PASS-INFO) і спільні блоки пасу для `pass-offer`:
 * три головні функції, «Ще в пасі:» (теги), ціна, «Оформити пас», «Детальніше».
 * Знижку −50% на «Перший ряд» (головна функція тим, хто писав у чаті) прибрано разом із рядом (рішення 2026-11-12).
 * Оплата поза цією областю: «Оформити пас» показує імітоване повідомлення (без фальшивої оплати).
 */
import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import { Icon } from '@/components/primitives/Icon';
import { formatUsd, PASS_PRICE } from '@/lib/offers/format';
import { useRegisterCoral } from '@/lib/overlay/coral';
import { OfferCard, PaymentNotice } from './OfferCard';

export interface PassFeature {
  key: 'schedule' | 'path' | 'card';
  title: string;
  text: string;
}

/** Три головні функції й теги «Ще в пасі:». */
export function usePassFeatures(): { main: PassFeature[]; also: string[] } {
  const t = useTranslations('pass');
  const main: PassFeature[] = [
    { key: 'schedule', title: t('schedule'), text: t('scheduleText') },
    { key: 'path', title: t('path'), text: t('pathText') },
    { key: 'card', title: t('card'), text: t('cardText') },
  ];
  return { main, also: [t('quiet'), t('alwaysVisible')] };
}

export function AlsoInPass({ items }: { items: string[] }) {
  const t = useTranslations('offers');
  return (
    <div className="flex flex-wrap items-center gap-2" data-row="also">
      <span className="text-caption text-text-muted">{t('alsoInPass')}</span>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item} className="rounded-full border border-border-strong bg-surface px-3 py-1 text-caption text-text-secondary">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PassPrice() {
  const t = useTranslations('offers');
  return (
    <p className="flex flex-wrap items-baseline gap-x-2" data-row="price">
      <span className="text-headline-sm text-text">{formatUsd(PASS_PRICE)}</span>
      <span className="text-caption text-text-muted">{t('priceNote')}</span>
    </p>
  );
}

export interface PassActionsProps {
  onGetPass?: () => void;
  onDetails?: () => void;
  /** Показати імітоване «Оплата буде на наступному етапі» (історії; на сайті «Оформити пас» веде до оформлення). */
  notice?: boolean;
}

/** Низ картки пасу: ціна, коралова «Оформити пас», «Детальніше» (якщо є куди вести). Єдина коралова кнопка картки. */
export function PassActions({ onGetPass, onDetails, notice }: PassActionsProps) {
  const t = useTranslations('offers');
  useRegisterCoral();
  return (
    <div className="flex flex-col gap-3">
      <PassPrice />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="coral" size="lg" onClick={onGetPass}>
          {t('getPass')}
        </Button>
        {onDetails ? (
          <Button variant="secondary" size="lg" onClick={onDetails}>
            {t('details')}
          </Button>
        ) : null}
      </div>
      {notice ? <PaymentNotice>{t('paymentLater')}</PaymentNotice> : null}
    </div>
  );
}

/** `compact` — лише назви (картка пропозиції); без нього ще й пояснення (O-PASS-INFO). */
export function MainFeatures({ items, compact = false }: { items: PassFeature[]; compact?: boolean }) {
  const t = useTranslations('pass');
  return (
    <ul aria-label={t('mainLabel')} className="flex flex-col gap-3" data-row="main">
      {items.map((f) => (
        <li key={f.key} className="flex items-start gap-3" data-feature={f.key}>
          <Icon name="check" size={18} className="mt-0.5 shrink-0 text-highlight" />
          <span className="flex flex-col">
            <span className="text-body-strong text-text">{f.title}</span>
            {compact ? null : <span className="text-body text-text-secondary">{f.text}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface PassInfoProps {
  onClose?: () => void;
  /** «Оформити пас»: вікно оформлення (трансляція грає) чи сторінка пасу. */
  onGetPass?: () => void;
  className?: string;
}

export function PassInfo({ onClose, onGetPass, className }: PassInfoProps) {
  const t = useTranslations('pass');
  const { main, also } = usePassFeatures();
  return (
    <OfferCard variant="pass-info" title={t('infoTitle')} closeLabel={t('infoDismiss')} onClose={onClose} className={className}>
      <MainFeatures items={main} />
      <AlsoInPass items={also} />
      <PassActions onGetPass={onGetPass} />
    </OfferCard>
  );
}
