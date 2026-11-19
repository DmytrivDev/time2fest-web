/**
 * SPEC-09 W31: the moderation admin slice and its save endpoint. AC-41 (the slice shows spend, ceilings,
 * thresholds, task states), AC-42 (validation), AC-43 (save → state recomputed, one journal row with
 * before/after, owner only). The slice reads the process deps (like the admin page does).
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModerationSlice } from '../../src/admin/ModerationSlice';
import { processDeps } from '../../src/adapters/processDeps';
import { SETTINGS_ACTION } from '../../src/adapters/payloadModerationSettings';
import { payloadOf } from '../../src/container';
import { moderationOf } from '../../src/endpoints/deps';
import { testDeps } from './helpers';
import { apiKeyHeader, makeAdmin, personMark, serviceMark, removeAdmins, rest, sessionCookie } from './payload-rest';

const OWNER = 'admin-moderation-owner@example.com';
const AGENT = 'admin-moderation-agent@example.com';
const PASSWORD = 'admin-moderation-password-0001'; // check-secrets: allow test fake
const SAVE = '/globals/moderation-settings/save';
const GOOD = { review: 0.4, block: 0.7, nightCeilingUsd: 60, monthCeilingUsd: 120 };

type Row = { id: number; action: string; before?: Record<string, unknown>; after?: Record<string, unknown> };

describe('admin moderation slice (AC-41 … AC-43)', { timeout: 120_000 }, () => {
  let payload: Payload;
  let owner: Record<string, string>;
  let agent: Record<string, string>;

  const rows = async (): Promise<Row[]> =>
    (await payload.find({ collection: 'audit-log', where: { action: { equals: SETTINGS_ACTION } }, sort: 'id', limit: 100, overrideAccess: true, depth: 0 })).docs as unknown as Row[];

  beforeAll(async () => {
    payload = await payloadOf(testDeps())();
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    const agentId = await makeAdmin(payload, AGENT, PASSWORD, 'content-agent');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
    const issued = await rest('POST', `/admins/${agentId}/issue-key`, { headers: owner });
    agent = { ...apiKeyHeader(((await issued.json()) as { key: string }).key), ...serviceMark() };
  });

  afterAll(async () => {
    await removeAdmins(payload, [OWNER, AGENT]);
  });

  it('AC-41: the slice renders spend, ceilings, thresholds and both task states', async () => {
    const m = moderationOf(await processDeps());
    await m.spend.setSpendForDoor('month', 12.5);
    const el = (await ModerationSlice()) as unknown as {
      props: {
        month: { usd: number; ceilingUsd: number };
        tasks: { task: string }[];
        providers: { provider: string; status: string; calls: number; p95Ms: number; errorPercent: number }[];
        settings: Record<string, number>;
      };
    };
    expect(el.props.month.usd).toBeCloseTo(12.5, 4);
    expect(el.props.month.ceilingUsd).toBeGreaterThan(0);
    expect(el.props.tasks.map((t) => t.task)).toEqual(['moderation', 'translation']);
    expect(Object.keys(el.props.settings).sort()).toEqual(['block', 'monthCeilingUsd', 'nightCeilingUsd', 'review']);
    expect(el.props.providers.map((p) => p.provider).sort()).toEqual(['anthropic', 'deepseek']);
    for (const p of el.props.providers) {
      expect(Object.keys(p).sort()).toEqual(['calls', 'errorPercent', 'p95Ms', 'provider', 'reason', 'status']);
      expect(p.errorPercent).toBeGreaterThanOrEqual(0);
      expect(p.p95Ms).toBeGreaterThanOrEqual(0);
    }
    m.spend.reset();
  });

  it('AC-42: review above block (0.9 / 0.8) → validation, nothing written', async () => {
    const before = (await rows()).length;
    const res = await rest('POST', SAVE, { headers: owner, body: { ...GOOD, review: 0.9, block: 0.8 } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: { code: string; fields: string[] } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('validation');
    expect(body.error.fields).toContain('review');
    expect((await rows()).length).toBe(before);
  });

  it('AC-42: a body with an extra key or a string number is refused', async () => {
    expect((await rest('POST', SAVE, { headers: owner, body: { ...GOOD, extra: 1 } })).status).toBe(400);
    expect((await rest('POST', SAVE, { headers: owner, body: { ...GOOD, review: '0.4' } })).status).toBe(400);
  });

  it('AC-43: a ceiling change is saved (version + 1), journalled once with before/after, and the counter recomputes', async () => {
    const m = moderationOf(await processDeps());
    const before = (await rows()).length;
    const v0 = (await m.settings.read()).version;
    await m.spend.setSpendForDoor('month', 30);
    const res = await rest('POST', SAVE, { headers: owner, body: { ...GOOD, monthCeilingUsd: 25 } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { value: { version: number } }).value.version).toBe(v0 + 1);

    const after = await rows();
    expect(after.length).toBe(before + 1);
    const row = after.at(-1) as Row;
    expect(row.before?.monthCeilingUsd).toBeDefined();
    expect(row.after?.monthCeilingUsd).toBe(25);

    await m.spend.tick();
    expect(m.spend.settings().monthCeilingUsd).toBe(25);
    expect(m.spend.reached()).toBe(true);
    expect(m.layer.state('moderation')).toMatchObject({ state: 'fallback', reason: 'ceiling' });

    // restore the defaults for the next files
    expect((await rest('POST', SAVE, { headers: owner, body: { review: 0.5, block: 0.8, nightCeilingUsd: 50, monthCeilingUsd: 100 } })).status).toBe(200);
    m.spend.reset();
  });

  it('AC-43: an agent and an anonymous caller are refused on save and on read', async () => {
    expect((await rest('POST', SAVE, { headers: agent, body: GOOD })).status).toBe(403);
    expect((await rest('POST', SAVE, { body: GOOD })).status).toBeGreaterThanOrEqual(401);
    expect((await rest('GET', '/globals/moderation-settings', { headers: agent })).status).toBe(403);
    expect((await rest('GET', '/globals/moderation-settings', {})).status).toBeGreaterThanOrEqual(401);
    expect((await rest('GET', '/globals/moderation-settings', { headers: owner })).status).toBe(200);
  });
});
