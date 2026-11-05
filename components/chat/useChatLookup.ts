'use client';

import { useMemo } from 'react';
import { getData } from '@/lib/data/load';
import { zoneRowLabelOf } from '@/lib/firstrow/zone';
import type { MessageLookup } from './Message';

/** Назви країн за прапором/ISO, міст за `cityId` і «Першого ряду» поясу для рядків чату (лише називний відмінок). */
export function useChatLookup(): MessageLookup {
  return useMemo(() => {
    const data = getData();
    const byFlag = new Map(data.countries.map((c) => [c.flagCode, c]));
    return {
      countryName: (flag) => byFlag.get(flag)?.name.uk ?? data.countriesByIso.get(flag)?.name.uk,
      country: (iso) => data.countriesByIso.get(iso),
      cityName: (id) => data.citiesById.get(id)?.name.uk,
      firstRowLabel: (eventId) => zoneRowLabelOf(data, eventId) || undefined,
    };
  }, []);
}
