/**
 * Integration build = mixed (FR-MIG-01, orchestrator decision B3): in test + http a domain with an http adapter uses it,
 * any other keeps sim; production http has no sim and the guard still shows BackendDown. Time: the client time machine
 * and `window.__t2f` work in test + http exactly as in the sim test build.
 */
import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiGuard } from '@/lib/api/ApiGuard';
import { describeIntegrationSplit, domainServer, splitDomains } from '@/lib/api/domains';
import { HTTP_DOMAINS } from '@/lib/api/http/domains';
import { httpFactories } from '@/lib/api/http';
import { apiDomains, domainSource, faultControls, MIGRATED_DOMAINS, missingDomains } from '@/lib/api/services';
import messages from '@/messages/uk.json';

/** In `MIGRATED_DOMAINS` order: `live` over http since SPEC-12 (W41). */
const HTTP_NOW = ['live', 'catalog', 'site'];
const SIM_REST = MIGRATED_DOMAINS.filter((d) => !HTTP_NOW.includes(d));

describe('who serves a domain — three build kinds', () => {
  it('test + sim (test and demo build): everything from sim, nothing missing', () => {
    expect(apiDomains('sim', true)).toEqual({ http: [], sim: [...MIGRATED_DOMAINS], missing: [] });
    expect(faultControls('sim', true)).toBeDefined();
  });

  it('test + http (integration): catalog over http, the rest derived to sim, nothing missing', () => {
    expect(apiDomains('http', true)).toEqual({ http: HTTP_NOW, sim: SIM_REST, missing: [] });
    expect(domainSource('catalog', 'http', true)).toBe('http');
    expect(domainSource('live', 'http', true)).toBe('http');
    expect(domainSource('chat', 'http', true)).toBe('sim');
    expect(domainSource('site', 'http', true)).toBe('http');
    expect(missingDomains('http', true)).toEqual([]);
    expect(faultControls('http', true)).toBeDefined();
  });

  it('production + http: no sim at all — the rest is missing, fault controls absent', () => {
    expect(apiDomains('http', false)).toEqual({ http: HTTP_NOW, sim: [], missing: SIM_REST });
    expect(domainSource('chat', 'http', false)).toBeNull();
    expect(faultControls('http', false)).toBeUndefined();
  });

  it('the http list is the keys of httpFactories, and the build-time line matches the runtime split', () => {
    expect(Object.keys(httpFactories).sort()).toEqual([...HTTP_DOMAINS].sort());
    const http: readonly string[] = HTTP_DOMAINS;
    const atBuild = splitDomains({ mode: 'http', testBuild: true, hasHttp: (d) => http.includes(d), hasSim: () => true });
    expect(atBuild).toEqual(apiDomains('http', true));
    expect(describeIntegrationSplit(atBuild)).toBe(`[api] integration build: http = ${HTTP_NOW.join(', ')}; sim = ${SIM_REST.join(', ')}`);
  });

  it('the rule itself: sim mode never uses http; a production build never falls back to sim', () => {
    const all = { hasHttp: () => true, hasSim: () => true };
    expect(domainServer('catalog', { mode: 'sim', testBuild: false, ...all })).toBe('sim');
    expect(domainServer('live', { mode: 'http', testBuild: false, hasHttp: () => false, hasSim: () => true })).toBeNull();
    expect(domainServer('live', { mode: 'http', testBuild: true, hasHttp: () => false, hasSim: () => false })).toBeNull();
  });
});

describe('ApiGuard in the three build kinds', () => {
  afterEach(() => vi.restoreAllMocks());
  const wrap = (ui: React.ReactNode) =>
    render(
      <NextIntlClientProvider locale="uk" messages={messages}>
        {ui}
      </NextIntlClientProvider>,
    );

  it('test + http: the site renders (no BackendDown)', () => {
    wrap(
      <ApiGuard mode="http" testBuild>
        <p>сайт</p>
      </ApiGuard>,
    );
    expect(screen.getByText('сайт')).toBeTruthy();
    expect(document.querySelector('[data-api-unavailable]')).toBeNull();
  });

  it('production + http: BackendDown, as before', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    wrap(
      <ApiGuard mode="http" testBuild={false}>
        <p>сайт</p>
      </ApiGuard>,
    );
    expect(screen.queryByText('сайт')).toBeNull();
    expect(document.querySelector('main#main [data-backend-down]')).not.toBeNull();
  });
});

describe('integration build at runtime (NEXT_PUBLIC_ENV=test, NEXT_PUBLIC_API_MODE=http)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock('@/lib/env');
    window.history.replaceState(null, '', '/');
    sessionStorage.clear();
  });

  async function loadIntegration() {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_MODE', 'http');
    vi.doMock('@/lib/env', () => ({ IS_TEST_BUILD: true, IS_DEMO_BUILD: false }));
    const services = await import('@/lib/api/services');
    const { TimeProvider } = await import('@/lib/time/TimeProvider');
    return { services, TimeProvider };
  }

  it('getService: catalog from http, the others from sim (no «ще не перенесено» error)', async () => {
    const { services } = await loadIntegration();
    expect(services.domainSource('catalog')).toBe('http');
    for (const d of SIM_REST) expect(() => services.getService(d), d).not.toThrow();
    expect(services.missingDomains()).toEqual([]);
  });

  it('time machine: ?t=&speed= drive the page and window.__t2f.timeMachine is installed (as in the sim test build)', async () => {
    window.history.replaceState(null, '', '/?t=2027-01-01T01:59:00%2B02:00&speed=0');
    const { TimeProvider } = await loadIntegration();
    const view = render(
      <TimeProvider>
        <p>x</p>
      </TimeProvider>,
    );
    const api = window.__t2f!;
    expect(api.timeMachine.get()).toEqual({ at: '2026-12-31T23:59:00.000Z', speed: 0, source: 'machine' });
    act(() => api.timeMachine.set({ at: '2027-01-01T00:30:00+02:00' }));
    expect(api.timeMachine.get().at).toBe('2026-12-31T22:30:00.000Z');
    expect(api.apiDomains).toEqual({ http: HTTP_NOW, sim: SIM_REST, missing: [] });
    view.unmount();
    expect(window.__t2f).toBeUndefined();
  });
});
