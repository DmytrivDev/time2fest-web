/**
 * Subject-data registry (AC-57, AC-62): one row per capability that stores data about a
 * subject, sorted by `capability`. Empty in SPEC-02; domain waves add their rows.
 * SPEC-10: `auth` (handler; callers run the registry through `runSubjectDataInScope`, the handler reads deps from the
 * auth scope) and `auth-codes` (declarative: a sign-in code lives 10 min).
 */
import { authSubjectData } from '../auth/subjectData';
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
  {
    capability: 'ip-day-fingerprint',
    declarative: true,
    retention: '<= 24 h',
    description:
      'Daily IP fingerprint: rate-limit key only, no handler. Pseudonymous, not anonymous (a keyed hash of the address with a daily salt); IPv6 is counted per /64; all per-IP counters reset at UTC midnight.',
  },
];

assertRegistry('subject-data', subjectDataRegistry, (h) => h.capability);
