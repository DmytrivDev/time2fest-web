/**
 * Production `SubjectResolver` until sign-in exists (C5, SPEC-10): there is no session, so no request has
 * a subject and `GET /api/realtime/token` answers `{ token: null, expiresAt: null }` (AC-13).
 */
import type { SubjectResolver } from '../realtime/ports';

export const noSessionSubjects: SubjectResolver = {
  async resolve() {
    return null;
  },
};
