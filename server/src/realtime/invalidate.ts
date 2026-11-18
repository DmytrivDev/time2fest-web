/**
 * `invalidateSubject` (ring 3, SPEC-06 C6: AC-35, AC-36, NFR-5): disconnects every connection of a subject
 * with code 3014, so that the client reconnects and gets its rights again. Never throws; a failure is
 * `unavailable` with exactly one `warn` line naming the subject id, never a token or a key.
 */
import type { Logger } from '../ports';
import type { CentrifugoApi, SubjectInvalidator } from './ports';

/** Disconnect code of a state invalidation (C6): a reconnecting code for the client. */
export const INVALIDATE_CODE = 3014;
export const INVALIDATE_REASON = 'state invalidated';

export interface SubjectInvalidatorOptions {
  api: CentrifugoApi;
  log: Logger;
}

export function createSubjectInvalidator({ api, log }: SubjectInvalidatorOptions): SubjectInvalidator {
  return {
    async invalidate(subjectId) {
      let result: 'ok' | 'unavailable';
      try {
        result = await api.disconnectUser(subjectId, INVALIDATE_CODE, INVALIDATE_REASON);
      } catch {
        // The adapter never throws; this keeps the promise to domain code even if one does.
        result = 'unavailable';
      }
      if (result === 'unavailable') log.warn({ event: 'realtime_invalidate', subject: subjectId, result });
      return result;
    },
  };
}
