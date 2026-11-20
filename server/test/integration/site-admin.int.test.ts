/**
 * The owner's site-state endpoints on the worktree's test database (SPEC-08 AC-10, AC-12, AC-16, AC-19 … AC-21;
 * W18, W21). Requests go straight into Payload's REST handler (`/cms-api/...`, root endpoints) with the proxy's
 * identity marker and an admin session, like `clock-control.int.test.ts`; the endpoints use THE process deps
 * (class `test`: the products port is the settable fake).
 * - AC-10: a Payload REST update of the global `site-state` is refused; the state is unchanged.
 * - AC-12: an owner toggle writes exactly one journal row (actor, before/after, reason, mode); its revert
 *   restores the previous value under a new version.
 * - AC-16: `content-agent`, `stream-agent` and an anonymous caller → 403 `forbidden`, nothing changes.
 * - AC-19: two `pass` products in the fake: choosing the second → its price, `priceVersion` + 1.
 * - AC-20: an unknown id or another key's id → 400 `validation` (`unknown-product` / `other-key`), snapshot unchanged.
 * - AC-21: no route or cms endpoint takes an amount; a price written through the Payload API is refused.
 */
import { SiteSwitchBodySchema, SiteProductBodySchema, SiteStateSchema } from '@time2fest/contracts/schemas';
import type { SiteState } from '@time2fest/contracts';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cmsEndpointsFor } from '../../src/admin/cmsEndpoints';
import { getDeps, payloadOf, seedStoreOf } from '../../src/container';
import { baseSeedRows, runSeed } from '../../src/seed/index';
import { siteOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import { routeRegistry } from '../../src/registries/routes';
import { readSnapshot } from '../../src/site/snapshot';
import { SITE_PRODUCT_ACTION, SITE_SWITCH_ACTION } from '../../src/site/service';
import { apiKeyHeader, makeAdmin, personMark, removeAdmins, rest, serviceMark, sessionCookie } from './payload-rest';

const OWNER = 'site-admin-owner@example.com';
const CONTENT = 'site-admin-content@example.com';
const STREAM = 'site-admin-stream@example.com';
const PASSWORD = 'site-admin-password-0001'; // check-secrets: allow test fake
const run = `sa${Date.now()}`;

type Row = Record<string, unknown> & { id: number };
type Json = { ok: boolean; value?: Record<string, unknown>; error?: { code: string; reason?: string } };

describe('owner site-state endpoints', { timeout: 120_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let owner: Record<string, string>;
  let content: Record<string, string>;
  let stream: Record<string, string>;

  const json = async (res: Response) => (await res.json()) as Json;
  const snapshot = async (): Promise<SiteState> => {
    const read = await readSnapshot(siteOf(deps).snapshot);
    if (!read.ok) throw new Error(`snapshot: ${read.reason}`);
    return read.state;
  };
  const maxJournalId = async () =>
    Number(((await payload.find({ collection: 'audit-log', sort: '-id', limit: 1, overrideAccess: true, depth: 0 })).docs[0] as Row | undefined)?.id ?? 0);
  const rowsAfter = async (after: number, action: string) =>
    (
      await payload.find({
        collection: 'audit-log',
        where: { and: [{ id: { greater_than: after } }, { action: { equals: action } }] },
        sort: 'id',
        pagination: false,
        overrideAccess: true,
        depth: 0,
      })
    ).docs as unknown as Row[];
  const switchCall = (body: unknown, headers = owner) => rest('POST', '/site/switch', { headers, body });
  const productCall = (body: unknown, headers = owner) => rest('POST', '/site/product', { headers, body });

  async function agentHeaders(email: string, role: 'content-agent' | 'stream-agent'): Promise<Record<string, string>> {
    const id = await makeAdmin(payload, email, PASSWORD, role);
    const issued = await rest('POST', `/admins/${id}/issue-key`, { headers: owner });
    expect(issued.status).toBe(200);
    return { ...apiKeyHeader(((await issued.json()) as { key: string }).key), ...serviceMark() };
  }

  beforeAll(async () => {
    // THE process deps: the endpoints and the revert handlers resolve these.
    deps = getDeps();
    expect(deps.env.class).toBe('test');
    payload = await payloadOf(deps)();
    // The snapshot reads the season catalog: seed it (idempotent) instead of relying on an earlier file.
    await runSeed(seedStoreOf(deps), baseSeedRows());
    await siteOf(deps).resetForTests?.();
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
    content = await agentHeaders(CONTENT, 'content-agent');
    stream = await agentHeaders(STREAM, 'stream-agent');
  });

  afterAll(async () => {
    if (!payload) return;
    await siteOf(deps).resetForTests?.();
    // One admin per call: a multi-document `payload.delete` runs its cleanup queries in parallel on one
    // transaction client, which pg flags as deprecated («client.query() when the client is already executing»).
    for (const email of [OWNER, CONTENT, STREAM]) await removeAdmins(payload, [email]);
  });

  it('AC-10: a Payload REST update of the global is refused; the state is unchanged', async () => {
    const before = await snapshot();
    const res = await rest('POST', '/globals/site-state', { headers: owner, body: { switches: { ...before.switches, chat: false }, version: 99 } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    await expect(
      payload.updateGlobal({ slug: 'site-state', data: { switches: { ...before.switches, chat: false } } as never, overrideAccess: false, user: null }),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it('AC-12: an owner toggle writes one journal row (actor, before/after, reason, mode); the revert restores it under a new version', async () => {
    const before = await snapshot();
    const mark = await maxJournalId();
    const res = await switchCall({ key: 'chat', value: !before.switches.chat, reason: `Технічна пауза ${run}` });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await json(res);
    expect(body.value).toMatchObject({ changed: true });
    const toggled = await snapshot();
    expect(toggled.switches.chat).toBe(!before.switches.chat);
    expect(toggled.version).toBe(body.value?.version);
    expect(toggled.version).toBeGreaterThan(before.version);

    const rows = await rowsAfter(mark, SITE_SWITCH_ACTION);
    expect(rows).toHaveLength(1);
    const row = rows[0] as Row;
    expect(row.actor).toMatchObject({ kind: 'owner', label: OWNER });
    expect(row.before).toMatchObject({ key: 'chat', value: before.switches.chat });
    expect(row.after).toMatchObject({ key: 'chat', value: !before.switches.chat, reason: `Технічна пауза ${run}`, mode: 'manual' });
    expect(row.revertible).toBe(true);

    const reverted = await rest('POST', `/audit-log/${row.id}/revert`, { headers: owner });
    expect(reverted.status, await reverted.clone().text()).toBe(200);
    const restored = await snapshot();
    expect(restored.switches.chat).toBe(before.switches.chat);
    expect(restored.version).toBeGreaterThan(toggled.version);
    const after = await rowsAfter(mark, SITE_SWITCH_ACTION);
    expect(after).toHaveLength(2);
    expect((after[1] as Row).revertOf).toBe(String(row.id));
  });

  it('AC-16: content-agent, stream-agent and anonymous → 403 forbidden; nothing changes, no journal row', async () => {
    const pass = `pass-${run}-a`;
    siteOf(deps).testProducts?.set([{ id: pass, key: 'pass', price: { amount: 500, currency: 'USD' } }]);
    const before = await snapshot();
    const mark = await maxJournalId();
    for (const headers of [content, stream, {}]) {
      const sw = await switchCall({ key: 'chat', value: !before.switches.chat, reason: 'not mine' }, headers);
      expect(sw.status).toBe(403);
      expect((await json(sw)).error?.code).toBe('forbidden');
      const pr = await productCall({ key: 'pass', productId: pass, reason: 'not mine' }, headers);
      expect(pr.status).toBe(403);
      expect((await json(pr)).error?.code).toBe('forbidden');
      expect((await rest('GET', '/site/view', { headers })).status).toBe(403);
    }
    expect(await snapshot()).toEqual(before);
    expect(await maxJournalId()).toBe(mark);
  });

  it('AC-19: two pass products in the fake — choosing the second gives its price and priceVersion + 1', async () => {
    const first = `pass-${run}-1`;
    const second = `pass-${run}-2`;
    siteOf(deps).testProducts?.set([
      { id: first, key: 'pass', price: { amount: 500, currency: 'USD' } },
      { id: second, key: 'pass', price: { amount: 700, currency: 'USD' } },
    ]);
    const mark = await maxJournalId();
    expect((await productCall({ key: 'pass', productId: first, reason: 'базова ціна' })).status).toBe(200);
    const one = (await snapshot()).products.find((p) => p.key === 'pass');
    expect(one?.price).toEqual({ amount: 500, currency: 'USD' });

    const res = await productCall({ key: 'pass', productId: second, reason: 'нова ціна' });
    expect(res.status, await res.clone().text()).toBe(200);
    const two = await snapshot();
    expect(SiteStateSchema.safeParse(two).success).toBe(true);
    const pass = two.products.find((p) => p.key === 'pass');
    expect(pass?.price).toEqual({ amount: 700, currency: 'USD' });
    expect(pass?.priceVersion).toBe((one?.priceVersion ?? 0) + 1);
    expect(await rowsAfter(mark, SITE_PRODUCT_ACTION)).toHaveLength(2);

    const view = await rest('GET', '/site/view', { headers: owner });
    expect(view.status).toBe(200);
    const value = (await json(view)).value as { state: SiteState; products: unknown[]; selections: Record<string, { productId: string }>; paymentsPause: unknown };
    expect(value.state.version).toBe(two.version);
    expect(value.products).toHaveLength(2);
    expect(value.selections.pass?.productId).toBe(second);
    expect(value.paymentsPause).toBeNull();
  });

  it('AC-20: an unknown id or another key\'s id → 400 validation, snapshot unchanged', async () => {
    const toast = `toast-${run}`;
    siteOf(deps).testProducts?.set([
      { id: `pass-${run}-1`, key: 'pass', price: { amount: 500, currency: 'USD' } },
      { id: toast, key: 'toast:5', price: { amount: 500, currency: 'USD' } },
    ]);
    const before = await snapshot();
    const unknown = await productCall({ key: 'pass', productId: `nope-${run}`, reason: 'спроба' });
    expect(unknown.status).toBe(400);
    expect((await json(unknown)).error).toEqual({ code: 'validation', reason: 'unknown-product' });
    const other = await productCall({ key: 'pass', productId: toast, reason: 'спроба' });
    expect(other.status).toBe(400);
    expect((await json(other)).error).toEqual({ code: 'validation', reason: 'other-key' });
    expect(await snapshot()).toEqual(before);
  });

  it('AC-21: no route or cms endpoint takes an amount; a price through the Payload API is refused', async () => {
    // The public route table writes nothing about products or prices.
    for (const r of routeRegistry) expect(`${r.method} ${r.path}`).not.toMatch(/product|price/i);
    // The only product write of the admin is the choice of a listed product: its strict body has no amount.
    const writes = cmsEndpointsFor('test').filter((e) => e.method !== 'get').map((e) => e.path);
    expect(writes.filter((p) => /product|price/i.test(p))).toEqual(['/site/product']);
    const priced = { key: 'pass', productId: `pass-${run}-1`, reason: 'ціна', price: { amount: 1, currency: 'USD' } };
    expect(SiteProductBodySchema.safeParse(priced).success).toBe(false);
    expect(SiteSwitchBodySchema.safeParse({ key: 'pass', value: true, reason: 'x', amount: 1 }).success).toBe(false);

    const before = await snapshot();
    const viaEndpoint = await productCall(priced);
    expect(viaEndpoint.status).toBe(400);
    expect((await json(viaEndpoint)).error?.code).toBe('validation');
    const selections = { pass: { productId: `pass-${run}-1`, price: { amount: 1, currency: 'USD' }, priceVersion: 99 } };
    const viaRest = await rest('POST', '/globals/site-state', { headers: owner, body: { productSelections: selections } });
    expect(viaRest.status).toBeGreaterThanOrEqual(400);
    expect(viaRest.status).toBeLessThan(500);
    expect(await snapshot()).toEqual(before);
  });
});
