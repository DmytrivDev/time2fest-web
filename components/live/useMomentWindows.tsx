'use client';

/**
 * Момент півночі на поверхні ефіру (T081, `contracts/ui-events.md`):
 * - `moment:stamp` (+15 с) — штамп в окремому блоці під рядком дій (`StampBlock`, не вікно — вікна збоку його не
 *   прибирають), одне оголошення «<Місто>: північ. Ачівка готова — під плеєром» (запізніле — без оголошення й без удару).
 * «Як тобі шоу?» — рядок у самому штампі з тієї ж миті (рішення власника 2026-11-01); окремої картки оцінки немає:
 * прибрали штамп «×» — прибрали й оцінку (оцінити можна в паспорті).
 * Нічого не лежить поверх плеєра.
 */
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { getData } from '@/lib/data/load';
import { on } from '@/lib/events/bus';
import { showStampMoment } from './StampBlock';

export function useMomentWindows(): void {
  const announce = useAnnounce();
  const tA11y = useTranslations('a11y');

  // +15 с: штамп + оголошення.
  useEffect(
    () =>
      on('moment:stamp', (p) => {
        if (!p.presentEventIds.length) return;
        showStampMoment(p.presentEventIds, !p.late);
        const city = getData().citiesById.get(p.announce.cityId)?.name.uk;
        if (city) announce(tA11y('midnightMoment', { place: city }), { late: p.late });
      }),
    [announce, tA11y],
  );
}
