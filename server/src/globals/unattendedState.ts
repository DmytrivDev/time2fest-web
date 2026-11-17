/**
 * The unattended-mode state (AC-32 … AC-36). Payload glue (ring 4), thin: the rule is
 * `domain/unattended/machine.ts`, the transitions `unattended/service.ts`.
 *
 * The owner reads it; nobody updates it through the API — only the service writes it, with one journal
 * row and one `unattended.changed` event per transition. The owner's manual switch (AC-33, AC-35) is
 * `POST /cms-api/globals/unattended-state/manual` with `{ "on": boolean }` → `ApiResult`.
 */
import type { Endpoint, GlobalConfig, PayloadRequest } from 'payload';
import { hasJsonContentType } from '../access/payloadGuard';
import { ownerOnly, roleOf } from '../access/policies';
import { resolveActor } from '../audit/journal';
import { setManual, UNATTENDED_STATE } from '../unattended/service';

const never = () => false;
const NO_STORE = { 'cache-control': 'no-store' };
const MAX_BODY_BYTES = 1024;

const fail = (status: number, code: 'forbidden' | 'validation') => Response.json({ ok: false, error: { code } }, { status, headers: NO_STORE });

/** `{ on: boolean }` from the body, or `null`. */
async function onOf(req: PayloadRequest): Promise<boolean | null> {
  if (!hasJsonContentType(req)) return null;
  try {
    const text = req.text ? await req.text() : '';
    if (text.length === 0 || text.length > MAX_BODY_BYTES) return null;
    const body = JSON.parse(text) as unknown;
    if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).some((k) => k !== 'on')) return null;
    const on = (body as { on?: unknown }).on;
    return typeof on === 'boolean' ? on : null;
  } catch {
    return null;
  }
}

const manualEndpoint: Endpoint = {
  path: '/manual',
  method: 'post',
  handler: async (req) => {
    if (roleOf(req.user) !== 'owner') return fail(403, 'forbidden');
    const on = await onOf(req);
    if (on === null) return fail(400, 'validation');
    const { getDeps, unattendedDepsOf } = await import('../container');
    const { state } = await setManual(unattendedDepsOf(getDeps()), req, on, { ...resolveActor(req.user, req.context), kind: 'owner' });
    return Response.json({ ok: true, value: { on: state.on, cause: state.cause, version: state.version } }, { headers: NO_STORE });
  },
};

export const unattendedState: GlobalConfig = {
  slug: UNATTENDED_STATE,
  label: 'Режим без нагляду',
  admin: { group: 'Без нагляду' },
  access: { read: ownerOnly, update: never, readVersions: ownerOnly },
  endpoints: [manualEndpoint],
  fields: [
    { name: 'on', type: 'checkbox', label: 'Увімкнено', defaultValue: false, admin: { readOnly: true } },
    { name: 'cause', type: 'select', label: 'Причина', options: ['schedule', 'manual', 'alarm'], admin: { readOnly: true } },
    { name: 'manualAt', type: 'date', label: 'Ручне перемикання, UTC', admin: { readOnly: true } },
    { name: 'version', type: 'number', label: 'Версія', defaultValue: 0, admin: { readOnly: true } },
    { name: 'changedAt', type: 'date', label: 'Змінено, UTC', admin: { readOnly: true } },
  ],
};
