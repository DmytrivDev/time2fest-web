/**
 * Import registry (AC-80): sorted, unique rows, one per import domain. `pnpm --dir server import <domain>`
 * runs the row with that key. Later waves (hosting, streams, content) append their rows here.
 */
import { createPayloadImportStore } from '../adapters/payloadCatalog';
import { importCatalog, type ImportResult } from '../catalog/import';
import { assertRegistry } from '../platform/registry';
import { eventsOf } from '../endpoints/deps';
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
        },
        { apply: ctx.apply, readSource: ctx.readSource },
      );
    },
  },
];

assertRegistry('imports', importRegistry, (r) => r.key);
