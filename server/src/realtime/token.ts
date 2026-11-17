/**
 * Issuing a connection token (ring 3, C1; AC-12, AC-13, AC-14, AC-18). Fails closed: a subject id
 * outside `SUBJECT_ID` gets `unknown` and is never signed. The token itself is never logged.
 */
import { fail, ok, type ApiResult, type RealtimeTokenValue } from '@time2fest/contracts';
import { SUBJECT_ID } from '../domain/realtime/channels';
import { expiresAtIso, tokenTimes } from '../domain/realtime/token';
import type { Clock } from '../ports';
import type { RandomSource, SubjectResolver, TokenSigner } from './ports';

export interface IssueTokenDeps {
  resolver: SubjectResolver;
  signer: TokenSigner;
  clock: Clock;
  random: RandomSource;
}

/** The C1 value for the subject of `req`: both `null` without a subject. */
export async function issueRealtimeToken(deps: IssueTokenDeps, req: Request): Promise<ApiResult<RealtimeTokenValue>> {
  const subject = await deps.resolver.resolve(req);
  if (subject === null) return ok({ token: null, expiresAt: null });
  if (!SUBJECT_ID.test(subject.id)) return fail('unknown');
  const { iat, exp } = tokenTimes(deps.clock.now(), deps.random());
  const token = await deps.signer.sign({ sub: subject.id, iat, exp });
  return ok({ token, expiresAt: expiresAtIso(exp) });
}
