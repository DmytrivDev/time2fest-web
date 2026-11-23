/**
 * The viewers aggregate (SPEC-12 AC-60, AC-61, AC-62, NFR-6, [П-1]), ring 1 — pure, one pass over the entries.
 *
 * Input: the presence entries of `live:viewers`, each with the `chan_info` of its subscription token. Only the
 * lock-holder tab of a browser subscribes with a token `{p:1, c?}`, so `people` = entries with `p === 1`. A country
 * is listed when it has at least `viewersMinPerCountry` such entries, a valid ISO (`XX`, `T1`, absent, malformed
 * excluded) and a catalog row; the list carries no numbers and follows catalog popularity (the order of the site's
 * `simulatedViewers`). `viewersMap` off → no countries; `viewersCount` off → no `people`. Nothing per person is kept.
 */
import type { SiteSwitches, ViewerCountry, ViewerSummary } from '@time2fest/contracts';
import type { LiveConfig } from './config';

export interface PresenceEntry {
  /** The subscription's `chan_info`, as Centrifugo returns it. */
  chanInfo?: unknown;
}

export interface ViewerCatalogCountry {
  iso: string;
  /** Ukrainian name. */
  name: string;
  flagCode: string;
  popularity: number;
}

const ISO = /^[A-Z]{2}$/;
const SERVICE_CODES: ReadonlySet<string> = new Set(['XX', 'T1']);

/** A viewer's country as counted (AC-59): a valid ISO code other than `XX` / `T1`, else `null`. */
export function viewerCountry(c: unknown): string | null {
  return typeof c === 'string' && ISO.test(c) && !SERVICE_CODES.has(c) ? c : null;
}

/** The country of a counted entry, `null` for an entry counted without a country, `undefined` when not counted. */
function readEntry(info: unknown): string | null | undefined {
  if (!info || typeof info !== 'object') return undefined;
  const { p, c } = info as { p?: unknown; c?: unknown };
  if (p !== 1) return undefined;
  return viewerCountry(c);
}

/** Catalog countries ordered by popularity (desc), then ISO; compute once per catalog version. */
export function viewerCatalogOrder(countries: readonly ViewerCatalogCountry[]): ViewerCatalogCountry[] {
  return [...countries].sort((a, b) => b.popularity - a.popularity || (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
}

export function aggregateViewers(
  entries: Iterable<PresenceEntry>,
  switches: Pick<SiteSwitches, 'viewersMap' | 'viewersCount'>,
  orderedCountries: readonly ViewerCatalogCountry[],
  at: string,
  cfg: LiveConfig,
): ViewerSummary {
  let people = 0;
  const perCountry = new Map<string, number>();
  for (const entry of entries) {
    const country = readEntry(entry.chanInfo);
    if (country === undefined) continue;
    people += 1;
    if (country !== null) perCountry.set(country, (perCountry.get(country) ?? 0) + 1);
  }
  const countries: ViewerCountry[] = [];
  if (switches.viewersMap) {
    for (const c of orderedCountries) {
      if ((perCountry.get(c.iso) ?? 0) >= cfg.viewersMinPerCountry) countries.push({ iso: c.iso, name: c.name, flagCode: c.flagCode });
    }
  }
  return switches.viewersCount ? { countries, people, at } : { countries, at };
}
