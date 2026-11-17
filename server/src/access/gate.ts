/**
 * The Access gate (ring 3): verifies the JWT, classifies it, decides, and on a pass returns the
 * identity to mark on the request. Decision only — no Next, no jose (AC-1, AC-4, AC-6, NFR-8).
 * Fail closed: without config every gated path is 403.
 */
import { classify, decide, isPublicApiPath, type DenyReason, type GateAuth } from '../domain/access/classify';
import type { AccessConfig } from '../domain/access/config';
import type { Clock, Logger } from '../ports';
import type { AccessIdentity, AccessVerifier, DenyLog } from './ports';

export interface GateRequest {
  path: string;
  host: string;
  /** Value of `Cf-Access-Jwt-Assertion`, if any. */
  token: string | null;
}

export type GateResult =
  | { kind: 'pass'; identity: AccessIdentity | undefined }
  | { kind: 'deny403'; reason: DenyReason }
  | { kind: 'notFound404' };

export interface AccessGate {
  check(req: GateRequest): Promise<GateResult>;
}

export function createAccessGate(deps: { config: AccessConfig | undefined; verifier: AccessVerifier; denyLog: DenyLog }): AccessGate {
  const { config, verifier, denyLog } = deps;
  return {
    async check(req) {
      if (isPublicApiPath(req.path)) return { kind: 'pass', identity: undefined };
      let auth: GateAuth = { ok: false, reason: 'no-config' };
      let identity: AccessIdentity | undefined;
      if (config) {
        const v = await verifier.verify(req.token);
        if (v.ok) {
          const kind = classify(v.claims, config);
          auth = { ok: true, kind };
          identity =
            kind === 'person-owner'
              ? { kind: 'person', subject: (v.claims.email ?? '').toLowerCase(), exp: v.claims.exp }
              : { kind: 'service', subject: v.claims.common_name ?? '', exp: v.claims.exp };
        } else {
          auth = { ok: false, reason: v.reason };
        }
      }
      const d = decide({ path: req.path, host: req.host, adminHost: config?.adminHost, auth });
      if (d.kind === 'deny403') {
        denyLog.deny(d.reason);
        return d;
      }
      if (d.kind === 'notFound404') return d;
      return { kind: 'pass', identity };
    },
  };
}

/**
 * `{ event: 'access-deny', reason }` at most once per `intervalMs` per reason (NFR-8).
 * Never carries the token or the email.
 */
export function createDenyLog(log: Logger, clock: Clock, intervalMs = 1000): DenyLog {
  const last = new Map<DenyReason, number>();
  return {
    deny(reason) {
      const t = clock.now();
      const prev = last.get(reason);
      if (prev !== undefined && t - prev < intervalMs) return;
      last.set(reason, t);
      log.warn({ event: 'access-deny', reason });
    },
  };
}
