/**
 * `POST /api/_test/realtime-token` (SPEC-06 AC-57, AC-58): a Centrifugo connection token for the given
 * subject, signed by the same signer as `GET /api/realtime/token`, and that subject remembered as the
 * current test subject, so the endpoint issues tokens for it until `POST /api/_test/reset` forgets it.
 * Part of the doors module, so it is loaded only through the dynamic doors `import()`.
 *
 * EC-16: the current test subject is one per process. Tests running in parallel must use the token
 * from this door's response, never rely on the remembered subject. The token is never logged.
 */
import { type TestRealtimeTokenBody, TestRealtimeTokenBodySchema } from '@time2fest/contracts/schemas';
import type { RealtimeReason } from '@time2fest/contracts';
import { expiresAtIso, tokenTimes } from '../domain/realtime/token';
import { realtimeOf } from '../endpoints/deps';
import { failure } from '../endpoints/pipeline';
import type { RealtimeSubject, SubjectResolver } from '../realtime/ports';
import type { DoorRow } from './registry';

const NOT_CONFIGURED: RealtimeReason = 'realtime-not-configured';

let current: RealtimeSubject | null = null;

/** The process-wide current test subject and the resolver that reads it. */
export const testSubjects: {
  set(subject: RealtimeSubject): void;
  clear(): void;
  resolver: SubjectResolver;
} = {
  set(subject) {
    current = { kind: subject.kind, id: subject.id };
  },
  clear() {
    current = null;
  },
  resolver: {
    async resolve() {
      return current;
    },
  },
};

export const realtimeTokenDoor: DoorRow = {
  key: 'realtime-token',
  method: 'POST',
  path: '/api/_test/realtime-token',
  body: TestRealtimeTokenBodySchema,
  async handler(ctx) {
    const realtime = realtimeOf(ctx.deps);
    if (realtime.signer === undefined) return failure('unavailable', { reason: NOT_CONFIGURED });
    const { subject, ttlSeconds } = ctx.body as TestRealtimeTokenBody;
    const { iat, exp } = tokenTimes(ctx.clock.now(), realtime.random(), ttlSeconds);
    const token = await realtime.signer.sign({ sub: subject.id, iat, exp });
    testSubjects.set(subject);
    return { ok: true, value: { token, expiresAt: expiresAtIso(exp) } };
  },
};
