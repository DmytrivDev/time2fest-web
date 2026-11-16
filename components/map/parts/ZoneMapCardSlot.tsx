'use client';

// Слот під мапою поясів: вікно поясу (`ZonePanel`) чи країни (`CountryPanel`) у `Reveal` з плавним зсувом (`ZoneMap`).
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Reveal } from '@/components/primitives/Reveal';
import type { ZoneState } from '@time2fest/rules/time';
import type { MapCountry, MapZone } from '@/lib/map/model';
import { CountryPanel } from '@/components/map/CountryPanel';
import { PanelSwap } from './PanelSwap';
import { ZonePanel } from '@/components/map/ZonePanel';
import type { Selection } from '@/components/map/hooks/useZoneMapSelection';
import m from '@/components/map/zoneMap.module.css';

export function ZoneMapCardSlot({
  slotRef,
  cardRef,
  cardId,
  panelZone,
  panelCountry,
  open,
  ordered,
  stateOf,
  now,
  isPhone,
  selection,
  setSelection,
  selectCountry,
  closeSelection,
}: {
  slotRef: RefObject<HTMLDivElement | null>;
  cardRef: RefObject<HTMLElement | null>;
  cardId: string;
  panelZone: MapZone | undefined;
  panelCountry: MapCountry | undefined;
  /** Чи є вибраний пояс (вікно відкрите). */
  open: boolean;
  ordered: MapZone[];
  stateOf: (id: string) => ZoneState;
  now: number;
  isPhone: boolean;
  selection: Selection;
  setSelection: Dispatch<SetStateAction<Selection>>;
  selectCountry: (zoneId: string, iso: string) => void;
  closeSelection: () => void;
}) {
  // Сусідні пояси за часом опівночі: попередній — на годину раніше (більший зсув), наступний — пізніше.
  const panelIdx = panelZone ? ordered.indexOf(panelZone) : -1;
  const card = panelZone ? (
    <Reveal open={open}>
      {/* Пояс ↔ країна — плавний зсув і висота (рішення 2026-11-04; відкотити — `PANEL_SWAP` у PanelSwap.tsx). */}
      <PanelSwap
        swapKey={panelCountry ? `c:${panelZone.id}:${panelCountry.iso}` : `z:${panelZone.id}`}
      >
        {panelCountry ? (
          <CountryPanel
            ref={cardRef}
            zone={panelZone}
            country={panelCountry}
            state={stateOf(panelZone.id)}
            // Пояси країни — у порядку опівночі (схід → захід).
            zones={ordered
              .filter((z) => z.countries.some((c) => c.iso === panelCountry.iso))
              .reverse()
              .map((z) => ({ id: z.id, offsetMinutes: z.offsetMinutes, state: stateOf(z.id) }))}
            nextZone={ordered.reduce<MapZone | undefined>(
              (best, z) =>
                z.midnightMs > now && (!best || z.midnightMs < best.midnightMs) ? z : best,
              undefined,
            )}
            phone={isPhone}
            onSelectZone={(id) => setSelection({ kind: 'zone', id })}
            onSelectCountryZone={(zoneId) => selectCountry(zoneId, panelCountry.iso)}
            onClose={closeSelection}
            takeFocus={selection?.kind === 'country' && !!selection.fromZone}
          />
        ) : (
          <ZonePanel
            ref={cardRef}
            zone={panelZone}
            state={stateOf(panelZone.id)}
            prev={ordered[panelIdx + 1]}
            next={panelIdx > 0 ? ordered[panelIdx - 1] : undefined}
            phone={isPhone}
            onSelect={(id) => setSelection({ kind: 'zone', id })}
            onSelectCountry={(iso) =>
              setSelection({ kind: 'country', zoneId: panelZone.id, iso, fromZone: true })
            }
            onClose={closeSelection}
          />
        )}
      </PanelSwap>
    </Reveal>
  ) : null;
  return (
    <div ref={slotRef} id={cardId} data-zone-map-card-slot="" className={m.cardSlot}>
      {card}
    </div>
  );
}
