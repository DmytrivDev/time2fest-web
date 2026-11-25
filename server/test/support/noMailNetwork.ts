/**
 * SPEC-10 AC-55, NFR-6: no integration test may send mail to, or sign in through, a live service. `net.connect`,
 * `net.createConnection` and `tls.connect` throw for the mail submission ports (25, 465, 587, 2465, 2587) on a
 * host that is not loopback; `fetch` and `node:http(s).request` / `.get` throw for Google's OAuth hosts and the
 * mail providers' API hosts. Mailpit (127.0.0.1:1025/1026), the in-process fake SMTP (port 0), the fake SMTP on
 * 127.0.0.1:2525 and the fake OIDC (127.0.0.1:8091) are untouched. Loaded by `setupFiles` of the integration
 * config beside `noTelegramNetwork.ts`. Errors name the host only, never an address of a person.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const MAIL_PORTS = new Set([25, 465, 587, 2465, 2587]);
const BLOCKED_HOSTS = [/^accounts\.google\.com\.?$/i, /^oauth2\.googleapis\.com\.?$/i, /(^|\.)resend\.com\.?$/i, /(^|\.)cloudflare\.net\.?$/i];
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?|\[?::ffff:127(\.\d{1,3}){3}\]?)$/i;

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
    /* an unparsable target is not a blocked host */
  }
  return '';
}

function refuseWeb(input: unknown): void {
  const host = hostOf(input);
  if (BLOCKED_HOSTS.some((re) => re.test(host))) throw new Error(`test network guard: requests to ${host} are forbidden`);
}

/** `net.connect(port, host)`, `net.connect({port, host})`, `net.connect(path)`: the port and host of the call. */
function targetOf(args: unknown[]): { port: number; host: string } | undefined {
  const [a, b] = args;
  if (a && typeof a === 'object') {
    const o = a as { port?: unknown; host?: unknown };
    const port = Number(o.port);
    return Number.isFinite(port) ? { port, host: typeof o.host === 'string' ? o.host : 'localhost' } : undefined;
  }
  const port = Number(a);
  if (!Number.isFinite(port)) return undefined;
  return { port, host: typeof b === 'string' ? b : 'localhost' };
}

function refuseMail(args: unknown[]): void {
  const t = targetOf(args);
  if (t && MAIL_PORTS.has(t.port) && !LOOPBACK.test(t.host)) {
    throw new Error(`test network guard: mail submission to ${t.host}:${t.port} is forbidden`);
  }
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  refuseWeb(input);
  return realFetch(input, init);
}) as typeof fetch;

for (const mod of [http, https]) {
  const realRequest = mod.request;
  const realGet = mod.get;
  (mod as { request: unknown }).request = (...args: unknown[]) => {
    refuseWeb(args[0]);
    return (realRequest as (...a: unknown[]) => unknown)(...args);
  };
  (mod as { get: unknown }).get = (...args: unknown[]) => {
    refuseWeb(args[0]);
    return (realGet as (...a: unknown[]) => unknown)(...args);
  };
}

for (const name of ['connect', 'createConnection'] as const) {
  const real = net[name] as (...a: unknown[]) => unknown;
  (net as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
    refuseMail(args);
    return real(...args);
  };
}
{
  const real = tls.connect as (...a: unknown[]) => unknown;
  (tls as unknown as { connect: unknown }).connect = (...args: unknown[]) => {
    refuseMail(args);
    return real(...args);
  };
}
