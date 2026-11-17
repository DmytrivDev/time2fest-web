/**
 * Access configuration and the boot refusal (AC-7). Ring 1: a pure function of the raw env passed
 * in — it never reads `process.env`. Messages name variables only, never values.
 *
 * In `rehearsal`/`production` every Access setting is required and must point at Cloudflare:
 * the JWKS is `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` under the team domain,
 * never the test signer, and the team domain is not a `.invalid` test host.
 * In `test` the JWKS may also be the literal `test-signer:` or a loopback `http://127.0.0.1:<port>`
 * URL. A `test` class without Access settings is valid: there is then no config, and the gate
 * denies every gated path (fail closed).
 */
import type { EnvClass, RawEnv } from '../../platform/env';
import { parseOwnerEmails } from './ownerEmails';

export const TEST_SIGNER_JWKS = 'test-signer:';

export type JwksSource = { kind: 'test-signer' } | { kind: 'remote'; url: string };

export interface AccessConfig {
  /** `host[:port]` of the admin; `/admin*` and `/cms-api*` on any other host are 404 (AC-6). */
  adminHost: string;
  /** Expected `iss`: the team domain origin, e.g. `https://<team>.cloudflareaccess.com`. */
  issuer: string;
  /** Expected `aud`: the Access application AUD tag. */
  audience: string;
  jwks: JwksSource;
  /** Lower-cased owner emails (AC-3, Q2). */
  ownerEmails: readonly string[];
  /** Allowed service-token `common_name` values (AC-4); may be empty. */
  serviceCommonNames: readonly string[];
}

export type AccessConfigResult = { ok: true; config: AccessConfig | undefined } | { ok: false; failing: string[] };

const REQUIRED = ['T2F_ADMIN_HOST', 'T2F_ACCESS_TEAM_DOMAIN', 'T2F_ACCESS_AUD', 'T2F_ACCESS_JWKS_URL', 'T2F_OWNER_EMAILS'] as const;

const HOST_PORT = /^[a-z0-9.-]+(:\d{1,5})?$/i;

const value = (raw: RawEnv, name: string): string | undefined => {
  const v = raw[name]?.trim();
  return v === undefined || v === '' ? undefined : v;
};

function parseUrl(s: string): URL | undefined {
  try {
    return new URL(s);
  } catch {
    return undefined;
  }
}

function isLoopbackHttp(url: URL): boolean {
  return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port !== '';
}

/** Validates and assembles the Access settings for `cls`; `failing` names each variable once. */
export function parseAccessConfig(raw: RawEnv, cls: EnvClass): AccessConfigResult {
  const missing = REQUIRED.filter((name) => value(raw, name) === undefined);
  if (cls === 'test' && missing.length === REQUIRED.length) return { ok: true, config: undefined };
  const failing = new Set<string>(missing);

  const adminHost = value(raw, 'T2F_ADMIN_HOST');
  if (adminHost !== undefined && !HOST_PORT.test(adminHost)) failing.add('T2F_ADMIN_HOST');

  const teamRaw = value(raw, 'T2F_ACCESS_TEAM_DOMAIN');
  const team = teamRaw === undefined ? undefined : parseUrl(teamRaw);
  if (teamRaw !== undefined && (team === undefined || team.protocol !== 'https:' || team.origin !== teamRaw.replace(/\/+$/, ''))) {
    failing.add('T2F_ACCESS_TEAM_DOMAIN');
  }
  if (cls !== 'test' && team !== undefined && team.hostname.toLowerCase().endsWith('.invalid')) failing.add('T2F_ACCESS_TEAM_DOMAIN');

  const jwksRaw = value(raw, 'T2F_ACCESS_JWKS_URL');
  let jwks: JwksSource | undefined;
  if (jwksRaw === TEST_SIGNER_JWKS) {
    if (cls === 'test') jwks = { kind: 'test-signer' };
    else failing.add('T2F_ACCESS_JWKS_URL');
  } else if (jwksRaw !== undefined) {
    const url = parseUrl(jwksRaw);
    const cloudflare =
      url !== undefined &&
      url.protocol === 'https:' &&
      url.hostname.toLowerCase().endsWith('.cloudflareaccess.com') &&
      team !== undefined &&
      jwksRaw.startsWith(`${team.origin}/cdn-cgi/access/certs`);
    const allowed = cloudflare || (cls === 'test' && url !== undefined && (isLoopbackHttp(url) || url.protocol === 'https:'));
    if (allowed && url !== undefined) jwks = { kind: 'remote', url: url.href };
    else failing.add('T2F_ACCESS_JWKS_URL');
  }

  const owners = parseOwnerEmails(value(raw, 'T2F_OWNER_EMAILS'));
  if (!owners.ok) failing.add('T2F_OWNER_EMAILS');

  const serviceCommonNames = (value(raw, 'T2F_ACCESS_SERVICE_CNS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

  const audience = value(raw, 'T2F_ACCESS_AUD');
  if (failing.size > 0 || adminHost === undefined || team === undefined || audience === undefined || jwks === undefined || !owners.ok) {
    const order: string[] = [...REQUIRED];
    return { ok: false, failing: [...failing].sort((a, b) => order.indexOf(a) - order.indexOf(b)) };
  }
  return {
    ok: true,
    config: {
      adminHost: adminHost.toLowerCase(),
      issuer: team.origin,
      audience,
      jwks,
      ownerEmails: owners.emails,
      serviceCommonNames,
    },
  };
}
