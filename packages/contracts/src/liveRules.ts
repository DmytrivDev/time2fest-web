import type { StreamChain, StreamEvent } from './live';

/**
 * Pure rule applying a `live:streams` event (server and client share it). An event older than `lastVersion` is dropped;
 * `hide` removes the source; `chain` replaces the chain; `source` replaces the source with the same id.
 * Nothing changed: the same map is returned.
 */
export function applyStreamEvent(
  chains: ReadonlyMap<string, StreamChain>,
  event: StreamEvent,
  lastVersion: number,
): { chains: ReadonlyMap<string, StreamChain>; version: number } {
  if (event.version < lastVersion) return { chains, version: lastVersion };
  const version = event.version;
  if (event.type === 'chain') {
    const next = new Map(chains);
    next.set(event.chain.eventId, event.chain);
    return { chains: next, version };
  }
  const eventId = event.eventId;
  const chain = chains.get(eventId);
  const id = event.type === 'hide' ? event.sourceId : event.source.id;
  if (!chain || !chain.sources.some((s) => s.id === id)) return { chains, version };
  const next = new Map(chains);
  const sources =
    event.type === 'hide'
      ? chain.sources.filter((s) => s.id !== id)
      : chain.sources.map((s) => (s.id === id ? event.source : s));
  next.set(eventId, { ...chain, sources });
  return { chains: next, version };
}
