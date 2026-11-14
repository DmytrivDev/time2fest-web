'use client';

/** Читання `?e=` / `?zone=` / `?s=` для сторінки країни; виокремлено з `CountryLive.tsx` (WP-F). */
import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Читає `?e=` / `?zone=` (окремо, у своєму `Suspense`: сторінка країни лишається статичною) і повідомляє про зміну —
 * перехід із «Зараз і далі» на ту саму сторінку з іншим містом теж перемикає пояс.
 */
export function FocusFromUrl({ onFocus }: { onFocus: (e: string | null, zone: string | null, s: string | null) => void }) {
  const sp = useSearchParams();
  const e = sp?.get('e') ?? null;
  const zone = sp?.get('zone') ?? null;
  const s = sp?.get('s') ?? null;
  useEffect(() => {
    onFocus(e, zone, s);
  }, [e, zone, s, onFocus]);
  return null;
}
