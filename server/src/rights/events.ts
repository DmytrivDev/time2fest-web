/**
 * Pass events (SPEC-11 W13, [П-13], AC-12, AC-17): `session` with `pass-granted` / `pass-attached` / `pass-revoked`
 * to the holder — the account, or every subject with a session on the pass's device (`user_sessions.device_id`).
 * Publication goes through `publishSessionEvent` (event + `invalidateSubject`), which never throws; a failed
 * lookup of the device's subjects is logged and swallowed — a pass write never fails on an event.
 * Emails are never logged.
 */
import { randomUUID } from 'node:crypto';
import type { ProfileEvent, SessionEventReason } from '@time2fest/contracts';
import type { RightsQuery } from './ports';

/** A logger that never throws (structural: `Deps.log` fits). */
interface WarnLog {
  warn(fields: Record<string, unknown>): void;
}

/** What `publishPassEvent` needs (A3: ports, not `Deps`): the session event of one subject (never throws) and a log. */
export interface PassEventPorts {
  session(subjectId: string, reason: PassEventReason): Promise<void>;
  log: WarnLog;
}

/** What `publishProfileEvent` needs (structural: any `Deps` fits). */
export interface ProfileEventPorts {
  realtime?: { publisher?: { publish(channelClass: 'user', key: string, envelope: ProfileEvent): Promise<{ status: string }> } };
  log: WarnLog;
}

export type PassEventReason = Extract<SessionEventReason, 'pass-granted' | 'pass-attached' | 'pass-revoked'>;
export type PassEventTarget = { account: string } | { device: string };

/** Distinct subjects (account or guest ids) with a live session on `device`. */
async function subjectsOfDevice(db: RightsQuery, device: string): Promise<string[]> {
  const res = await db.query<{ id: string }>(
    'SELECT DISTINCT user_id::text AS id FROM user_sessions WHERE device_id = $1 AND expires_at > now()',
    [device],
  );
  return res.rows.map((r) => r.id);
}

/** Publishes `reason` to every subject of each target (deduplicated). Never throws. */
export async function publishPassEvent(
  ports: PassEventPorts,
  db: RightsQuery,
  targets: readonly PassEventTarget[],
  reason: PassEventReason,
): Promise<void> {
  const subjects = new Set<string>();
  for (const t of targets) {
    if ('account' in t) {
      if (t.account !== '') subjects.add(t.account);
      continue;
    }
    if (t.device === '') continue;
    try {
      for (const id of await subjectsOfDevice(db, t.device)) subjects.add(id);
    } catch {
      try {
        ports.log.warn({ event: 'pass-publish', reason, result: 'device-lookup-failed' });
      } catch {
        // A logger never throws.
      }
    }
  }
  await Promise.all([...subjects].map((id) => ports.session(id, reason)));
}

/**
 * `profile` (SPEC-11 AC-35, EC-5): to the subject's channel `user:#<id>`; the client re-reads the profile. No data in
 * the envelope; never throws (a failed publish is logged without any profile content).
 */
export async function publishProfileEvent(deps: ProfileEventPorts, subjectId: string): Promise<void> {
  const envelope: ProfileEvent = { type: 'profile', id: randomUUID(), data: {} };
  let result: string;
  try {
    result = deps.realtime?.publisher ? (await deps.realtime.publisher.publish('user', subjectId, envelope)).status : 'not-configured';
  } catch {
    result = 'unavailable';
  }
  if (result !== 'ok') {
    try {
      deps.log.warn({ event: 'profile-publish', result });
    } catch {
      // A logger never throws.
    }
  }
}
