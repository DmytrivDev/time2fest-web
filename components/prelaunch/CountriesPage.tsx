'use client';

/**
 * «Країни» мовного дерева — наявна сторінка «Країни й міста» (`components/countries/CountriesView`, той самий вигляд, що на
 * сайті свята): заголовок, пошук, «Мапа | Список», 38 поясів по черзі з країнами, «Питання й відповіді». Прибрано лише те,
 * чого до запуску немає: чат «Світ», фільтр «З трансляціями · Мій графік» і календарики графіка. Трансляцій у даних немає
 * (модель мапи «до свята»), тож картки країн — «лише відлік».
 *
 * Пояси й країни — уже в статичному HTML (`staticList`; вимога SEO): до гідратації час за UTC, далі — за часом відвідувача.
 */
import { usePrefest } from '@/components/prefest/PrefestContext';
import { usePrefestMap } from '@/components/prefest/PrefestMap';
import { CountriesView } from '@/components/countries/CountriesView';
import type { SiteData } from '@/lib/prelaunch/site';
import { SiteShell } from './SiteShell';

function Body() {
  const { data } = usePrefest();
  const { mapModel, prefest } = usePrefestMap();
  return <CountriesView data={data} model={mapModel} mapPrefest={prefest} filter={false} staticList />;
}

export function CountriesPage({ site }: { site: SiteData }) {
  return (
    <SiteShell site={site} current="countries" page="S-PL-COUNTRIES">
      <Body />
    </SiteShell>
  );
}
