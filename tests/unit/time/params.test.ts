import { afterEach, describe, expect, it, vi } from 'vitest';

/** SPEC-07: вибір джерела часу за класом збірки (AC-58, AC-59, AC-60, AC-62, AC-63). */
const STATE = { now: Date.parse('2026-12-31T22:59:00Z'), speed: 1, frozen: false };

function stubFetch() {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as { at?: number; speed?: number }) : {};
    const value = { ...STATE, ...(body.at !== undefined ? { now: body.at } : {}), ...(body.speed !== undefined ? { speed: body.speed } : {}) };
    return new Response(JSON.stringify({ ok: true, value }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function load(env: { mode: 'sim' | 'http'; siteClass?: string }, search: string) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_ENV', 'test');
  vi.stubEnv('NEXT_PUBLIC_API_MODE', env.mode);
  vi.stubEnv('NEXT_PUBLIC_SITE_CLASS', env.siteClass ?? '');
  window.history.replaceState(null, '', `/${search}`);
  const params = await import('@/lib/time/params');
  return params.createAppTimeSource();
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const posts = (f: ReturnType<typeof stubFetch>) => f.mock.calls.filter((c) => c[1]?.method === 'POST');

describe('createAppTimeSource за класом збірки', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
    window.history.replaceState(null, '', '/');
    sessionStorage.clear();
  });

  it('AC-62: недійсний t — попередження [time-machine] і жодного POST (лише стан дверцят)', async () => {
    const fetch = stubFetch();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = await load({ mode: 'http' }, '?t=завтра');
    const off = app.activate();
    await settle();
    expect(warn).toHaveBeenCalledWith('[time-machine] Невірний t');
    expect(posts(fetch)).toHaveLength(0);
    expect(fetch).toHaveBeenCalledWith('/api/_test/clock', expect.anything());
    off();
  });

  it('AC-62: недійсний speed — попередження і жодного POST, навіть із дійсним t', async () => {
    const fetch = stubFetch();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = await load({ mode: 'http' }, '?t=2026-12-31T23:59:30Z&speed=9000');
    const off = app.activate();
    await settle();
    expect(warn).toHaveBeenCalledWith('[time-machine] Невірний speed');
    expect(posts(fetch)).toHaveLength(0);
    off();
  });

  it('AC-60: дійсні t і speed — машина на сервері, один POST, параметри зникають з адреси', async () => {
    const fetch = stubFetch();
    const app = await load({ mode: 'http' }, '?t=2026-12-31T23:59:30Z&speed=10&panel=1');
    expect(app.machine?.status).toBe('machine');
    expect(app.source).toBe(app.machine);
    const off = app.activate();
    await settle();
    expect(posts(fetch)).toHaveLength(1);
    expect(JSON.parse(String(posts(fetch)[0]![1]!.body))).toEqual({ at: Date.parse('2026-12-31T23:59:30Z'), speed: 10, frozen: false });
    expect(window.location.search).toBe('?panel=1');
    expect(app.machine!.speed).toBe(10);
    off();
  });

  it('AC-59: без t — стан із GET дверцят, не зі sessionStorage', async () => {
    const fetch = stubFetch();
    sessionStorage.setItem('t2f:session:timeMachine', JSON.stringify({ at: 1, speed: 5, savedAtMs: Date.now() }));
    const app = await load({ mode: 'http' }, '');
    expect(app.source.ready).toBe(false);
    const off = app.activate();
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(posts(fetch)).toHaveLength(0);
    expect(app.source.ready).toBe(true);
    expect(Math.abs(app.source.now() - STATE.now)).toBeLessThan(1_000);
    expect(app.source.speed).toBe(1);
    off();
  });

  it('AC-58: репетиція (test + http, клас rehearsal) — серверний TimeSource, без машини й без /api/_test', async () => {
    const fetch = stubFetch();
    const app = await load({ mode: 'http', siteClass: 'rehearsal' }, '?t=2026-12-31T23:59:30Z');
    expect(app.machine).toBeNull();
    expect(app.source.status).not.toBe('machine');
    expect(fetch.mock.calls.some((c) => String(c[0]).includes('/api/_test/'))).toBe(false);
  });

  it('AC-63: sim — локальна TimeMachine з параметра t, без мережі, зі збереженням у sessionStorage', async () => {
    const fetch = stubFetch();
    const app = await load({ mode: 'sim' }, '?t=2026-12-31T23:59:30Z&speed=0');
    const { TimeMachine } = await import('@/lib/time/timeMachine');
    expect(app.machine).toBeInstanceOf(TimeMachine);
    expect(app.source.now()).toBe(Date.parse('2026-12-31T23:59:30Z'));
    const off = app.activate();
    expect(fetch).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('t2f:session:timeMachine')).toContain(String(Date.parse('2026-12-31T23:59:30Z')));
    off();
  });
});
