import { CatalogResponseSchema } from '@time2fest/contracts/schemas';
import { beforeAll, expect, it } from 'vitest';
import type { Catalog, CatalogService } from '@/lib/api/contracts/catalog';
import { catalogVersionOf } from '@/lib/api/contracts/site';
import { buildDataset } from '@/lib/data/build';
import type { CountriesFile, ScheduleFile, StreamsFile } from '@/lib/data/types';
import streamsJson from '@/data/streams.json';
import { describeDomain } from './catalog.suite';

const BASE = process.env.T2F_SERVER_URL ?? '';
const ORIGIN = process.env.T2F_HTTP_ORIGIN ?? 'http://localhost:3000';

let fetched: Catalog | null = null;
let version = '';

beforeAll(async () => {
  // The catalog is seeded: import on an empty database (AC-88), restored by the reset door.
  const reset = await fetch(`${BASE}/api/_test/reset`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: '{}',
  });
  if (!reset.ok) throw new Error(`reset failed: ${reset.status}`);
  const res = await fetch(`${BASE}/api/catalog`);
  const parsed = CatalogResponseSchema.parse(await res.json());
  if (!parsed.ok) throw new Error(`GET /api/catalog → ${parsed.error.code}`);
  const { schedule, countries } = parsed.value;
  version = parsed.value.version;
  const { chainsByEventId: _chains, ...catalog } = buildDataset(
    schedule as unknown as ScheduleFile,
    countries as unknown as CountriesFile,
    streamsJson as unknown as StreamsFile,
  );
  void _chains;
  fetched = catalog;
}, 540_000);

const service: CatalogService = {
  catalog: () => {
    if (!fetched) throw new Error('catalog was not fetched');
    return fetched;
  },
  version: () => version,
};

describeDomain('catalog (http)', () => service);

it('the served version equals catalogVersionOf(meta) of the served catalog', () => {
  expect(version).toBe(catalogVersionOf(service.catalog().meta));
});
