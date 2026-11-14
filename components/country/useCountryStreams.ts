/**
 * Рядки трансляцій сторінки країни: свої («Трансляції · <Країна>»), решта поясу («Ще о … · інші країни поясу»), країни
 * без трансляції (обкладинка з «Відлік»), фільтр сусідів і список для «Обрати трансляцію ›». Виокремлено з
 * `CountryLive.tsx` (WP-F).
 */
import { useCallback, useMemo, useState } from 'react';
import type { EventFilterValue } from '@/components/live/EventFilter';
import type { CountdownCountry } from '@/components/live/StreamCards';
import type { useOfferWindows } from '@/components/offers/useOfferWindows';
import type { Dataset, Ms, ScheduledEvent } from '@/lib/data/types';
import { countryMainEvent, countryStreamRows, zoneStreamRows, type StreamRowData } from '@/lib/live/countryData';
import { countryHref } from '@/lib/player/BroadcastController';
import { countryZoneEvents } from '@/lib/schedule/countryZone';
import { useSchedule } from '@/lib/api/hooks/auth';

interface Args {
  data: Dataset;
  iso: string;
  zoneId: string | null;
  minute: Ms;
  mainEvent: ScheduledEvent | undefined;
  select: (row: StreamRowData) => void;
  addToRoom: (row: StreamRowData) => void;
  hasPass: boolean;
  passWindows: ReturnType<typeof useOfferWindows>;
}

export function useCountryStreams({ data, iso, zoneId, minute, mainEvent, select, addToRoom, hasPass, passWindows }: Args) {
  const countryRows = useMemo(
    () => (zoneId ? countryStreamRows(data, iso, zoneId, minute) : []),
    [data, iso, zoneId, minute],
  );
  const zoneRows = useMemo(
    () => (zoneId ? zoneStreamRows(data, zoneId, iso, minute) : []),
    [data, iso, zoneId, minute],
  );

  // «Обрати трансляцію ›» (як на головній): трансляції країни, далі решта поясу — у будь-якому стані.
  const pickerRows = useMemo(() => [...countryRows, ...zoneRows], [countryRows, zoneRows]);
  const streams = useMemo(
    () => ({
      rows: pickerRows,
      countryIso: iso,
      midnightMs: mainEvent?.midnightMs ?? 0,
      onPick: select,
      onAddToRoom: addToRoom,
    }),
    [pickerRows, iso, mainEvent, select, addToRoom],
  );

  const schedule = useSchedule();
  // «Ще о … · інші країни поясу»: трансляції сусідів і країни без трансляції (обкладинка з «Відлік»), фільтр як у
  // «Зараз і далі» (правка власника 2026-11-05).
  const [nbFilter, setNbFilter] = useState<EventFilterValue>('all');
  const zoneCountdown = useMemo<CountdownCountry[]>(() => {
    if (!zoneId) return [];
    return data.countries
      .filter((c) => c.iso !== iso && c.zoneIds.includes(zoneId) && countryStreamRows(data, c.iso, zoneId, minute).length === 0)
      .sort((a, b) => b.popularity - a.popularity)
      .map((c) => {
        const ev = countryMainEvent(data, c.iso, zoneId);
        const city = data.citiesById.get(ev?.cityId ?? '');
        return {
          iso: c.iso,
          name: c.name.uk,
          flagCode: c.flagCode,
          illustrationId: c.illustrationId ?? 'generic',
          city: city?.name.uk ?? c.name.uk,
          href: countryHref(c, { zoneId }),
          midnightMs: ev?.midnightMs ?? 0,
        };
      });
  }, [data, iso, zoneId, minute]);
  const inSched = useCallback(
    (eventId: string | undefined) => !!eventId && countryZoneEvents(eventId).some((id) => schedule.includes(id)),
    [schedule],
  );
  const nbRows = useMemo(
    () => (nbFilter === 'mine' ? zoneRows.filter((r) => inSched(r.eventId)) : zoneRows),
    [nbFilter, zoneRows, inSched],
  );
  const nbCountdown = useMemo(
    () =>
      nbFilter === 'live'
        ? []
        : nbFilter === 'mine'
          ? zoneCountdown.filter((c) => inSched(zoneId ? countryMainEvent(data, c.iso, zoneId)?.id : undefined))
          : zoneCountdown,
    [nbFilter, zoneCountdown, inSched, data, zoneId],
  );
  const nbScheduleCount = useMemo(
    () => zoneRows.filter((r) => inSched(r.eventId)).length + zoneCountdown.filter((c) => inSched(zoneId ? countryMainEvent(data, c.iso, zoneId)?.id : undefined)).length,
    [zoneRows, zoneCountdown, inSched, data, zoneId],
  );
  const changeNbFilter = useCallback(
    (next: EventFilterValue) => {
      // Без пасу «Мій графік» — вікно «Що дає пас», фільтр лишається.
      if (next === 'mine' && !hasPass) return passWindows.openPassInfoBoard();
      setNbFilter(next);
    },
    [hasPass, passWindows],
  );

  return { countryRows, zoneRows, pickerRows, streams, nbFilter, nbRows, nbCountdown, nbScheduleCount, changeNbFilter };
}
