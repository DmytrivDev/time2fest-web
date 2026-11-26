/**
 * Subject-data registry (AC-57, AC-62): one row per capability that stores data about a
 * subject, sorted by `capability`. Empty in SPEC-02; domain waves add their rows.
 * SPEC-10: `auth` (handler; callers run the registry through `runSubjectDataInScope`, the handler reads deps from the
 * auth scope) and `auth-codes` (declarative: a sign-in code lives 10 min).
 * SPEC-11: handlers `bans`, `passes`, `profile` (`rights/subjectData.ts`, wired to the scope in `auth/subjectData.ts`).
 * SPEC-14: handler `stamps` (`presence/subjectData.ts`, same scope wiring) and declarative `presence-beats` (Redis beat
 * keys, TTL 48 h, `presence/intake.ts` `PRESENCE_KEY_TTL_MS`).
 */
import { rightsDbOf } from '../auth/pool';
import { requireSubjectDataDeps } from '../auth/scope';
import { authSubjectData, rightsSubjectData } from '../auth/subjectData';
import { createPresenceSubjectData } from '../presence/subjectData';
import { assertRegistry } from '../platform/registry';
import type { SubjectDataRow } from '../platform/subjectData';

export const subjectDataRegistry: readonly SubjectDataRow[] = [
  authSubjectData,
  {
    capability: 'auth-codes',
    declarative: true,
    retention: '10 min',
    description:
      'Pending sign-in code of an email address (Better Auth verification row `sign-in-otp-<email>`, hashed code): removed on use, after 5 wrong tries, on expiry (10 min) and by the `auth` erase.',
  },
  rightsSubjectData.bans,
  {
    capability: 'ip-day-fingerprint',
    declarative: true,
    retention: '<= 24 h',
    description:
      'Daily IP fingerprint: rate-limit key only, no handler. Pseudonymous, not anonymous (a keyed hash of the address with a daily salt); IPv6 is counted per /64; all per-IP counters reset at UTC midnight.',
  },
  rightsSubjectData.passes,
  {
    capability: 'presence-beats',
    declarative: true,
    retention: '<= 48 h',
    description:
      'Presence beat keys in Redis (`pr:` prefix: per subject, event and moment, plus per-window intake counters): written by `POST /api/presence`, TTL 48 h, no handler. The lasting proof is the `stamps` handler.',
  },
  rightsSubjectData.profile,
  createPresenceSubjectData(() => rightsDbOf(requireSubjectDataDeps())),
];

assertRegistry('subject-data', subjectDataRegistry, (h) => h.capability);
