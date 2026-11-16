import type { ApiErrorCode } from '@time2fest/contracts';
import { ApiFailureSchema } from '@time2fest/contracts/schemas';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildDispatcher, createDeps } from '../../src/container';
import { createDispatcher, LOG_ID } from '../../src/endpoints/pipeline';
import type { Deps, RouteRow } from '../../src/endpoints/types';
import { timeRoute } from '../../src/endpoints/time';
import { middlewareRegistry } from '../../src/registries/middleware';
import type { Logger } from '../../src/ports';

const ORIGIN = 'http://allowed.test';
const BASE = 'http://server.test';
const ALLOWED_KEYS = ['code', 'reason', 'retryAfterMs', 'attemptsLeft', 'message'];

function capture(): { log: Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const push = (level: string) => (f: Record<string, unknown>) => void lines.push({ level, ...f });
  return { log: { info: push('info'), warn: push('warn'), error: push('error') }, lines };
}

function deps(log: Logger): Deps {
  return createDeps({ ...process.env, T2F_ENV: 'test', T2F_TEST_DOORS: undefined, T2F_ALLOWED_ORIGINS: ORIGIN }, { log });
}

function row(key: string, extra: Partial<RouteRow> = {}): RouteRow {
  return { key, method: 'GET', path: `/api/sample/${key}`, handler: async () => ({ ok: true, value: key }), ...extra };
}

function dispatcherWith(routes: RouteRow[], log = capture().log) {
  return createDispatcher({ routes, middleware: middlewareRegistry, deps: deps(log) });
}

const post = (path: string, body: string, origin: string | null = ORIGIN) =>
  new Request(BASE + path, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...(origin === null ? {} : { origin }) },
  });

describe('HTTP pipeline', () => {
  it('AC-22/27: every refusal is an ApiResult failure with wire fields only, no interface text', async () => {
    const dispatch = dispatcherWith([
      row('junk', {
        handler: async () =>
          ({
            ok: false,
            error: { code: 'conflict', reason: 'taken', message: 'Цей нік уже зайнято!', stack: 'at x', detail: 'secret' },
          }) as never,
      }),
      row('throws', { handler: async () => { throw new Error('boom'); } }),
      row('down', { handler: async () => { throw Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }); } }),
      row('bad', { method: 'POST', path: '/api/sample/bad', body: z.object({ a: z.number() }).strict() }),
    ]);
    const responses = await Promise.all([
      dispatch(new Request(`${BASE}/api/sample/junk`)),
      dispatch(new Request(`${BASE}/api/sample/throws`)),
      dispatch(new Request(`${BASE}/api/sample/down`)),
      dispatch(new Request(`${BASE}/api/nope`)),
      dispatch(post('/api/sample/bad', '{"a":"x"}')),
      dispatch(post('/api/sample/bad', '{"a":1}', 'http://evil.test')),
    ]);
    for (const res of responses) {
      const body = (await res.json()) as { error: Record<string, unknown> };
      expect(ApiFailureSchema.safeParse(body).success).toBe(true);
      for (const key of Object.keys(body.error)) expect(ALLOWED_KEYS).toContain(key);
      if (body.error.message !== undefined) expect(String(body.error.message)).toMatch(/^([A-Za-z0-9_.[\]]+|log_[a-z0-9]{10})$/);
    }
    const junk = (await dispatch(new Request(`${BASE}/api/sample/junk`)).then((r) => r.json())) as unknown;
    expect(junk).toEqual({ ok: false, error: { code: 'conflict', reason: 'taken' } });
  });

  it('AC-23: each error code maps to its HTTP status', async () => {
    const map: Record<ApiErrorCode, number> = {
      validation: 400,
      unauthorized: 401,
      forbidden: 403,
      not_found: 404,
      conflict: 409,
      rate_limited: 429,
      unavailable: 503,
      unknown: 500,
      network: 503,
    };
    const codes = Object.keys(map) as ApiErrorCode[];
    const dispatch = dispatcherWith(codes.map((code) => row(code, { handler: async () => ({ ok: false, error: { code } }) })));
    for (const code of codes) {
      const res = await dispatch(new Request(`${BASE}/api/sample/${code}`));
      expect(res.status, code).toBe(map[code]);
      expect(await res.json()).toEqual({ ok: false, error: { code } });
    }
  });

  it('AC-24: a schema failure → 400 validation/invalid-input with the field path; the handler does not run', async () => {
    const handler = vi.fn(async () => ({ ok: true as const, value: 1 }));
    const dispatch = dispatcherWith([
      row('bad', { method: 'POST', path: '/api/sample/bad', body: z.object({ user: z.object({ nick: z.string().max(3) }) }), handler }),
    ]);
    const res = await dispatch(post('/api/sample/bad', '{"user":{"nick":"toolong"}}'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: { code: 'validation', reason: 'invalid-input', message: 'user.nick' } });
    const malformed = await dispatch(post('/api/sample/bad', '{"user":'));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ ok: false, error: { code: 'validation', reason: 'invalid-input' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('AC-26: an unexpected throw → 500 unknown with a log id, no error text in the body, the error logged', async () => {
    const { log, lines } = capture();
    const dispatch = dispatcherWith([row('throws', { handler: async () => { throw new Error('db password leaked here'); } })], log);
    const res = await dispatch(new Request(`${BASE}/api/sample/throws`));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('leaked');
    expect(text).not.toContain('Error');
    const body = JSON.parse(text) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('unknown');
    expect(body.error.message).toMatch(LOG_ID);
    const line = lines.find((l) => l.logId === body.error.message);
    expect(line?.level).toBe('error');
    expect(String((line?.err as Error).message)).toContain('leaked');
  });

  it('AC-28: a mutating request with an absent or foreign Origin → 403 without the handler; the exempt row runs', async () => {
    const guarded = vi.fn(async () => ({ ok: true as const, value: 'g' }));
    const exempt = vi.fn(async () => ({ ok: true as const, value: 'e' }));
    const dispatch = dispatcherWith([
      row('guarded', { method: 'POST', path: '/api/sample/guarded', handler: guarded }),
      row('exempt', { method: 'POST', path: '/api/sample/exempt', sameOriginExempt: true, handler: exempt }),
    ]);
    for (const origin of [null, 'http://evil.test', 'null']) {
      const res = await dispatch(post('/api/sample/guarded', '{}', origin));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ ok: false, error: { code: 'forbidden' } });
    }
    expect(guarded).not.toHaveBeenCalled();
    expect((await dispatch(post('/api/sample/guarded', '{}'))).status).toBe(200);
    expect(guarded).toHaveBeenCalledTimes(1);
    expect((await dispatch(post('/api/sample/exempt', '{}', null))).status).toBe(200);
    expect(exempt).toHaveBeenCalledTimes(1);
  });

  it('AC-60: GraphQL, the playground and Payload collection REST are 404 under /api', async () => {
    const dispatch = await buildDispatcher(deps(capture().log));
    for (const [method, path] of [
      ['GET', '/api/graphql'],
      ['POST', '/api/graphql'],
      ['GET', '/api/graphql-playground'],
      ['GET', '/api/admins'],
      ['GET', '/api/admins/me'],
    ] as const) {
      const res = await dispatch(new Request(BASE + path, { method, headers: { origin: ORIGIN } }));
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.json()).toEqual({ ok: false, error: { code: 'not_found' } });
    }
  });

  it('AC-72: a database route whose dependency refuses the connection → 503 unavailable; /api/time stays 200', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' });
    const failingDeps: Deps = { ...deps(capture().log), payload: () => Promise.reject(refused) };
    const dispatch = createDispatcher({
      routes: [
        row('needs-db', {
          needs: ['db'],
          handler: async (ctx) => {
            await ctx.deps.payload();
            return { ok: true, value: 'unreachable' };
          },
        }),
        timeRoute,
      ],
      middleware: middlewareRegistry,
      deps: failingDeps,
    });
    const down = await dispatch(new Request(`${BASE}/api/sample/needs-db`));
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ ok: false, error: { code: 'unavailable' } });
    expect((await dispatch(new Request(`${BASE}/api/time`))).status).toBe(200);
  });
});
