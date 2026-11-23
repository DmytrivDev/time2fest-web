/**
 * The public chains reader (SPEC-12 AC-3, AC-5, AC-10), ring 3: the live state (its version, `at`, zone-live),
 * the events with their corrections and the stored sources, assembled by the pure `publicChains`. No Payload import.
 *
 * One reader for the route, the fan-out and the R2 copy, so the three bodies are byte-identical for one `now`.
 * Read order matters: the state (its version) is read FIRST, then the events and the sources. A change commits its
 * rows and the version bump in one transaction, so anything read after the state is at least as new as its version.
 * Reads are sequential: the readers may share one database session (pg refuses concurrent queries on a client).
 * Only events with stored sources have a chain; an event with the `hidden` correction has none (AC-10).
 */
import type { ChainsResponse } from '@time2fest/contracts';
import { publicChains } from '../domain/live/chain';
import type { LiveConfig } from '../domain/live/config';
import type { LiveEventSource, LiveStore } from './ports';

export interface ChainsReadDeps {
  store: Pick<LiveStore, 'state' | 'sources'>;
  events: LiveEventSource;
  cfg: LiveConfig;
}

/** The public chains body at `now` (epoch ms of the server clock), outside any transaction. */
export async function readChains(deps: ChainsReadDeps, now: number): Promise<ChainsResponse> {
  const state = await deps.store.state();
  const events = await deps.events.events();
  const sources = await deps.store.sources();
  const chains = publicChains(events, sources, { now, cfg: deps.cfg, zoneLive: state.zoneLive });
  return { version: state.version, at: new Date(state.at ?? 0).toISOString(), chains };
}
