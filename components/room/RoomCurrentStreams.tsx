'use client';

/**
 * «Поточні трансляції» кімнати — картки подій із трансляцією зараз; «+» — одразу у вікно. Виокремлено з
 * `RoomLive.tsx` (WP-F). Стан фільтра лишається в кімнаті (`filter`, `onFilterChange`).
 */
import { useTranslations } from 'next-intl';
import type { EventFilterValue } from '@/components/live/EventFilter';
import { StreamCards } from '@/components/live/StreamCards';
import type { Dataset } from '@/lib/data/types';
import { formatClock, utcLabel } from '@/lib/i18n/time';
import type { StreamRowData } from '@/lib/live/countryData';
import { countryZoneEvents } from '@/lib/schedule/countryZone';
import type { RoomTarget } from '@/stores/room';

export function RoomCurrentStreams({
  data,
  roomZoneId,
  zoneMidnight,
  liveRows,
  schedule,
  hasPass,
  filter,
  onFilterChange,
  onToggle,
  onAdd,
}: {
  data: Dataset;
  roomZoneId: string | null;
  zoneMidnight: number | undefined;
  liveRows: readonly StreamRowData[];
  schedule: readonly string[];
  hasPass: boolean;
  filter: EventFilterValue;
  onFilterChange: (v: EventFilterValue) => void;
  onToggle: (target: RoomTarget) => void;
  onAdd: (target: RoomTarget) => void;
}) {
  const t = useTranslations('room.page');
  const inSchedule = (eventId: string) =>
    countryZoneEvents(eventId).some((id) => schedule.includes(id));
  const currentRows = filter === 'mine' ? liveRows.filter((r) => inSchedule(r.eventId)) : liveRows;
  const zone = roomZoneId ? data.zonesById.get(roomZoneId) : undefined;
  return (
    <StreamCards
      heading={t('currentTitle')}
      sub={
        zone && zoneMidnight
          ? t('currentSub', {
              zone: utcLabel(zone.offsetMinutes),
              time: formatClock(zoneMidnight),
            })
          : undefined
      }
      rows={currentRows}
      currentStreamId={null}
      onSelect={(row) => onToggle({ sourceId: row.id, eventId: row.eventId })}
      onAddToRoom={(row) => onAdd({ sourceId: row.id, eventId: row.eventId })}
      showCountry
      phoneLimit={5}
      filter={{
        value: filter,
        onChange: onFilterChange,
        scheduleLocked: !hasPass,
        scheduleCount: liveRows.filter((r) => inSchedule(r.eventId)).length,
        hideLive: true,
      }}
      className="mt-10"
    />
  );
}
