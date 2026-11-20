/** The prepared technical file (SPEC-08 AC-42): the pure part and the command over fake ports. */
import { SITE_R2_KEYS, type SiteState } from '@time2fest/contracts';
import { parseSiteState } from '../../../packages/contracts/src/siteGuard';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SWITCHES } from '../../src/domain/site/switches';
import { preparedFile, runSitePrepared, type SitePreparedPorts } from '../../src/cli/sitePrepared';

const state: SiteState = {
  version: 3,
  at: '2026-11-20T10:00:00.000Z',
  switches: DEFAULT_SWITCHES,
  products: [],
  catalogVersion: 'cv1',
  eventPatches: {},
};

describe('preparedFile', () => {
  it('is a valid site state with outage technical', () => {
    const { body } = preparedFile(state, null);
    const parsed = parseSiteState(JSON.parse(body));
    expect(parsed).not.toBeNull();
    expect(parsed?.outage).toBe('technical');
    expect(parsed?.version).toBe(3);
  });

  it('has a key only when there is a bucket prefix', () => {
    expect(preparedFile(state, null).key).toBeNull();
    expect(preparedFile(state, 'rehearsal_x/').key).toBe(`rehearsal_x/${SITE_R2_KEYS.prepared}`);
  });
});

describe('runSitePrepared', () => {
  const ports = (puts: Array<[string, string]>, withBucket: boolean, season = true): SitePreparedPorts => ({
    snapshot: {
      store: { read: async () => ({ version: 3, at: state.at, switches: DEFAULT_SWITCHES, paymentsPause: null, productSelections: {} }) },
      patches: async () => ({}),
      catalogMeta: async () => (season ? { generatedAt: state.at, tzdbVersion: '2026a' } : null),
    },
    ...(withBucket ? { bucket: { prefix: 'p/', objects: { put: async (k: string, b: string) => void puts.push([k, b]) } } } : {}),
    close: async () => undefined,
  });

  it('prints the body and writes the same body to the bucket', async () => {
    const out: string[] = [];
    const puts: Array<[string, string]> = [];
    const code = await runSitePrepared({ out: (l) => out.push(l), err: () => undefined }, async () => ports(puts, true));
    expect(code).toBe(0);
    expect(JSON.parse(out[0] as string).outage).toBe('technical');
    expect(puts).toEqual([[`p/${SITE_R2_KEYS.prepared}`, out[0]]]);
  });

  it('writes only to stdout without a bucket, and fails without a catalog season', async () => {
    const puts: Array<[string, string]> = [];
    const out: string[] = [];
    expect(await runSitePrepared({ out: (l) => out.push(l), err: () => undefined }, async () => ports(puts, false))).toBe(0);
    expect(puts).toEqual([]);
    const err: string[] = [];
    expect(await runSitePrepared({ out: () => undefined, err: (l) => err.push(l) }, async () => ports(puts, true, false))).toBe(1);
    expect(err[0]).toContain('catalog-unavailable');
  });
});
