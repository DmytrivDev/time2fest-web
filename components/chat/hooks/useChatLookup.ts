'use client';

import { useMemo } from 'react';
import { getData } from '@/lib/data/load';
import type { MessageLookup } from '@/components/chat/parts/Message';

/** Назви країн за прапором/ISO і міст за `cityId` для рядків чату (лише називний відмінок). */
export function useChatLookup(): MessageLookup {
  return useMemo(() => {
    const data = getData();
    const byFlag = new Map(data.countries.map((c) => [c.flagCode, c]));
    return {
      countryName: (flag) => byFlag.get(flag)?.name.uk ?? data.countriesByIso.get(flag)?.name.uk,
      country: (iso) => data.countriesByIso.get(iso),
      cityName: (id) => data.citiesById.get(id)?.name.uk,
    };
  }, []);
}
