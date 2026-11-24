/**
 * The owner's monitoring overview and `ops-settings` change on the worktree's test database (SPEC-13b AC-30 … AC-36, AC-66; W34).
 * Requests go straight into Payload's REST handler (`/cms-api/ops/*`) with the proxy's identity marker and an admin session.
 * - AC-30: `content-agent`, `stream-agent`, no login → 403 (overview and settings); owner → 200 `no-store`.
 * - AC-31: the `live` provider throws → 200, `errors:['live']`, every other block filled.
 * - AC-32: two open `page` alarms → both listed; acknowledging one through the existing endpoint → the next read lists one.
 * - AC-34: the metrics equal the slices of their own domains (`festival-state`, `live/view`, `site/view`, the moderation totals).
 * - AC-36: ≤ 64 KB, no secret value of the process environment in the answer.
 * - AC-66: the owner changes `ops-settings` → one journal row `ops.settings`, version + 1; an agent → 403, nothing changed.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDeps, payloadOf, seedStoreOf } from '../../src/container';
import { alarmStoreOf, liveOf, moderationOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import { baseSeedRows, runSeed } from '../../src/seed/index';
import { OverviewSchema, OVERVIEW_MAX_BYTES, type Overview } from '../../src/ops/overviewSchema';
import { apiKeyHeader, makeAdmin, personMark, removeAdmins, rest, serviceMark, sessionCookie } from './payload-rest';

const OWNER = 'ops-overview-owner@example.com';
const CONTENT = 'ops-overview-content@example.com';
const STREAM = 'ops-overview-stream@example.com';
const PASSWORD = 'ops-overview-password-0001'; // check-secrets: allow test fake
const run = `ov${Date.now()}`;

type Row = Record<string, unknown> & { id: number };
/** The fields of the domain slices the overview must equal. */
interface Slices {
  edgeSkewMs: number | null;
  scheduler: { holder: string | null; epoch: number; missed24h: number };
  version: number;
  quota: { bucket: string; used: number; perDay: number; percent: number }[];
  state: { version: number };
  paymentsPause?: string | null;
}

describe('owner monitoring overview', { timeout: 120_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let owner: Record<string, string>;
  let content: Record<string, string>;
  let stream: Record<string, string>;
  const alarmIds: string[] = [];

  const overview = async (headers = owner): Promise<Overview> => {
    const res = await rest('GET', '/ops/overview', { headers });
    expect(res.status, await res.clone().text()).toBe(200);
    return OverviewSchema.parse(((await res.json()) as { value: unknown }).value);
  };
  const valueOf = async (path: string) => ((await (await rest('GET', path, { headers: owner })).json()) as { value: Slices }).value;

  async function agentHeaders(email: string, role: 'content-agent' | 'stream-agent'): Promise<Record<string, string>> {
    const id = await makeAdmin(payload, email, PASSWORD, role);
    const issued = await rest('POST', `/admins/${id}/issue-key`, { headers: owner });
    expect(issued.status).toBe(200);
    return { ...apiKeyHeader(((await issued.json()) as { key: string }).key), ...serviceMark() };
  }

  beforeAll(async () => {
    deps = getDeps();
    payload = await payloadOf(deps)();
    // The site snapshot reads the season catalog: seed it (idempotent) instead of relying on an earlier file.
    await runSeed(seedStoreOf(deps), baseSeedRows());
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
    content = await agentHeaders(CONTENT, 'content-agent');
    stream = await agentHeaders(STREAM, 'stream-agent');
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!payload) return;
    for (const id of alarmIds) await payload.delete({ collection: 'alarms', id, overrideAccess: true }).catch(() => undefined);
    await removeAdmins(payload, [OWNER, CONTENT, STREAM]);
  });

  it('AC-30: agents and visitors without login → 403 on /ops/*; the owner → 200 no-store', async () => {
    for (const headers of [content, stream, personMark()]) {
      expect((await rest('GET', '/ops/overview', { headers })).status).toBe(403);
      expect((await rest('POST', '/ops/settings', { headers, body: { heartbeatMinute: 5 } })).status).toBe(403);
    }
    const res = await rest('GET', '/ops/overview', { headers: owner });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('AC-31, AC-36: every block present, schema valid, ≤ 64 KB, no secret value of the environment', async () => {
    const res = await rest('GET', '/ops/overview', { headers: owner });
    const text = await res.text();
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(OVERVIEW_MAX_BYTES);
    const o = OverviewSchema.parse((JSON.parse(text) as { value: unknown }).value);
    expect(Object.keys(o.blocks).sort()).toEqual(['alarms', 'backups', 'catalog', 'live', 'logAlarms', 'moderation', 'pending', 'scheduler', 'site', 'spend', 'telegram', 'time']);
    for (const [name, value] of Object.entries(deps.env.vars)) {
      if (typeof value !== 'string' || value.length < 8 || !/KEY|TOKEN|SECRET|PASSWORD|URI/i.test(name)) continue;
      expect(text.includes(value), `secret ${name} leaked`).toBe(false);
    }
  });

  it('AC-31: a failing live provider → 200, errors [live], the other blocks filled', async () => {
    const spy = vi.spyOn(liveOf(deps).quota, 'read').mockRejectedValue(new Error('boom'));
    try {
      const o = await overview();
      expect(o.errors).toEqual(['live']);
      expect(o.blocks.live).toBeNull();
      expect(o.blocks.alarms).not.toBeNull();
      expect(o.blocks.pending).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('AC-32: two open page alarms are listed; one acknowledged through the existing endpoint → one left', async () => {
    const a = await alarmStoreOf(deps).save({ source: 'test', code: `ov-a-${run}` });
    const b = await alarmStoreOf(deps).save({ source: 'test', code: `ov-b-${run}` });
    alarmIds.push(a.id, b.id);
    const before = (await overview()).blocks.alarms?.items.map((i) => i.id) ?? [];
    expect(before).toEqual(expect.arrayContaining([a.id, b.id]));
    expect((await rest('POST', `/alarms/${a.id}/acknowledge`, { headers: owner })).status).toBe(200);
    const after = (await overview()).blocks.alarms?.items.map((i) => i.id) ?? [];
    expect(after).not.toContain(a.id);
    expect(after).toContain(b.id);
  });

  it('AC-34: the metrics equal the slices of their own domains', async () => {
    const o = await overview();
    const festival = await valueOf('/festival-state');
    expect(o.blocks.time?.edgeSkewMs).toBe(festival.edgeSkewMs);
    expect(o.blocks.scheduler?.holder).toBe(festival.scheduler.holder);
    expect(o.blocks.scheduler?.epoch).toBe(festival.scheduler.epoch);
    expect(o.blocks.scheduler?.missed24h).toBe(festival.scheduler.missed24h);
    const live = await valueOf('/live/view');
    expect(o.blocks.live?.version).toBe(live.version);
    expect(o.blocks.live?.quota).toEqual(live.quota.map((q) => ({ bucket: q.bucket, used: q.used, perDay: q.perDay, percent: q.percent })));
    const site = await valueOf('/site/view');
    expect(o.blocks.site?.version).toBe(site.state.version);
    expect(o.blocks.site?.paymentsPause).toBe(site.paymentsPause ?? null);
    const totals = moderationOf(deps).spend.totals();
    expect(o.blocks.moderation?.month?.usd).toBe(totals.month.usd);
    expect(o.blocks.moderation?.month?.ceilingUsd).toBe(totals.month.ceilingUsd);
  });

  it('AC-66: the owner changes ops-settings → version + 1 and one journal row; an agent → 403', async () => {
    const mark = Number(((await payload.find({ collection: 'audit-log', sort: '-id', limit: 1, overrideAccess: true, depth: 0 })).docs[0] as Row | undefined)?.id ?? 0);
    const read = async () => (await payload.findGlobal({ slug: 'ops-settings', depth: 0, overrideAccess: true })) as unknown as Record<string, number>;
    const was = await read();
    const next = (was.heartbeatMinute ?? 0) === 7 ? 8 : 7;
    const res = await rest('POST', '/ops/settings', { headers: owner, body: { heartbeatMinute: next } });
    expect(res.status, await res.clone().text()).toBe(200);
    const now = await read();
    expect(now.heartbeatMinute).toBe(next);
    expect(now.version).toBe((was.version ?? 0) + 1);
    const rows = (
      await payload.find({
        collection: 'audit-log',
        where: { and: [{ id: { greater_than: mark } }, { action: { equals: 'ops.settings' } }] },
        pagination: false,
        overrideAccess: true,
        depth: 0,
      })
    ).docs as unknown as Row[];
    expect(rows).toHaveLength(1);
    // Invalid values and unknown keys are refused; an agent cannot change anything.
    expect((await rest('POST', '/ops/settings', { headers: owner, body: { heartbeatMinute: 99 } })).status).toBe(400);
    expect((await rest('POST', '/ops/settings', { headers: owner, body: { nope: 1 } })).status).toBe(400);
    expect((await rest('POST', '/ops/settings', { headers: content, body: { heartbeatMinute: 1 } })).status).toBe(403);
    expect((await read()).heartbeatMinute).toBe(next);
    // Put the value back (a second journal row, harmless).
    expect((await rest('POST', '/ops/settings', { headers: owner, body: { heartbeatMinute: was.heartbeatMinute ?? 0 } })).status).toBe(200);
  });
});
