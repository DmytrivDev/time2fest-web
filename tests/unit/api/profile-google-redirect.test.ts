/** S11-12: the client follows the Google link redirect only to Google (or, on a loopback page, to the local fake OIDC). */
import { describe, expect, it } from 'vitest';
import { createHttpProfile, googleRedirectAllowed } from '@/lib/api/http/profile';

describe('googleRedirectAllowed', () => {
  it('accepts https Google and refuses other schemes and hosts', () => {
    expect(googleRedirectAllowed('https://accounts.google.com/o/oauth2/v2/auth?x=1', 'time2fest.com')).toBe(true);
    expect(googleRedirectAllowed('http://accounts.google.com/o/oauth2/v2/auth', 'time2fest.com')).toBe(false);
    expect(googleRedirectAllowed('javascript:alert(1)', 'time2fest.com')).toBe(false);
    expect(googleRedirectAllowed('https://evil.example/auth', 'time2fest.com')).toBe(false);
    expect(googleRedirectAllowed('https://accounts.google.com.evil.example/', 'time2fest.com')).toBe(false);
    expect(googleRedirectAllowed('not a url', 'time2fest.com')).toBe(false);
  });

  it('a loopback fake OIDC only from a loopback page (or outside a browser)', () => {
    expect(googleRedirectAllowed('http://127.0.0.1:4599/authorize', 'time2fest.com')).toBe(false);
    expect(googleRedirectAllowed('http://127.0.0.1:4599/authorize', '127.0.0.1')).toBe(true);
    expect(googleRedirectAllowed('http://localhost:4599/authorize', 'localhost')).toBe(true);
    expect(googleRedirectAllowed('http://127.0.0.1:4599/authorize', undefined)).toBe(true);
    expect(googleRedirectAllowed('file:///etc/passwd', '127.0.0.1')).toBe(false);
  });

  it('linkGoogle does not navigate to a refused address', async () => {
    const navigated: string[] = [];
    const svc = createHttpProfile({
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, value: { kind: 'redirect', url: 'javascript:alert(1)' } }) }) as never,
      navigate: (u) => navigated.push(u),
      currentPath: () => '/account',
    });
    const r = await svc.linkGoogle();
    expect(r).toMatchObject({ ok: false, error: { code: 'unavailable', message: 'unexpected google redirect' } });
    expect(navigated).toEqual([]);
  });
});
