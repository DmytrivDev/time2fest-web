/**
 * Issuing a connection token (ring 3, C1; AC-12, AC-13, AC-14, AC-18, AC-19). Fails closed: a subject id
 * outside `SUBJECT_ID` gets `unknown` and is never signed; without a signer (only possible in the `test`
 * class) the answer is `unavailable` / `realtime-not-configured`. The token itself is never logged.
 */
import { fail, ok, type ApiResult, type RealtimeReason, type RealtimeTokenValue } from '@time2fest/contracts';
import { SUBJECT_ID } from '../domain/realtime/channels';
import { expiresAtIso, tokenTimes } from '../domain/realtime/token';
import type { Clock } from '../ports';
import type { RandomSource, SubjectResolver, TokenSigner } from './ports';

const NOT_CONFIGURED: RealtimeReason = 'realtime-not-configured';

export interface IssueTokenDeps {
  resolver: SubjectResolver;
  /** Absent without `T2F_CENTRIFUGO_TOKEN_SECRET` (AC-19). */
  signer?: TokenSigner;
  clock: Clock;
  random: RandomSource;
}

/**
 * The C1 value for the subject of `req`: both `null` without a subject.
 * `ttlSeconds` replaces the spread lifetime — for the test door only (AC-58); production callers never pass it.
 */
export async function issueRealtimeToken(
  deps: IssueTokenDeps,
  req: Request,
  ttlSeconds?: number,
): Promise<ApiResult<RealtimeTokenValue>> {
  if (deps.signer === undefined) return fail('unavailable', { reason: NOT_CONFIGURED });
  const subject = await deps.resolver.resolve(req);
  if (subject === null) return ok({ token: null, expiresAt: null });
  if (!SUBJECT_ID.test(subject.id)) return fail('unknown');
  const { iat, exp } = tokenTimes(deps.clock.now(), deps.random(), ttlSeconds);
  const token = await deps.signer.sign({ sub: subject.id, iat, exp });
  return ok({ token, expiresAt: expiresAtIso(exp) });
}
