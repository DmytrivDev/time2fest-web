/** Moderation and AI settings (SPEC-09): thresholds and spend ceilings. The owner reads; the admin slice endpoint writes. */
import type { Endpoint, GlobalConfig, PayloadRequest } from 'payload';
import { hasJsonContentType } from '../access/payloadGuard';
import { ownerOnly, roleOf } from '../access/policies';
import { processDeps } from '../adapters/processDeps';
import { resolveActor } from '../audit/journal';
import type { SettingsInput } from '../domain/moderation/settings';
import { moderationOf } from '../endpoints/deps';
import { saveSettings } from '../moderation/settings';

const never = () => false;
const NO_STORE = { 'cache-control': 'no-store' };
const MAX_BODY_BYTES = 1024;
const KEYS = ['review', 'block', 'nightCeilingUsd', 'monthCeilingUsd'] as const;

const fail = (status: number, code: 'forbidden' | 'validation', fields?: readonly string[]) =>
  Response.json({ ok: false, error: { code, ...(fields ? { fields } : {}) } }, { status, headers: NO_STORE });

/** Exactly the four numeric keys from a JSON body ≤ 1 KB, or `null`. */
async function inputOf(req: PayloadRequest): Promise<SettingsInput | null> {
  if (!hasJsonContentType(req)) return null;
  try {
    const text = req.text ? await req.text() : '';
    if (text.length === 0 || text.length > MAX_BODY_BYTES) return null;
    const body = JSON.parse(text) as unknown;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    const keys = Object.keys(body);
    if (keys.length !== KEYS.length || KEYS.some((k) => !keys.includes(k))) return null;
    const rec = body as Record<(typeof KEYS)[number], unknown>;
    if (KEYS.some((k) => typeof rec[k] !== 'number')) return null;
    return { review: rec.review as number, block: rec.block as number, nightCeilingUsd: rec.nightCeilingUsd as number, monthCeilingUsd: rec.monthCeilingUsd as number };
  } catch {
    return null;
  }
}

const saveEndpoint: Endpoint = {
  path: '/save',
  method: 'post',
  handler: async (req) => {
    if (roleOf(req.user) !== 'owner') return fail(403, 'forbidden');
    const input = await inputOf(req);
    if (input === null) return fail(400, 'validation');
    const m = moderationOf(await processDeps());
    const res = await saveSettings(m.settings, null, input, { ...resolveActor(req.user, req.context), kind: 'owner' });
    if (!res.ok) return fail(400, 'validation', res.fields);
    return Response.json({ ok: true, value: res.value }, { headers: NO_STORE });
  },
};

export const moderationSettings: GlobalConfig = {
  slug: 'moderation-settings',
  label: 'Модерація й AI',
  admin: { group: 'Модерація' },
  access: { read: ownerOnly, update: never, readVersions: ownerOnly },
  endpoints: [saveEndpoint],
  fields: [
    { name: 'reviewThreshold', type: 'number', label: 'Поріг перевірки', defaultValue: 0.5, admin: { readOnly: true } },
    { name: 'blockThreshold', type: 'number', label: 'Поріг блокування', defaultValue: 0.8, admin: { readOnly: true } },
    { name: 'nightCeilingUsd', type: 'number', label: 'Стеля за ніч, USD', defaultValue: 50, admin: { readOnly: true } },
    { name: 'monthCeilingUsd', type: 'number', label: 'Стеля за місяць, USD', defaultValue: 100, admin: { readOnly: true } },
    { name: 'version', type: 'number', label: 'Версія', defaultValue: 0, admin: { readOnly: true } },
  ],
};
