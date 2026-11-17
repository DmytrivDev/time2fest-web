/**
 * Event corrections (AC-20, AC-22, AC-42, AC-53 … AC-62; W35 … W38) through
 * `POST /cms-api/event-patches/{preview,save}` and `POST /cms-api/audit-log/:id/revert`, on a handful of
 * catalog rows under keys unique to the run (written as the import does; the imported catalog is not touched).
 *
 * Pairs: A = two events (a1 main, a2), B = one event (b1 main), C = three events (c1 main, c2, c3).
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPayloadCorrectionReader } from '../../src/adapters/payloadCorrections';
import { readCatalog } from '../../src/catalog/service';
import { createTestClock } from '../../src/clock';
import { catalogStoreOf, eventsOf, payloadOf } from '../../src/container';
import { currentPatches, EVENT_PATCH_CHANGED_TOPIC } from '../../src/corrections/service';
import type { Deps } from '../../src/endpoints/types';
import { IMPORT_CONTEXT, removeTinyCatalog } from './catalog-helpers';
import { testDeps } from './helpers';
import { makeAdmin, personMark, removeAdmins, rest, sessionCookie } from './payload-rest';

const OWNER = 'corrections-owner@example.com';
const PASSWORD = 'corrections-password-0001';
const run = `cr${Date.now()}`;
const MIN = 60_000;
const MIDNIGHT = '2026-12-31T23:00:00Z';
const BASE = Date.parse(MIDNIGHT);
const ev = (name: string) => `${name}-${run}`;

type Body = { ok: boolean; value?: Record<string, unknown>; error?: { code: string; reason?: string; warnings?: string[] } };
type Row = Record<string, unknown> & { id: number };

describe('event corrections', { timeout: 300_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let owner: Record<string, string>;
  const reader = () => createPayloadCorrectionReader(payloadOf(deps));

  const call = async (path: string, body: unknown, headers = owner) => {
    const res = await rest('POST', path, { headers, body });
    return { status: res.status, body: (await res.json()) as Body };
  };
  const patchRow = async (id: string) =>
    (await payload.find({ collection: 'event-patches', where: { eventId: { equals: id } }, overrideAccess: true, depth: 0 })).docs[0] as unknown as
      | Row
      | undefined;
  const versionOf = async (id: string) => Number((await patchRow(id))?.version ?? 0);
  const versionsOf = async (ids: string[]) => Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await versionOf(id)])));
  const save = async (changes: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    call('/event-patches/save', { changes, expectedVersions: await versionsOf(Object.keys(changes)), ...extra });
  const preview = async (changes: Record<string, unknown>) =>
    call('/event-patches/preview', { changes, expectedVersions: await versionsOf(Object.keys(changes)) });
  const maxId = async (collection: 'audit-log' | 'internal-events') =>
    Number(((await payload.find({ collection, sort: '-id', limit: 1, overrideAccess: true, depth: 0 })).docs[0] as Row | undefined)?.id ?? 0);
  const rowsAfter = async (collection: 'audit-log' | 'internal-events', after: number, field: 'action' | 'topic', value: string) =>
    (
      await payload.find({
        collection,
        where: { and: [{ id: { greater_than: after } }, { [field]: { equals: value } }] },
        sort: 'id',
        pagination: false,
        overrideAccess: true,
        depth: 0,
      })
    ).docs as unknown as Row[];
  const patches = async () => (await currentPatches(reader())).patches;

  beforeAll(async () => {
    deps = testDeps();
    payload = await payloadOf(deps)();
    await removeTinyCatalog(payload, run);
    const make = (collection: 'zones' | 'countries' | 'cities' | 'events', data: Record<string, unknown>) =>
      payload.create({ collection, data: data as never, overrideAccess: true, context: IMPORT_CONTEXT });
    const zone = `zone-${run}`;
    await make('zones', { zoneId: zone, order: 9001, offsetMinutes: 60, midnightUtc: MIDNIGHT });
    for (const [c, names] of [['A', ['a1', 'a2']], ['B', ['b1']], ['C', ['c1', 'c2', 'c3']]] as const) {
      const iso = `${c}${run}`;
      const city = `city${c}-${run}`;
      await make('countries', { iso, slug: `slug${c}-${run}`, name: { uk: `Тест ${c}` } });
      await make('cities', { cityId: city, countryIso: iso, zoneId: zone, name: { uk: 'Місто' } });
      for (const [i, name] of names.entries()) {
        await make('events', { eventId: ev(name), cityId: city, zoneId: zone, countryIso: iso, midnightUtc: MIDNIGHT, isMainCelebration: i === 0 });
      }
    }
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
  });

  afterAll(async () => {
    createTestClock().reset();
    await payload.delete({ collection: 'event-patches', where: { eventId: { like: run } }, overrideAccess: true, context: { t2fTrusted: true } });
    await removeTinyCatalog(payload, run);
    await removeAdmins(payload, [OWNER]);
  });

  it('only the owner: no session → 403, nothing written', async () => {
    const res = await call('/event-patches/save', { changes: { [ev('c2')]: { hidden: true } }, expectedVersions: { [ev('c2')]: 0 } }, personMark());
    expect(res.status).toBe(403);
    expect(await patchRow(ev('c2'))).toBeUndefined();
  });

  it('AC-54, AC-20, AC-60, AC-62: at 31.12 23:40 UTC a save → one journal row, one event; the catalog and its version unchanged', async () => {
    const before = await readCatalog(catalogStoreOf(deps));
    const journal0 = await maxId('audit-log');
    const events0 = await maxId('internal-events');
    const clock = createTestClock();
    clock.set({ at: Date.parse('2026-12-31T23:40:00Z'), frozen: true });
    try {
      const res = await save({ [ev('c2')]: { moment: BASE + 30 * MIN } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    } finally {
      clock.reset();
    }
    const rows = await rowsAfter('audit-log', journal0, 'action', 'correction.save');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: { kind: 'owner' },
      target: { collection: 'event-patches', ref: ev('c2') },
      before: { [ev('c2')]: null },
      after: { [ev('c2')]: { moment: BASE + 30 * MIN } },
      revertible: true,
    });
    const published = await rowsAfter('internal-events', events0, 'topic', EVENT_PATCH_CHANGED_TOPIC);
    expect(published).toHaveLength(1);
    expect(published[0]?.payload).toMatchObject({
      eventId: ev('c2'),
      before: null,
      after: { moment: BASE + 30 * MIN },
      at: '2026-12-31T23:40:00.000Z',
      actor: { kind: 'owner' },
    });
    expect(await readCatalog(catalogStoreOf(deps))).toEqual(before);
  });

  it('AC-62: the port returns { moment, isMainCelebration, restrained, hidden } of the changed event', async () => {
    const res = await save({ [ev('c3')]: { moment: BASE - 10 * MIN, isMainCelebration: false, restrained: { note: 'Тиша' }, hidden: true } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await patches())[ev('c3')]).toEqual({ moment: BASE - 10 * MIN, isMainCelebration: false, restrained: { note: 'Тиша' }, hidden: true });
  });

  it('AC-61: two tabs read version N; the first saves; the second with N → changed-since', async () => {
    const v = await versionOf(ev('c1'));
    const body = (moment: number) => ({ changes: { [ev('c1')]: { moment } }, expectedVersions: { [ev('c1')]: v } });
    expect((await call('/event-patches/save', body(BASE + MIN))).status).toBe(200);
    const second = await call('/event-patches/save', body(BASE + 2 * MIN));
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({ code: 'conflict', reason: 'changed-since' });
    expect((await patches())[ev('c1')]?.moment).toBe(BASE + MIN);
  });

  it('AC-55: +60 and −60 min → saved; +61 min → correction-out-of-range', async () => {
    expect((await save({ [ev('c1')]: { moment: BASE + 60 * MIN } })).status).toBe(200);
    expect((await save({ [ev('c1')]: { moment: BASE - 60 * MIN } })).status).toBe(200);
    const out = await save({ [ev('c1')]: { moment: BASE + 61 * MIN } });
    expect(out.status).toBe(400);
    expect(out.body.error?.reason).toBe('correction-out-of-range');
    expect((await patches())[ev('c1')]?.moment).toBe(BASE - 60 * MIN);
  });

  it('AC-59: a note without uk → refused, 201 characters → refused, <b>x</b> stored and returned unchanged', async () => {
    for (const restrained of [{}, { note: 'x'.repeat(201) }]) {
      const res = await save({ [ev('c1')]: { restrained } });
      expect(res.status).toBe(400);
      expect(res.body.error?.reason).toBe('invalid-input');
    }
    expect((await save({ [ev('c1')]: { restrained: { note: '<b>x</b>' } } })).status).toBe(200);
    expect((await patchRow(ev('c1')))?.restrainedNote).toBe('<b>x</b>');
    expect((await patches())[ev('c1')]?.restrained).toEqual({ note: '<b>x</b>' });
  });

  it('AC-56: a pair with two events, marking the second → the first is not main; one journal row; two events with one version', async () => {
    const journal0 = await maxId('audit-log');
    const events0 = await maxId('internal-events');
    const res = await save({ [ev('a2')]: { isMainCelebration: true } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const now = await patches();
    expect(now[ev('a1')]).toEqual({ isMainCelebration: false });
    expect(now[ev('a2')]).toEqual({ isMainCelebration: true });
    expect(await rowsAfter('audit-log', journal0, 'action', 'correction.save')).toHaveLength(1);
    const published = await rowsAfter('internal-events', events0, 'topic', EVENT_PATCH_CHANGED_TOPIC);
    expect(published.map((e) => (e.payload as { eventId: string }).eventId).sort()).toEqual([ev('a1'), ev('a2')]);
    const versions = new Set(published.map((e) => (e.payload as { version: number }).version));
    expect(versions.size).toBe(1);
    expect([...versions][0]).toBe((res.body.value as { version: number }).version);
  });

  it('AC-57: hiding the main without a new main → main-required; with a new main → saved', async () => {
    const refused = await save({ [ev('a2')]: { hidden: true } });
    expect(refused.status).toBe(409);
    expect(refused.body.error?.reason).toBe('main-required');
    const ok = await save({ [ev('a2')]: { hidden: true }, [ev('a1')]: { isMainCelebration: true } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const now = await patches();
    expect(now[ev('a1')]).toEqual({ isMainCelebration: true });
    expect(now[ev('a2')]).toEqual({ isMainCelebration: false, hidden: true });
  });

  it('AC-53, AC-58: a single-event pair → the preview has "was → will be", the local time and the warning; save needs the confirmation', async () => {
    const pv = await preview({ [ev('b1')]: { hidden: true, moment: BASE + 15 * MIN } });
    expect(pv.status).toBe(200);
    expect(pv.body.value).toMatchObject({
      warnings: ['pair-without-main'],
      items: [
        {
          eventId: ev('b1'),
          version: 0,
          before: { moment: BASE, hidden: false, isMainCelebration: true },
          after: { moment: BASE + 15 * MIN, hidden: true, isMainCelebration: true },
          localTime: { before: '2027-01-01 00:00', after: '2027-01-01 00:15' },
          changed: true,
        },
      ],
    });
    expect(await patchRow(ev('b1'))).toBeUndefined();
    const unconfirmed = await save({ [ev('b1')]: { hidden: true } });
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.error).toMatchObject({ reason: 'warnings-not-confirmed', warnings: ['pair-without-main'] });
    expect((await save({ [ev('b1')]: { hidden: true } }, { confirmWarnings: true })).status).toBe(200);
    expect((await patches())[ev('b1')]).toEqual({ hidden: true });
  });

  it('an unknown event → not_found; a malformed body → validation; nothing written', async () => {
    const unknown = await call('/event-patches/save', { changes: { [`nope-${run}`]: { hidden: true } }, expectedVersions: { [`nope-${run}`]: 0 } });
    expect(unknown.status).toBe(404);
    expect((await call('/event-patches/save', { changes: [] })).status).toBe(400);
    expect((await call('/event-patches/save', { changes: { [ev('c2')]: { title: 'x' } }, expectedVersions: { [ev('c2')]: await versionOf(ev('c2')) } })).status).toBe(400);
  });

  it('AC-42: three corrections before a subscriber reads → the port has the third version and all three values', async () => {
    const v0 = (await currentPatches(reader())).version;
    expect((await save({ [ev('c1')]: { moment: BASE + 5 * MIN } })).status).toBe(200);
    expect((await save({ [ev('c2')]: { moment: BASE + 6 * MIN } })).status).toBe(200);
    expect((await save({ [ev('c3')]: { moment: BASE + 7 * MIN } })).status).toBe(200);
    const read = await currentPatches(reader());
    expect(read.version).toBe(v0 + 3);
    expect([ev('c1'), ev('c2'), ev('c3')].map((id) => read.patches[id]?.moment)).toEqual([BASE + 5 * MIN, BASE + 6 * MIN, BASE + 7 * MIN]);
    const latest = await eventsOf(deps).log.latest(EVENT_PATCH_CHANGED_TOPIC);
    expect(latest?.payload).toMatchObject({ eventId: ev('c3'), version: v0 + 3 });
  });

  it('AC-22, AC-54: revert of a correction → one more event with the restored values; the journal has the linked row', async () => {
    const before = (await patches())[ev('c2')];
    const journal0 = await maxId('audit-log');
    expect((await save({ [ev('c2')]: { moment: BASE + 20 * MIN, hidden: true } })).status).toBe(200);
    const [row] = await rowsAfter('audit-log', journal0, 'action', 'correction.save');
    if (!row) throw new Error('no journal row');
    const events0 = await maxId('internal-events');
    const reverted = await rest('POST', `/audit-log/${row.id}/revert`, { headers: owner });
    expect(reverted.status, await reverted.clone().text()).toBe(200);
    expect((await patches())[ev('c2')]).toEqual(before);
    const published = await rowsAfter('internal-events', events0, 'topic', EVENT_PATCH_CHANGED_TOPIC);
    expect(published).toHaveLength(1);
    expect(published[0]?.payload).toMatchObject({ eventId: ev('c2'), before: { moment: BASE + 20 * MIN, hidden: true }, after: before });
    const linked = await rowsAfter('audit-log', row.id, 'action', 'correction.save');
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ revertOf: String(row.id), revertible: true });
    // A second revert of the same row: the events no longer hold its `after`.
    const again = await rest('POST', `/audit-log/${row.id}/revert`, { headers: owner });
    expect(again.status).toBe(409);
  });
});
