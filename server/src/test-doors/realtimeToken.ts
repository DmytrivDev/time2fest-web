/**
 * `POST /api/_test/realtime-token` (SPEC-06 AC-57, AC-58): a Centrifugo connection token for the given
 * subject, issued by the same use case and signer as `GET /api/realtime/token`, and that subject remembered
 * as the current test subject, so the endpoint issues tokens for it until `POST /api/_test/reset` forgets it.
 * Part of the doors module, so it is loaded only through the dynamic doors `import()`.
 *
 * EC-16: the current test subject is one per doors construction (one per dispatcher). Tests running in
 * parallel must use the token from this door's response, never rely on the remembered subject.
 * The token is never logged.
 */
import { type TestRealtimeTokenBody, TestRealtimeTokenBodySchema } from '@time2fest/contracts/schemas';
import { realtimeOf } from '../endpoints/deps';
import type { RealtimeSubject, SubjectResolver } from '../realtime/ports';
import { issueRealtimeToken } from '../realtime/token';
import type { DoorRow } from './registry';

/** The current test subject of one doors construction and the resolver that reads it. */
export interface TestSubjects {
  set(subject: RealtimeSubject): void;
  clear(): void;
  resolver: SubjectResolver;
}

/** A fresh test-subject state: built per doors construction, never a module-level singleton. */
export function createTestSubjects(): TestSubjects {
  let current: RealtimeSubject | null = null;
  return {
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
}

export const realtimeTokenDoor: DoorRow = {
  key: 'realtime-token',
  method: 'POST',
  path: '/api/_test/realtime-token',
  body: TestRealtimeTokenBodySchema,
  async handler(ctx, { subjects }) {
    const realtime = realtimeOf(ctx.deps);
    const { subject, ttlSeconds } = ctx.body as TestRealtimeTokenBody;
    const result = await issueRealtimeToken(
      { resolver: { resolve: async () => subject }, signer: realtime.signer, clock: ctx.clock, random: realtime.random },
      ctx.req,
      ttlSeconds,
    );
    if (result.ok) subjects.set(subject);
    return result;
  },
};
