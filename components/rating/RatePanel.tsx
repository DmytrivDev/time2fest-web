'use client';

/**
 * «Оцінити» з колонки «Твоя оцінка» на сторінці «Рейтинг святкувань» (власник 2026-11-07): оцінка відкривається на місці
 * чату (на телефоні — шторкою) — листівка святкування, місто й зірки з підтвердженням; після — «Твоя оцінка · Дякуємо!».
 */
import { useTranslations } from 'next-intl';
import { FlagStrip } from '@/components/passport/FlagStrip';
import { Flag } from '@/components/primitives/Flag';
import { StampArt } from '@/components/windows/StampArt';
import { StampRate } from '@/components/windows/StampRate';
import { getData } from '@/lib/data/load';
import { useGuestStore } from '@/stores/guest';
import s from './rating.module.css';

export const RATE_PANEL_ID = 'O-RATING-RATE';

export function RatePanel({ eventId }: { eventId: string }) {
  const t = useTranslations('ratingPage');
  const tStamp = useTranslations('windows.achievement');
  const stars = useGuestStore((g) => g.rate[eventId]?.stars);
  const setRate = useGuestStore((g) => g.setRate);
  const data = getData();
  const e = data.eventsById.get(eventId);
  if (!e) return null;
  const country = data.countriesByIso.get(e.countryIso);
  const city = data.citiesById.get(e.cityId)?.name.uk ?? '';
  return (
    <div className={s.panel} data-rate-panel={eventId}>
      <div className={s.card}>
        <FlagStrip code={country?.flagCode ?? e.countryIso} />
        <StampArt illustrationId={country?.illustrationId ?? 'generic'} stampText={tStamp('stamped', { city: city.toLocaleUpperCase('uk') })} />
        <div className={s.cardBody}>
          <p className={s.cardCity}>
            <Flag code={country?.flagCode ?? e.countryIso} diameter={20} decorative />
            {city}
          </p>
          <p className={s.cardMeta}>{t('mainCelebration', { country: country?.name.uk ?? '' })}</p>
          <StampRate
            layout="compact"
            ratingLink={false}
            rows={[{ eventId, city }]}
            values={stars !== undefined ? { [eventId]: stars } : {}}
            onRate={(id, v) => setRate(id, { stars: v })}
            className={s.cardRate}
          />
        </div>
      </div>
    </div>
  );
}
