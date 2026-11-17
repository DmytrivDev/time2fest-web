/**
 * Stored `page` alarms (AC-37 … AC-39). The owner reads them; no role writes them through the API
 * — rows are saved by the alarm store and acknowledged through
 * `POST /cms-api/alarms/:id/acknowledge` (owner, AC-38), which is journalled.
 */
import type { CollectionConfig, Endpoint } from 'payload';
import { accessFor, roleOf } from '../access/policies';
import { ALARMS, createPayloadAlarmStore } from '../adapters/payloadAlarms';
import { createAlarmService } from '../alarms/service';
import { clockFor } from '../clock';
import { envClass } from '../platform/env';

const never = () => false;
const NO_STORE = { 'cache-control': 'no-store' };

const acknowledgeEndpoint: Endpoint = {
  path: '/:id/acknowledge',
  method: 'post',
  handler: async (req) => {
    const clock = clockFor(envClass(process.env));
    const service = createAlarmService(createPayloadAlarmStore(async () => req.payload, clock), clock);
    const result = await service.acknowledge(req, roleOf(req.user), String(req.routeParams?.id ?? ''));
    if (result.ok) return Response.json({ ok: true, value: {} }, { headers: NO_STORE });
    const status = result.reason === 'forbidden' ? 403 : 404;
    const code = result.reason === 'forbidden' ? 'forbidden' : 'not_found';
    return Response.json({ ok: false, error: { code } }, { status, headers: NO_STORE });
  },
};

const policy = accessFor('alarms');

export const alarms: CollectionConfig = {
  slug: ALARMS,
  admin: { useAsTitle: 'code', defaultColumns: ['raisedAt', 'source', 'code', 'acknowledgedAt'] },
  access: { read: policy.read, create: never, update: never, delete: never },
  endpoints: [acknowledgeEndpoint],
  fields: [
    { name: 'source', type: 'text', required: true },
    { name: 'code', type: 'text', required: true },
    { name: 'level', type: 'select', options: ['page'], required: true, defaultValue: 'page' },
    { name: 'raisedAt', type: 'date', required: true, index: true },
    { name: 'acknowledgedAt', type: 'date', index: true },
  ],
};
