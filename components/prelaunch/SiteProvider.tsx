'use client';

/**
 * Спільне для сторінок мовного дерева (`app/[locale]`): каталог і модель мовою сторінки, час за годинником відвідувача,
 * адреси з мовою, місця для фото. Блоки головної «до свята» (`components/prefest`) беруть усе це з `usePrefest()`.
 */
import { NextIntlClientProvider, useMessages } from 'next-intl';
import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import expectedJson from '@/content/prelaunch/expected-streams.json';
import mediaJson from '@/data/prelaunch/media.json';
import type { ExpectedKind } from '@/components/map/mapPrefest';
import {
  PrefestProvider,
  type MediaItem,
  type PrefestSite,
} from '@/components/prefest/PrefestContext';
import { getData } from '@/lib/data/load';
import { holdViewerTimeZoneUtc, setDefaultTimeLocale, viewerZoneLabel } from '@/lib/i18n/time';
import { buildPrefestModel, MAIN_CELEBRATIONS } from '@/lib/prefest/model';
import { countryPath, localeHref } from '@/lib/prelaunch/href';
import {
  COUNTRY_EXTRAS,
  inCountryOf,
  labelFor,
  localizeDataset,
  type SiteData,
} from '@/lib/prelaunch/site';
import { createDeviceTimeSource } from '@/lib/time/deviceTimeSource';
import { utcWording } from '@/lib/prelaunch/utcWording';
import { unitKey } from '@/lib/prelaunch/kits';
import { TimeProvider } from '@/lib/time/TimeProvider';

/**
 * Головні місця розкладу передстартового сайту: Лас-Вегас замість Лос-Анджелеса (рішення власника 2026-11-18; той самий
 * пояс UTC−8). Сайт свята й `/before` — без змін.
 */
const PRELAUNCH_CELEBRATIONS = MAIN_CELEBRATIONS.map((e) =>
  e.iso === 'US' && e.city === 'Лос-Анджелес' ? { iso: 'US', city: 'Лас-Вегас', place: 'Лас-Вегас-Стріп', zoneId: 'utc-0800' } : e,
);

const MEDIA = (mediaJson as { items: Record<string, MediaItem> }).items;
/** Очікувані трансляції «країна:пояс» → типи (`scripts/prelaunch/gen-expected.mjs`); немає запису — нейтрально. */
const EXPECTED = (expectedJson as { kinds: Record<string, readonly ExpectedKind[]> }).kinds;
const NONE: readonly ExpectedKind[] = [];
/** Країни, трансляцій з яких не показуємо (рішення власника 2026-11-19): лише відлік. */
const COUNTDOWN_ONLY = new Set(['RU', 'BY']);
const ONLY_COUNTDOWN: readonly ExpectedKind[] = ['countdown'];
const expectedKinds = (iso: string, zoneId: string): readonly ExpectedKind[] =>
  COUNTDOWN_ONLY.has(iso) ? ONLY_COUNTDOWN : (EXPECTED[`${iso}:${zoneId}`] ?? NONE);

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

/** `useLayoutEffect` у браузері; під час збирання (сервер) — нічого. */
const useIsoLayoutEffect = typeof window === 'undefined' ? () => undefined : useLayoutEffect;

export function SiteProvider({ site, children }: { site: SiteData; children: ReactNode }) {
  // У браузері сторінка має одну мову; час, що залежить від відвідувача, малюється лише після гідратації.
  setDefaultTimeLocale(site.locale);
  // До гідратації — час за UTC, як у статичному HTML; одразу після — за поясом відвідувача (і повторний рендер).
  const [hydrated, setHydrated] = useState(false);
  holdViewerTimeZoneUtc(!hydrated);
  useIsoLayoutEffect(() => {
    holdViewerTimeZoneUtc(false);
    setHydrated(true);
  }, []);
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
      celebrations: PRELAUNCH_CELEBRATIONS,
    });
    const prefestSite: PrefestSite = {
      locale: site.locale,
      href,
      media: MEDIA,
      expectedKinds,
      zoneStory: (iso, zoneId) => site.stories[unitKey(iso, zoneId)],
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
  // До гідратації підписи часу — «за UTC» (час у HTML теж за UTC); після — звичайні «за твоїм часом».
  const messages = useMessages();
  const utcMessages = useMemo(() => utcWording(messages, site.locale), [messages, site.locale]);
  return (
    <NextIntlClientProvider locale={site.locale} messages={hydrated ? messages : utcMessages}>
      <TimeProvider source={source}>
        <PrefestProvider model={value.model} data={value.data} site={value.prefestSite}>
          {children}
        </PrefestProvider>
      </TimeProvider>
    </NextIntlClientProvider>
  );
}
