/**
 * Import registry (AC-80): sorted, unique rows, one per import domain. `pnpm --dir server import <domain>`
 * runs the row with that key. Later waves (hosting, streams, content) append their rows here.
 */
import { createPayloadLiveImportStore } from '../adapters/payloadLive';
import { createPayloadStreamsStore } from '../adapters/payloadStreams';
import { createPayloadImportStore } from '../adapters/payloadCatalog';
import { importChains } from '../live/import';
import { importChannels } from '../live/importChannels';
import { importCatalog, type ImportResult } from '../catalog/import';
import { assertRegistry } from '../platform/registry';
import { eventsOf, liveOf, siteOf } from '../endpoints/deps';
import type { Deps } from '../endpoints/types';
import { createPayloadJournal } from '../adapters/payloadJournal';

export interface ImportContext {
  apply: boolean;
  deps: Deps;
  /** The parsed content of a file of the source directory; throws when it cannot be read. */
  readSource(file: string): unknown;
}

export interface ImportRow {
  key: string;
  run(ctx: ImportContext): Promise<ImportResult>;
}

export const importRegistry: readonly ImportRow[] = [
  {
    key: 'catalog',
    async run(ctx) {
      // The root is loaded here: it imports the other registries, so a static import would be a cycle.
      const { payloadOf } = await import('../container');
      const payload = payloadOf(ctx.deps);
      return importCatalog(
        {
          store: createPayloadImportStore(payload),
          publisher: eventsOf(ctx.deps).publisher,
          journal: createPayloadJournal(() => false),
          clock: ctx.deps.clock,
          // SPEC-08 AC-4, AC-9: a changed catalog bumps the site version in the import's transaction.
          siteVersion: siteOf(ctx.deps).store,
        },
        { apply: ctx.apply, readSource: ctx.readSource },
      );
    },
  },
  {
    key: 'chains',
    async run(ctx) {
      const { payloadOf } = await import('../container');
      const { code, lines } = await importChains(
        {
          live: liveOf(ctx.deps).store,
          sources: createPayloadLiveImportStore({ payload: payloadOf(ctx.deps), clock: ctx.deps.clock }),
          publisher: eventsOf(ctx.deps).publisher,
          journal: createPayloadJournal(() => false),
          clock: ctx.deps.clock,
          cfg: liveOf(ctx.deps).cfg,
        },
        { apply: ctx.apply, readSource: ctx.readSource },
      );
      return { code, lines };
    },
  },
  {
    key: 'channels',
    async run(ctx) {
      const { payloadOf } = await import('../container');
      const { code, lines } = await importChannels(
        {
          live: liveOf(ctx.deps).store,
          channels: createPayloadStreamsStore({ payload: payloadOf(ctx.deps), clock: ctx.deps.clock }),
          journal: createPayloadJournal(() => false),
          clock: ctx.deps.clock,
        },
        { apply: ctx.apply, readSource: ctx.readSource },
      );
      return { code, lines };
    },
  },
];

assertRegistry('imports', importRegistry, (r) => r.key);
