'use client';

/**
 * «Північ на мапі» (головна «до свята»): наявна мапа сайту (`ZoneMap`: масштаб, перетягування, підказки, «Мапа |
 * Список») у режимі `prefest` — пояси «найближча північ» і «попереду», вікно поясу з країнами під мапою, вікно країни
 * з традиціями й «Сторінкою країни» лише для країн з описом і «Додати в календар».
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { ZoneMap } from '@/components/map/ZoneMap';
import type { MapPrefest } from '@/components/map/mapPrefest';
import { cn } from '@/components/primitives/cn';
import { buildMapModel, type MapModel } from '@/lib/map/model';
import { downloadIcs } from '@/lib/prefest/ics';
import { prefestMapModel } from '@/lib/prefest/map';
import { usePrefest } from './PrefestContext';
import s from './prefest.module.css';
import m from './PrefestMap.module.css';

/**
 * Модель мапи «до свята» і «Додати в календар» вікна країни — для мапи головної й для списку країн передстартового
 * сайту (той самий вигляд, ті самі дані).
 */
export function usePrefestMap(): { mapModel: MapModel; prefest: MapPrefest } {
  const { model, data, site } = usePrefest();
  const t = useTranslations('prefest.map');
  const mapModel = useMemo(() => {
    const base = prefestMapModel(buildMapModel(data), (iso) => model.countriesByIso.get(iso)?.described ?? false);
    if (!site) return base;
    // Мовне дерево: «Сторінка країни» веде на сторінку цієї мови, а не на сторінку ефіру.
    return {
      ...base,
      zones: base.zones.map((z) => ({
        ...z,
        countries: z.countries.map((c) => ({ ...c, href: model.countriesByIso.get(c.iso)?.href ?? c.href })),
      })),
    };
  }, [model, data, site]);
  const prefest = useMemo<MapPrefest>(
    () => ({
      onCountryCalendar: (zone, country) =>
        downloadIcs(
          {
            uid: `time2fest-${zone.id}-${country.iso.toLowerCase()}`,
            title: t('calendarTitle', { country: country.name }),
            description: t('calendarText', { country: country.name }),
            startMs: zone.midnightMs,
          },
          `time2fest-${country.iso.toLowerCase()}.ics`,
        ),
      ...(site?.expectedKinds ? { expectedKinds: site.expectedKinds, linkAllPages: true } : {}),
    }),
    [t, site],
  );
  return { mapModel, prefest };
}

export function PrefestMap() {
  const { mapModel, prefest } = usePrefestMap();
  return (
    <div id="map" className={cn(s.sec, s.wrap, m.root)}>
      <ZoneMap {...mapModel} prefest={prefest} />
    </div>
  );
}
