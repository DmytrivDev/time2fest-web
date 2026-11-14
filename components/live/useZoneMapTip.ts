// Плашка при наведенні на мапі поясів: вибір цілі, затримки появи/зникання, позиція за курсором чи біля мітки (`ZoneMap`).
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { MapCity, MapCountry, MapZone, ZoneMapGeometry } from './MapModel';
import { tipKey, type MapTipTarget } from './MapTooltip';
import { placeTipAt } from './zoneMapGeometry';

export function useZoneMapTip({
  isPhone,
  cities,
  hoverId,
  hotCountry,
  onCity,
  ringId,
  zoneById,
  countryByIso,
  geometry,
  place,
  boxRef,
}: {
  isPhone: boolean;
  cities: readonly MapCity[];
  hoverId: string | null;
  hotCountry: string | null;
  onCity: string | null;
  ringId: string | null;
  zoneById: Map<string, MapZone>;
  countryByIso: Map<string, MapCountry>;
  geometry: ZoneMapGeometry | null;
  place: (leftPct: number, topPct: number) => { left: string; top: string };
  boxRef: RefObject<HTMLDivElement | null>;
}) {
  // Плашка при наведенні (рішення власника 2026-11-02, дошка `Desk-Map-Tips`): лише десктоп; одна одночасно — країна
  // важливіша за пояс; з’являється через 150 мс, зникає через 100 мс; між сусідніми цілями — одразу.
  const hotSep = hotCountry ? hotCountry.lastIndexOf(':') : -1;
  const pointerTarget: MapTipTarget | null = isPhone
    ? null
    : onCity
      ? { kind: 'city', zoneId: cities.find((c) => c.id === onCity)?.zoneId ?? '', cityId: onCity }
      : hotCountry && hotSep > 0
        ? {
            kind: 'country',
            zoneId: hotCountry.slice(0, hotSep),
            iso: hotCountry.slice(hotSep + 1),
          }
        : hoverId
          ? { kind: 'zone', zoneId: hoverId }
          : null;
  // З клавіатури: фокус на поясі (видимий) — плашка біля мітки поясу.
  const keyTarget: MapTipTarget | null =
    !isPhone && !pointerTarget && ringId ? { kind: 'zone', zoneId: ringId } : null;
  const rawTarget = pointerTarget ?? keyTarget;
  const rawKey = tipKey(rawTarget);
  const [tip, setTip] = useState<{ target: MapTipTarget; byKey: boolean } | null>(null);
  const tipShown = tipKey(tip?.target ?? null);
  useEffect(() => {
    if (rawKey === tipShown) return;
    const next = rawTarget ? { target: rawTarget, byKey: !pointerTarget } : null;
    const delay = !rawTarget ? 100 : tipShown || next?.byKey ? 0 : 150;
    const id = window.setTimeout(() => setTip(next), delay);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ціль описує її ключ
  }, [rawKey, tipShown]);
  const tipRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  // Чи плашка з клавіатури (тоді її позиція — біля мітки поясу, не за курсором); оновлюється після рендеру.
  const tipByKeyRef = useRef(false);
  const tipZone = tip ? zoneById.get(tip.target.zoneId) : undefined;
  const tipCountry =
    tip?.target.kind === 'country' && tipZone
      ? (tipZone.countries.find((c) => c.iso === (tip.target as { iso: string }).iso) ??
        countryByIso.get(tip.target.iso))
      : undefined;
  const tipCity =
    tip?.target.kind === 'city'
      ? cities.find((c) => c.id === (tip.target as { cityId: string }).cityId)
      : undefined;
  const tipLabel =
    tip?.byKey && geometry
      ? geometry.zones.find((g) => g.zoneId === tip.target.zoneId)?.label
      : undefined;
  const tipStyle = (() => {
    if (!tipLabel || !geometry) return undefined;
    const lp = (tipLabel[0] / geometry.meta.width) * 100;
    const pos = place(lp, (tipLabel[1] / geometry.meta.height) * 100);
    // Права третина мапи — плашка ліворуч від мітки.
    return {
      left: pos.left,
      top: pos.top,
      transform: lp > 66 ? 'translate(calc(-100% - 12px), 12px)' : 'translate(12px, 12px)',
    };
  })();
  useLayoutEffect(() => {
    tipByKeyRef.current = Boolean(tip?.byKey);
    if (!tip?.byKey) placeTipAt(tipRef.current, boxRef.current, pointer.current);
  });
  useEffect(() => {
    const bx = boxRef.current;
    if (!bx) return;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = bx.getBoundingClientRect();
      pointer.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      const el = tipRef.current;
      if (el) el.style.visibility = e.buttons ? 'hidden' : '';
      if (!tipByKeyRef.current) placeTipAt(el, bx, pointer.current);
    };
    bx.addEventListener('pointermove', move);
    return () => bx.removeEventListener('pointermove', move);
  }, [geometry, boxRef]);

  return { tip, tipRef, tipZone, tipCity, tipCountry, tipStyle };
}
