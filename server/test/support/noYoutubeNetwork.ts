/**
 * SPEC-12 NFR-5 / AC-37: no test may reach YouTube. `fetch` and `node:http(s).request` throw for `*.googleapis.com` and
 * `*.youtube.com`; loopback fakes are untouched. Loaded by `setupFiles` of both vitest configs.
 */
import http from 'node:http';
import https from 'node:https';

const BLOCKED = /(^|\.)(googleapis\.com|youtube\.com)$/i;

function hostOf(input: unknown): string {
  try {
    if (typeof input === 'string') return new URL(input).hostname;
    if (input instanceof URL) return input.hostname;
    if (input && typeof input === 'object') {
      const o = input as { url?: unknown; hostname?: unknown; host?: unknown };
      if (typeof o.url === 'string') return new URL(o.url).hostname;
      if (typeof o.hostname === 'string') return o.hostname;
      if (typeof o.host === 'string') return o.host.split(':')[0] ?? '';
    }
  } catch {
    /* an unparsable target is not a YouTube host */
  }
  return '';
}

function refuse(input: unknown): void {
  if (BLOCKED.test(hostOf(input))) throw new Error('test network guard: requests to YouTube hosts are forbidden');
}

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  refuse(input);
  return realFetch(input, init);
}) as typeof fetch;

for (const mod of [http, https]) {
  const realRequest = mod.request;
  const realGet = mod.get;
  (mod as { request: unknown }).request = (...args: unknown[]) => {
    refuse(args[0]);
    return (realRequest as (...a: unknown[]) => unknown)(...args);
  };
  (mod as { get: unknown }).get = (...args: unknown[]) => {
    refuse(args[0]);
    return (realGet as (...a: unknown[]) => unknown)(...args);
  };
}
