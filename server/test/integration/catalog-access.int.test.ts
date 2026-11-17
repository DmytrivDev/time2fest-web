/**
 * Catalog access and model rules (AC-18, AC-45, AC-46, AC-48, W25): the owner cannot change a zone's
 * `midnightUtc` or a country's `slug`; a slot other than `midnight` needs `startsAt`; an agent reads the
 * six catalog collections but cannot create, update or delete in them.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payloadOf } from '../../src/container';
import { createTinyCatalog, KINDS, removeTinyCatalog, type TinyCatalog } from './catalog-helpers';
import { testDeps } from './helpers';
import { apiKeyHeader, makeAdmin, personMark, removeAdmins, rest, serviceMark, sessionCookie } from './payload-rest';

const OWNER = 'catalog-access-owner@example.com';
const AGENT = 'catalog-access-agent@example.com';
const PASSWORD = 'catalog-access-password-01'; // check-secrets: allow test fake
const run = `ca${Date.now()}`;

describe('catalog access (AC-18, AC-45, AC-46, AC-48)', () => {
  let payload: Payload;
  let owner: Record<string, string>;
  let agent: Record<string, string>;
  let tiny: TinyCatalog;

  beforeAll(async () => {
    payload = await payloadOf(testDeps())();
    tiny = await createTinyCatalog(payload, run);
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    const agentId = await makeAdmin(payload, AGENT, PASSWORD, 'content-agent');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
    const issued = await rest('POST', `/admins/${agentId}/issue-key`, { headers: owner });
    agent = { ...apiKeyHeader(((await issued.json()) as { key: string }).key), ...serviceMark() };
  });

  afterAll(async () => {
    await removeTinyCatalog(payload, run);
    await removeAdmins(payload, [OWNER, AGENT]);
  });

  it('the owner changing zones.midnightUtc is refused and the value stays', async () => {
    const res = await rest('PATCH', `/zones/${tiny.ids.zones}`, { headers: owner, body: { midnightUtc: '2030-01-01T00:00:00Z' } });
    expect(res.ok).toBe(false);
    const stored = await payload.findByID({ collection: 'zones', id: tiny.ids.zones, overrideAccess: true, depth: 0 });
    expect(stored.midnightUtc).toBe('2026-12-31T23:00:00Z');
  });

  it('the owner can still change another field of a zone', async () => {
    const res = await rest('PATCH', `/zones/${tiny.ids.zones}`, { headers: owner, body: { order: 7 } });
    expect(res.status).toBe(200);
  });

  it('changing countries.slug is refused; iso too', async () => {
    const bySlug = await rest('PATCH', `/countries/${tiny.ids.countries}`, { headers: owner, body: { slug: 'other' } });
    expect(bySlug.ok).toBe(false);
    const byIso = await rest('PATCH', `/countries/${tiny.ids.countries}`, { headers: owner, body: { iso: 'ZZ' } });
    expect(byIso.ok).toBe(false);
    const stored = await payload.findByID({ collection: 'countries', id: tiny.ids.countries, overrideAccess: true, depth: 0 });
    expect(stored.slug).toBe(`slug-${run}`);
    expect(stored.iso).toBe(tiny.keys.country);
  });

  it('a dawn event without startsAt is refused; with startsAt it is saved', async () => {
    const base = {
      cityId: tiny.keys.city,
      zoneId: tiny.keys.zone,
      countryIso: tiny.keys.country,
      midnightUtc: '2026-12-31T23:00:00Z',
      isMainCelebration: false,
      slot: 'dawn',
    };
    const without = await rest('POST', '/events', { headers: owner, body: { ...base, eventId: `evt-dawn-a-${run}` } });
    expect(without.ok).toBe(false);
    const withIt = await rest('POST', '/events', { headers: owner, body: { ...base, eventId: `evt-dawn-b-${run}`, startsAt: '2027-01-01T05:00:00.000Z' } });
    expect(withIt.status).toBe(201);
  });

  it('an agent reads every catalog collection; create, update and delete are refused', async () => {
    for (const kind of KINDS) {
      expect((await rest('GET', `/${kind}?limit=1`, { headers: agent })).status, `read ${kind}`).toBe(200);
      expect((await rest('POST', `/${kind}`, { headers: agent, body: { key: 'x' } })).status, `create ${kind}`).toBe(403);
      expect((await rest('PATCH', `/${kind}/${tiny.ids[kind]}`, { headers: agent, body: { order: 9 } })).status, `update ${kind}`).toBe(403);
      expect((await rest('DELETE', `/${kind}/${tiny.ids[kind]}`, { headers: agent })).status, `delete ${kind}`).toBe(403);
    }
  });
});
