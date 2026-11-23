/**
 * Channel-class registry (SPEC-06 AC-1, C8): sorted, unique rows. Domain waves change their own row;
 * a domain that needs other history parameters moves to its own namespace.
 * `rttest` exists only in the `test` class (`channelClassesFor`).
 */
import type { ChannelClassRow } from '../domain/realtime/channels';
import type { EnvClass } from '../platform/env';
import { assertRegistry } from '../platform/registry';

export const channelRegistry: readonly ChannelClassRow[] = [
  { key: 'chat:country', namespace: 'chat', stem: 'country.', shape: 'keyed', visibility: 'public', history: { size: 100, ttlSeconds: 300 }, batched: true },
  { key: 'chat:world', namespace: 'chat', stem: 'world', shape: 'fixed', visibility: 'public', history: { size: 100, ttlSeconds: 300 }, batched: true },
  { key: 'live:streams', namespace: 'live', stem: 'streams', shape: 'fixed', visibility: 'public', history: { size: 10, ttlSeconds: 300 }, batched: false },
  { key: 'live:viewers', namespace: 'live', stem: 'viewers', shape: 'fixed', visibility: 'public', history: { size: 1, ttlSeconds: 120 }, batched: false, presence: true },
  { key: 'notif', namespace: 'notif', stem: 'user#', shape: 'personal', visibility: 'personal', history: { size: 20, ttlSeconds: 600 }, batched: false },
  { key: 'orders', namespace: 'orders', stem: 'user#', shape: 'personal', visibility: 'personal', history: { size: 20, ttlSeconds: 600 }, batched: false },
  { key: 'rating', namespace: null, stem: 'rating', shape: 'fixed', visibility: 'public', history: { size: 20, ttlSeconds: 300 }, batched: false },
  { key: 'rttest', namespace: 'rttest', stem: '', shape: 'keyed', visibility: 'public', history: { size: 50, ttlSeconds: 120 }, batched: true, testOnly: true },
  { key: 'site:state', namespace: 'site', stem: 'state', shape: 'fixed', visibility: 'public', history: { size: 10, ttlSeconds: 300 }, batched: false },
  { key: 'toasts', namespace: null, stem: 'toasts', shape: 'fixed', visibility: 'public', history: { size: 20, ttlSeconds: 300 }, batched: false },
  { key: 'user', namespace: 'user', stem: '#', shape: 'personal', visibility: 'personal', history: { size: 20, ttlSeconds: 600 }, batched: false },
];

assertRegistry('channels', channelRegistry, (r) => r.key);

/** The channel classes of `cls`: test-only rows exist only in `test`. */
export function channelClassesFor(cls: EnvClass): readonly ChannelClassRow[] {
  return cls === 'test' ? channelRegistry : channelRegistry.filter((r) => r.testOnly !== true);
}

/**
 * The site origin a connection may come from, per class (`workers/edge/wrangler.json:37,63`).
 */
export const REALTIME_SITE_ORIGINS: Readonly<Record<'rehearsal' | 'production', string>> = {
  rehearsal: 'https://rehearsal.time2fest.com',
  production: 'https://time2fest.com',
};
