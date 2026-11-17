/**
 * The audit journal over Payload (AC-20, NFR-5), Payload glue. Rows are created through the Local
 * API with the CALLER'S `req`, so the row joins the caller's transaction, and with
 * `overrideAccess`, because no role may write the journal through the API (AC-21).
 *
 * Also here, pure:
 * - `resolveActor`: the signed-in record (`req.user`, including an API-key user), else
 *   `context.t2fActor` (`'system:<name>'` or an `Actor`), else the system itself;
 * - `redactSecrets`: drops password, hash, salt, API-key and token fields before a value enters
 *   `before`/`after` (NFR-5).
 */
import type { PayloadRequest } from 'payload';
import { roleOf } from '../access/policies';
import type { Actor, Journal, JournalEntry, Tx } from './ports';

export const AUDIT_LOG = 'audit-log';
export const ACTOR_CONTEXT_KEY = 't2fActor';
/** Request context: the action kind instead of `collection.<operation>` (e.g. `key.issue`). */
export const ACTION_CONTEXT_KEY = 't2fAction';
/** Request context: the journal row id the write reverts. */
export const REVERT_OF_CONTEXT_KEY = 't2fRevertOf';

const SYSTEM: Actor = { kind: 'system', id: 'server', label: 'server' };
const SECRET_FIELDS = new Set([
  'password',
  'hash',
  'salt',
  'apiKey',
  'apiKeyIndex',
  'enableAPIKey',
  'resetPasswordToken',
  'resetPasswordExpiration',
  'sessions',
  'loginAttempts',
  'lockUntil',
  '_verificationToken',
]);
const SECRET_NAME = /secret|token|password|api[-_]?key/i;
const MAX_DEPTH = 16;

function isActor(v: unknown): v is Actor {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  return (a.kind === 'owner' || a.kind === 'agent' || a.kind === 'system') && typeof a.id === 'string' && typeof a.label === 'string';
}

export function resolveActor(user: unknown, context: Record<string, unknown> | undefined): Actor {
  if (typeof user === 'object' && user !== null && 'id' in user) {
    const u = user as { id: unknown; email?: unknown };
    const label = typeof u.email === 'string' ? u.email : String(u.id);
    return { kind: roleOf(user) === 'owner' ? 'owner' : 'agent', id: String(u.id), label };
  }
  const given = context?.[ACTOR_CONTEXT_KEY];
  if (typeof given === 'string' && /^system:[\w.-]{1,64}$/.test(given)) {
    const name = given.slice('system:'.length);
    return { kind: 'system', id: name, label: name };
  }
  return isActor(given) ? given : SYSTEM;
}

function strip(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return '[depth]';
  if (Array.isArray(value)) return value.map((v) => strip(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_FIELDS.has(k) || SECRET_NAME.test(k) || v === undefined) continue;
    out[k] = strip(v, depth + 1);
  }
  return out;
}

/** A JSON-safe copy of a document without secret fields, or `null`. */
export function redactSecrets(doc: unknown): Record<string, unknown> | null {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null;
  return strip(doc, 0) as Record<string, unknown>;
}

export function createPayloadJournal(isRevertible: (action: string) => boolean): Journal {
  return {
    async append(tx: Tx, entry: JournalEntry) {
      const req = tx as PayloadRequest;
      await req.payload.create({
        collection: AUDIT_LOG,
        req,
        overrideAccess: true,
        depth: 0,
        data: {
          actor: { kind: entry.actor.kind, ref: entry.actor.id, label: entry.actor.label },
          action: entry.action,
          target: { collection: entry.target.collection, ref: entry.target.id },
          at: new Date(entry.at).toISOString(),
          before: entry.before,
          after: entry.after,
          revertOf: entry.revertOf,
          revertible: isRevertible(entry.action),
        },
      });
    },
  };
}
