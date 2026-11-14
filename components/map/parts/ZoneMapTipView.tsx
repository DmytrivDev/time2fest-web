'use client';

// Плашка при наведенні на мапі поясів (вміст — підказка зони, країни чи міста); стан і позиція — `useZoneMapTip`.
import type { CSSProperties, Ref } from 'react';
import type { ZoneState } from '@/lib/engine/zoneState';
import { useProfile } from '@/lib/api/hooks/auth';
import type { MapCity, MapCountry, MapZone } from '@/lib/map/model';
import { CityTip, CountryTip, MapTip, ZoneTip, type MapTipTarget } from './MapTooltip';

export function ZoneMapTipView({
  tip,
  tipRef,
  tipZone,
  tipCity,
  tipCountry,
  tipStyle,
  countryByIso,
  zoneCountByIso,
  stateOf,
  now,
}: {
  tip: { target: MapTipTarget; byKey: boolean } | null;
  tipRef: Ref<HTMLDivElement>;
  tipZone: MapZone | undefined;
  tipCity: MapCity | undefined;
  tipCountry: MapCountry | undefined;
  tipStyle: CSSProperties | undefined;
  countryByIso: Map<string, MapCountry>;
  zoneCountByIso: Map<string, number>;
  stateOf: (id: string) => ZoneState;
  now: number;
}) {
  const viewerIso = useProfile()?.flagCode ?? undefined;
  if (!tipZone) return null;
  return (
    <MapTip ref={tipRef} kind={tip!.target.kind} style={tipStyle}>
      {tip!.target.kind === 'city' && tipCity ? (
        <CityTip
          city={tipCity}
          zone={tipZone}
          country={countryByIso.get(tipCity.countryIso)}
          state={stateOf(tipZone.id)}
          now={now}
        />
      ) : tip!.target.kind === 'country' && tipCountry ? (
        <CountryTip
          zone={tipZone}
          country={tipCountry}
          state={stateOf(tipZone.id)}
          now={now}
          zoneCount={zoneCountByIso.get(tipCountry.iso) ?? 1}
        />
      ) : (
        <ZoneTip zone={tipZone} state={stateOf(tipZone.id)} now={now} viewerIso={viewerIso} />
      )}
    </MapTip>
  );
}
