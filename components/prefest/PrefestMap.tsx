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
import { getData } from '@/lib/data/load';
import { buildMapModel } from '@/lib/map/model';
import { downloadIcs } from '@/lib/prefest/ics';
import { prefestMapModel } from '@/lib/prefest/map';
import { usePrefest } from './PrefestContext';
import s from './prefest.module.css';
import m from './PrefestMap.module.css';

export function PrefestMap() {
  const { model } = usePrefest();
  const t = useTranslations('prefest.map');
  const mapModel = useMemo(
    () => prefestMapModel(buildMapModel(getData()), (iso) => model.countriesByIso.get(iso)?.described ?? false),
    [model],
  );
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
    }),
    [t],
  );
  return (
    <div id="map" className={cn(s.sec, s.wrap, m.root)}>
      <ZoneMap {...mapModel} prefest={prefest} />
    </div>
  );
}
