/**
 * Test doors of the server clock (SPEC-07, class `test`; loopback only) for the integration-build e2e.
 * Needs `T2F_E2E_SERVER=http://127.0.0.1:<server port>`; without it the specs that import this skip themselves.
 */
import type { APIRequestContext } from '@playwright/test';

export const SERVER = process.env.T2F_E2E_SERVER;
export const SKIP_REASON = 'T2F_E2E_SERVER (http://127.0.0.1:<server port>) is not set: the clock doors are loopback-only';

export interface DoorClock {
  now: number;
  speed: number;
  frozen: boolean;
}
export interface NightRecord {
  keys: string[];
  action: string;
  plannedAt: number;
  startedAt: number;
  consequenceId: string;
}

async function door<T>(api: APIRequestContext, method: 'get' | 'post', path: string, data?: unknown): Promise<T> {
  const res = await api[method](`${SERVER}${path}`, data === undefined ? undefined : { data });
  if (!res.ok()) throw new Error(`${method.toUpperCase()} ${path} -> ${res.status()} ${await res.text()}`);
  const body = (await res.json()) as { ok: boolean; value: T };
  return body.value;
}

export const getDoorClock = (api: APIRequestContext) => door<DoorClock>(api, 'get', '/api/_test/clock');
export const setDoorClock = (api: APIRequestContext, body: { at?: number; speed?: number; frozen?: boolean }) =>
  door<DoorClock>(api, 'post', '/api/_test/clock', body);
export const startNightRun = (api: APIRequestContext, body: { speed?: number; from?: number; to?: number }) =>
  door<{ epoch: number }>(api, 'post', '/api/_test/scheduler/night-run', body);
export const getNightRun = (api: APIRequestContext) =>
  door<{ epoch: number; records: NightRecord[] }>(api, 'get', '/api/_test/scheduler/night-run');
/** About 15 s: also clears faults, resumes the scheduler and puts the clock back to real time. */
export const resetServer = (api: APIRequestContext) => door<unknown>(api, 'post', '/api/_test/reset');
