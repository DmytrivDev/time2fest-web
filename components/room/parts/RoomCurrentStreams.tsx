'use client';

/**
 * «Поточні трансляції» кімнати — картки подій із трансляцією зараз; «+» — одразу у вікно. Виокремлено з
 * `RoomLive.tsx` (WP-F). Стан фільтра лишається в кімнаті (`filter`, `onFilterChange`).
 */
import { useTranslations } from 'next-intl';
import type { EventFilterValue } from '@/components/live/EventFilter';
import { ScheduleLockedBar } from '@/components/live/ScheduleLockedBar';
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
  phone = false,
  onGetPass,
  onPassInfo,
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
  phone?: boolean;
  /** «Оформити пас · $5» у блоці «Мій графік» без пасу. */
  onGetPass?: () => void;
  onPassInfo?: () => void;
}) {
  const t = useTranslations('room.page');
  const inSchedule = (eventId: string) =>
    countryZoneEvents(eventId).some((id) => schedule.includes(id));
  // «Мій графік» без пасу — той самий блок, що в «Зараз і далі» (Т5, 2026-11-16): картки під ним лише тло.
  const lockedMine = filter === 'mine' && !hasPass;
  const currentRows = filter === 'mine' && !lockedMine ? liveRows.filter((r) => inSchedule(r.eventId)) : liveRows;
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
      lockedNotice={lockedMine ? <ScheduleLockedBar stack={phone} onGetPass={onGetPass} onInfo={onPassInfo} /> : undefined}
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
