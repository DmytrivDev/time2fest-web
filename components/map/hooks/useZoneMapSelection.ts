// Вибір на мапі поясів: пояс / місто / країна, похідні значення вибору і вікно під мапою (`ZoneMap`).
import { useEffect, useRef, useState } from 'react';
import { isReducedMotionNow } from '@/lib/a11y/reducedMotion';
import type { MapCity, MapCountry, MapZone } from '@/lib/map/model';

export type Selection =
  | { kind: 'zone'; id: string }
  | { kind: 'city'; id: string }
  /** `fromZone` — відкрито кліком по країні у вікні поясу (вікно змінилось на місці). */
  | { kind: 'country'; zoneId: string; iso: string; fromZone?: boolean }
  | null;

export function useZoneMapSelection(
  cities: readonly MapCity[],
  defaultSelectedZoneId: string | undefined,
) {
  const [selection, setSelection] = useState<Selection>(
    defaultSelectedZoneId ? { kind: 'zone', id: defaultSelectedZoneId } : null,
  );
  const selectedZoneId =
    selection?.kind === 'zone'
      ? selection.id
      : selection?.kind === 'country'
        ? selection.zoneId
        : selection?.kind === 'city'
          ? cities.find((c) => c.id === selection.id)?.zoneId
          : undefined;
  // Вибрана країна (`zoneId:iso`): підсвічується, як під курсором, поки відкрите її вікно.
  const pickedCountry =
    selection?.kind === 'country' ? `${selection.zoneId}:${selection.iso}` : null;
  // Клік по суші країни — вікно країни (рішення власника 2026-11-03); по океану чи в черзі — вікно поясу.
  const selectCountry = (zoneId: string, iso: string) =>
    setSelection({ kind: 'country', zoneId, iso });
  return { selection, setSelection, selectedZoneId, pickedCountry, selectCountry };
}

/**
 * Вікно під мапою — поясу (дошка `Desk-Map-ZonePanel`) чи країни (`Desk-Map-CountryVariants`), рішення власника
 * 2026-11-03: відкривається й закривається плавно (`Reveal`), тож під час закриття показує останній вибір.
 * Також прокручує сторінку до вікна, коли воно відкривається.
 */
export function useZoneMapCard(
  selection: Selection,
  selectedZoneId: string | undefined,
  zoneById: Map<string, MapZone>,
) {
  const current = selectedZoneId
    ? selection?.kind === 'country'
      ? { zoneId: selection.zoneId, iso: selection.iso }
      : { zoneId: selectedZoneId, iso: null }
    : null;
  const [panelSel, setPanelSel] = useState<{ zoneId: string; iso: string | null } | null>(current);
  if (current && (current.zoneId !== panelSel?.zoneId || current.iso !== panelSel?.iso))
    setPanelSel(current);
  const panelZone = panelSel ? zoneById.get(panelSel.zoneId) : undefined;
  const panelCountry: MapCountry | undefined =
    panelSel?.iso && panelZone
      ? panelZone.countries.find((c) => c.iso === panelSel.iso)
      : undefined;
  const slotRef = useRef<HTMLDivElement>(null);
  // Відкриття вікна (не перемикання поясу): сторінка прокручується так, щоб верх вікна став під низ мапи.
  const wasOpen = useRef(false);
  useEffect(() => {
    const open = Boolean(selectedZoneId);
    if (open && !wasOpen.current) {
      const el = slotRef.current;
      if (el && typeof window !== 'undefined') {
        const r = el.getBoundingClientRect();
        if (r.top > window.innerHeight * 0.55) {
          const top = window.scrollY + r.top - Math.min(window.innerHeight * 0.35, 280);
          window.scrollTo({ top, behavior: isReducedMotionNow() ? 'auto' : 'smooth' });
        }
      }
    }
    wasOpen.current = open;
  }, [selectedZoneId]);
  return { slotRef, panelZone, panelCountry };
}
