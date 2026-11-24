/**
 * Gate rules added by the security review: CSRF on state-changing requests (S4-01), the service
 * path allow-list (S4-02), the session cookie's `Secure` (S4-04), and the foreign host answering
 * every gated path like an unknown one (AC-6, B2).
 */
import { describe, expect, it } from 'vitest';
import { crossOriginWrite, decide, servicePathAllowed, type DecideInput } from '../../src/domain/access/classify';
import { adminOrigins, sessionCookieSecure } from '../../src/domain/access/config';

const HOST = 'admin.example.com';
const ORIGINS = adminOrigins(HOST, 'production');
const owner = { ok: true, kind: 'person-owner' } as const;
const agent = { ok: true, kind: 'service-allowed' } as const;
const base: DecideInput = { path: '/cms-api/zones', host: HOST, adminHost: HOST, auth: owner, adminOrigins: ORIGINS };

describe('adminOrigins / sessionCookieSecure', () => {
  it('https only outside test; test adds http; lower-cased', () => {
    expect(adminOrigins('Admin.Example.com', 'production')).toEqual(['https://admin.example.com']);
    expect(adminOrigins(HOST, 'rehearsal')).toEqual(['https://admin.example.com']);
    expect(adminOrigins('admin.localhost:4080', 'test')).toEqual(['https://admin.localhost:4080', 'http://admin.localhost:4080']);
  });

  it('Secure in rehearsal and production, not in test (S4-04)', () => {
    expect(sessionCookieSecure('production')).toBe(true);
    expect(sessionCookieSecure('rehearsal')).toBe(true);
    expect(sessionCookieSecure('test')).toBe(false);
  });
});

describe('crossOriginWrite (S4-01)', () => {
  const w = (method: string, origin: string | null, fetchSite: string | null) => crossOriginWrite({ method, origin, fetchSite, adminOrigins: ORIGINS });

  it('reads are never refused here', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) expect(w(m, 'https://evil.example.com', 'cross-site')).toBe(false);
  });

  it('a write from another origin or site → refused', () => {
    expect(w('POST', 'https://www.example.com', null)).toBe(true);
    expect(w('POST', 'null', null)).toBe(true);
    expect(w('PATCH', 'http://admin.example.com', null)).toBe(true);
    expect(w('DELETE', null, 'same-site')).toBe(true);
    expect(w('POST', null, 'cross-site')).toBe(true);
    expect(w('POST', 'https://admin.example.com', 'same-site')).toBe(true);
  });

  it('a same-origin write and a client without either header (agent) pass', () => {
    expect(w('POST', 'https://admin.example.com', 'same-origin')).toBe(false);
    expect(w('POST', 'https://ADMIN.example.com', null)).toBe(false);
    expect(w('POST', null, 'none')).toBe(false);
    expect(w('POST', null, null)).toBe(false);
  });

  it('decide: a cross-origin owner write → 403 cross-origin', () => {
    expect(decide({ ...base, method: 'POST', origin: 'https://www.example.com' })).toEqual({ kind: 'deny403', reason: 'cross-origin' });
    expect(decide({ ...base, method: 'POST', origin: 'https://admin.example.com', fetchSite: 'same-origin' })).toEqual({ kind: 'pass' });
  });
});

describe('servicePathAllowed (S4-02)', () => {
  it('catalog reads and admins/me only; agent-test-posts only in test', () => {
    for (const p of ['/cms-api/zones', '/cms-api/zones/7', '/cms-api/seasons', '/cms-api/traditions', '/cms-api/admins/me']) {
      expect(servicePathAllowed(p, 'GET', false), p).toBe(true);
    }
    expect(servicePathAllowed('/cms-api/agent-test-posts', 'POST', true)).toBe(true);
    expect(servicePathAllowed('/cms-api/agent-test-posts', 'GET', false)).toBe(false);
  });

  it('everything else is refused', () => {
    for (const p of [
      '/cms-api/payload-locked-documents',
      '/cms-api/payload-preferences',
      '/cms-api/payload-migrations',
      '/cms-api/admins',
      '/cms-api/admins/1',
      '/cms-api/admins/unlock',
      '/cms-api/admins/forgot-password',
      '/cms-api/globals/admin-settings',
      '/cms-api/audit-log',
      '/cms-api/zones-extra',
      '/admin',
    ]) {
      expect(servicePathAllowed(p, 'GET', true), p).toBe(false);
    }
    expect(servicePathAllowed('/cms-api/zones', 'POST', true)).toBe(false);
    expect(servicePathAllowed('/cms-api/admins/me', 'POST', true)).toBe(false);
  });

  it('SPEC-21a AC-32, AC-33: exactly the three stream-agent addresses', () => {
    expect(servicePathAllowed('/cms-api/stream-agent/channels', 'GET', false)).toBe(true);
    expect(servicePathAllowed('/cms-api/stream-agent/candidates', 'GET', false)).toBe(true);
    expect(servicePathAllowed('/cms-api/stream-agent/candidates', 'POST', false)).toBe(true);
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      expect(servicePathAllowed('/cms-api/stream-agent/channels', m, true), m).toBe(false);
    }
    for (const m of ['PATCH', 'DELETE', 'PUT']) {
      expect(servicePathAllowed('/cms-api/stream-agent/candidates', m, true), m).toBe(false);
    }
    for (const p of [
      '/cms-api/stream-agent',
      '/cms-api/stream-agent/candidates/1',
      '/cms-api/stream-agent/channels/1',
      '/cms-api/stream-agent/approve',
      '/cms-api/streams/view',
      '/cms-api/streams/approve',
      '/cms-api/streams/blacklist',
      '/cms-api/live/view',
      '/cms-api/live/replace',
      '/cms-api/stream-channels',
      '/cms-api/stream-channels/1',
      '/cms-api/stream-candidates',
      '/cms-api/stream-candidates/1',
    ]) {
      for (const m of ['GET', 'POST']) expect(servicePathAllowed(p, m, true), `${m} ${p}`).toBe(false);
    }
    expect(decide({ ...base, auth: agent, method: 'POST', path: '/cms-api/stream-agent/candidates' })).toEqual({ kind: 'pass' });
    expect(decide({ ...base, auth: agent, method: 'POST', path: '/cms-api/streams/approve' })).toEqual({ kind: 'deny403', reason: 'service-path' });
  });

  it('decide: a service on a path off the list → 403 service-path', () => {
    expect(decide({ ...base, auth: agent, path: '/cms-api/payload-preferences' })).toEqual({ kind: 'deny403', reason: 'service-path' });
    expect(decide({ ...base, auth: agent, path: '/cms-api/zones' })).toEqual({ kind: 'pass' });
  });
});

describe('foreign host (AC-6)', () => {
  it('every gated path, known or not, with or without a JWT → notFound404; the public API passes', () => {
    for (const path of ['/admin', '/cms-api/admins', '/no-such-page', '/', '/_next/static/x.js']) {
      for (const auth of [owner, { ok: false, reason: 'missing' } as const]) {
        expect(decide({ ...base, path, host: 'time2fest.com', auth }), path).toEqual({ kind: 'notFound404' });
      }
    }
    expect(decide({ ...base, path: '/api/time', host: 'time2fest.com' })).toEqual({ kind: 'pass' });
  });
});
