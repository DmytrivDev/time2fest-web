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
}

export type SiteEvent = { type: 'snapshot'; state: SiteState };

export interface SiteService {
  /** `GET /api/site/state` (proposed). Failures: `network` | `unavailable`; the client keeps the last known snapshot. */
  state(): Promise<ApiResult<SiteState>>;
  /** Channel `site:state` (proposed). */
  subscribe(onEvent: (event: SiteEvent) => void): Unsubscribe;
  /** Last known state without a request. */
  peek(): SiteState | undefined;
}

/** Newer `version` wins; otherwise the current state is kept (same reference). */
export function applySiteEvent(current: SiteState | undefined, event: SiteEvent): SiteState {
  if (!current || event.state.version > current.version) return event.state;
  return current;
}
