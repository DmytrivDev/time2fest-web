import type { Country } from '@/lib/data/types';

/**
 * Сторінка країни (зі скісною рискою в кінці — `trailingSlash: true`). `at` — що саме відкрити (власник 2026-11-10: «щоб
 * перекидало на те, на що клікнув»): `e` — подія (місто й пояс), `zone` — пояс країни. Сторінка країни читає ці параметри
 * (`CountryLive`) і відкриває цей пояс і подію, а не пояс за замовчуванням.
 */
export function countryHref(country: Pick<Country, 'slug'>, at?: { eventId?: string | null; zoneId?: string | null }): string {
  const base = `/country/${country.slug}/`;
  if (at?.eventId) return `${base}?e=${encodeURIComponent(at.eventId)}`;
  if (at?.zoneId) return `${base}?zone=${encodeURIComponent(at.zoneId)}`;
  return base;
}
