'use client';

/**
 * Спільне для сторінок мовного дерева (`app/[locale]`): каталог і модель мовою сторінки, час за годинником відвідувача,
 * адреси з мовою, місця для фото. Блоки головної «до свята» (`components/prefest`) беруть усе це з `usePrefest()`.
 */
import { useMemo, useState, type ReactNode } from 'react';
import mediaJson from '@/data/prelaunch/media.json';
import {
  PrefestProvider,
  type MediaItem,
  type PrefestSite,
} from '@/components/prefest/PrefestContext';
import { getData } from '@/lib/data/load';
import { setDefaultTimeLocale, viewerZoneLabel } from '@/lib/i18n/time';
import { buildPrefestModel } from '@/lib/prefest/model';
import { countryPath, localeHref } from '@/lib/prelaunch/href';
import {
  COUNTRY_EXTRAS,
  inCountryOf,
  labelFor,
  localizeDataset,
  type SiteData,
} from '@/lib/prelaunch/site';
import { createDeviceTimeSource } from '@/lib/time/deviceTimeSource';
import { TimeProvider } from '@/lib/time/TimeProvider';

const MEDIA = (mediaJson as { items: Record<string, MediaItem> }).items;

/** Назви поясів IANA, що не збігаються з ідентифікатором міста в каталозі. */
const ZONE_CITY_IDS: Record<string, string> = {
  kiev: 'kyiv',
  saigon: 'ho-chi-minh',
  ho_chi_minh: 'ho-chi-minh',
  calcutta: 'new-delhi',
  kolkata: 'new-delhi',
  katmandu: 'kathmandu',
  rangoon: 'yangon',
  godthab: 'nuuk',
  sao_paulo: 'rio-de-janeiro',
};

export function SiteProvider({ site, children }: { site: SiteData; children: ReactNode }) {
  // У браузері сторінка має одну мову; час, що залежить від відвідувача, малюється лише після гідратації.
  setDefaultTimeLocale(site.locale);
  const [source] = useState(createDeviceTimeSource);
  const value = useMemo(() => {
    const base = getData();
    const data = localizeDataset(base, site);
    const href = (path: string) => localeHref(site.locale, path);
    const model = buildPrefestModel(data, {
      locale: site.locale,
      href: (c) => href(countryPath(COUNTRY_EXTRAS[c.iso]?.urlSlug ?? c.slug)),
      mainCityId: (iso) => COUNTRY_EXTRAS[iso]?.mainCityId,
      label: labelFor(base, site),
    });
    const prefestSite: PrefestSite = {
      locale: site.locale,
      href,
      media: MEDIA,
      inCountry: (iso) => inCountryOf(site, iso),
      zoneCity: (timeZone) => {
        const raw = (timeZone.split('/').pop() ?? '').toLowerCase();
        const city = data.citiesById.get(ZONE_CITY_IDS[raw] ?? raw.replace(/_/g, '-'));
        if (city) return city.name.uk;
        // Української назви немає — краще без міста, ніж латинкою («за твоїм часом»).
        return site.locale === 'uk' ? '' : viewerZoneLabel(timeZone);
      },
    };
    return { data, model, prefestSite };
  }, [site]);
  return (
    <TimeProvider source={source}>
      <PrefestProvider model={value.model} data={value.data} site={value.prefestSite}>
        {children}
      </PrefestProvider>
    </TimeProvider>
  );
}
