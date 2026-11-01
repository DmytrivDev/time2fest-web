'use client';

/**
 * C16 `pass-offer` — «Уже 2 країни у твоєму паспорті» (O-PASS-OFFER, FR-063, Phone-/Desk-Pass-Offer).
 * Картка в потоці під відео (`inflow`): країни паспорта (прапор + назва в називному), одна фраза,
 * 3 головні функції, «Ще в пасі:», ціна «разово, на весь сезон · без підписки», коралова «Оформити пас», «Детальніше».
 * Коли показувати — рішення `offerEligibility` (не раніше +5 хв, не пізніше −10 хв до наступної, після оцінки,
 * одна за раз, не під час введення); тут лише вигляд. Оплата — наступний етап: імітоване повідомлення.
 */
import { useTranslations } from 'next-intl';
import { Flag } from '@/components/primitives/Flag';
import { AlsoInPass, MainFeatures, PassActions, usePassFeatures } from './PassInfo';
import { OfferCard } from './OfferCard';

export interface PassOfferCountry {
  iso: string;
  /** Назва країни в називному відмінку. */
  name: string;
  flagCode: string;
}

export interface PassOfferProps {
  /** Скільки Нових років зустрінуто (з `offer:show.stampCount`). */
  count: number;
  countries: PassOfferCountry[];
  wroteInChat?: boolean;
  onClose?: () => void;
  onDetails?: () => void;
  onGetPass?: () => void;
  className?: string;
}

export function PassOffer({ count, countries, wroteInChat = false, onClose, onDetails, onGetPass, className }: PassOfferProps) {
  const t = useTranslations('offers');
  const { main, also } = usePassFeatures(wroteInChat);
  return (
    <OfferCard variant="pass-offer" title={t('passTitle', { count })} closeLabel={t('dismiss')} onClose={onClose} className={className}>
      {countries.length ? (
        <ul aria-label={t('countriesLabel')} className="flex flex-wrap gap-x-4 gap-y-1" data-row="countries">
          {countries.map((c) => (
            <li key={c.iso} className="flex items-center gap-2 text-label-sm text-text-secondary">
              <Flag round code={c.flagCode} size="sm" decorative />
              {c.name}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-body text-text-secondary">{t('passLead')}</p>
      <MainFeatures items={main} compact />
      <AlsoInPass items={also} />
      <PassActions onDetails={onDetails} onGetPass={onGetPass} />
    </OfferCard>
  );
}
