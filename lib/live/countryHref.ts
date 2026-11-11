import type { Country } from '@/lib/data/types';

/**
 * Сторінка країни (зі скісною рискою в кінці — `trailingSlash: true`). `at` — що саме відкрити (власник 2026-11-10: «щоб
 * перекидало на те, на що клікнув»): `e` — подія (місто й пояс), `zone` — пояс країни. Сторінка країни читає ці параметри
 * (`CountryLive`) і відкриває цей пояс і подію, а не пояс за замовчуванням.
 */
export function countryHref(
  country: Pick<Country, 'slug'>,
  at?: { eventId?: string | null; zoneId?: string | null; sourceId?: string | null },
): string {
  const base = `/country/${country.slug}/`;
  // `s` — обрана трансляція події (з «Інших країн поясу», 2026-11-11): сторінка вмикає саме її.
  if (at?.eventId && at.sourceId) return `${base}?e=${encodeURIComponent(at.eventId)}&s=${encodeURIComponent(at.sourceId)}`;
  if (at?.eventId) return `${base}?e=${encodeURIComponent(at.eventId)}`;
  if (at?.zoneId) return `${base}?zone=${encodeURIComponent(at.zoneId)}`;
  return base;
}
