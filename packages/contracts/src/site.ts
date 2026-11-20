/**
 * Domain `site` (proposed, SPEC-01): global switches, product prices and event patches the server owns.
 * Plain TS, no wire schema yet. `applySiteEvent` is the only rule: a newer `version` wins.
 */
import type { ApiResult, Unsubscribe } from './result';

/** Amount in minor units (cents). */
export interface Money {
  amount: number;
  currency: 'USD';
}

export type ProductKey = 'pass' | 'toast:2' | 'toast:5' | 'toast:10';

export interface SiteProduct {
  key: ProductKey;
  price: Money;
  priceVersion: number;
}

export interface SiteSwitches {
  chat: boolean;
  toasts: boolean;
  pass: boolean;
  passGift: boolean;
  payments: boolean;
  viewersMap: boolean;
  passOffer: boolean;
  /** Absent key = room open. */
  chatRooms: Readonly<Record<string, boolean>>;
  toastTiers: { '2': boolean; '5': boolean; '10': boolean };
}

export interface SiteEventPatch {
  /** Milliseconds. */
  moment?: number;
  isMainCelebration?: boolean;
  restrained?: { note?: string };
  hidden?: boolean;
}

export interface SiteState {
  /** Grows with every change. */
  version: number;
  /** ISO timestamp. */
  at: string;
  switches: SiteSwitches;
  products: readonly SiteProduct[];
  catalogVersion: string;
  eventPatches: Readonly<Record<string, SiteEventPatch>>;
  /** Set only by the red-button / prepared technical file (SPEC-08). Absent = normal state. */
  outage?: 'technical';
}

export type SiteEvent = { type: 'snapshot'; state: SiteState };

/** Channel class of the site snapshot events (SPEC-08). */
export const SITE_CHANNEL_CLASS = 'site:state';

/** Event id of a snapshot: `site:<version>`. */
export function siteEventId(version: number): string {
  return `site:${version}`;
}

/** R2 object keys of the environment bucket (SPEC-08), relative to the environment prefix. */
export const SITE_R2_KEYS = {
  latest: 'site/latest.json',
  prepared: 'site/prepared/technical.json',
  redButton: 'site/red-button.json',
} as const;

/** Response headers the edge adds to the public site address (SPEC-08). */
export const SITE_SOURCE_HEADER = 'x-t2f-source';
export const SITE_VERSION_HEADER = 'x-t2f-site-version';

export interface SiteService {
  /** `GET /api/site/state` (proposed). Failures: `network` | `unavailable`; the client keeps the last known snapshot. */
  state(): Promise<ApiResult<SiteState>>;
  /** Channel `site:state` (proposed). */
  subscribe(onEvent: (event: SiteEvent) => void): Unsubscribe;
  /** Last known state without a request. */
  peek(): SiteState | undefined;
}

/**
 * Newer `version` wins; otherwise the current state is kept (same reference). Outage rule (AC-47): a snapshot with
 * `outage`, or the first one without it after a current state that has it, is applied whatever its `version`
 * (the red-button file carries its own version).
 */
export function applySiteEvent(current: SiteState | undefined, event: SiteEvent): SiteState {
  if (!current || event.state.version > current.version) return event.state;
  if (event.state.outage || current.outage) return event.state;
  return current;
}

/** Catalog version = `meta.generatedAt` + `tzdbVersion` (rule from the catalog contract). */
export function catalogVersionOf(meta: { generatedAt: string; tzdbVersion: string }): string {
  return `${meta.generatedAt}+${meta.tzdbVersion}`;
}
