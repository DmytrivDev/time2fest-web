/**
 * `POST /api/chat/nick-check` (SPEC-11 AC-27 … AC-29, AC-58): the verdict (SPEC-09) then uniqueness, excluding the
 * subject's own nick. The subject is the session's (a guest is created on the first call); the nick is never logged.
 */
import { nickCheckBody, type NickCheckBody } from '@time2fest/contracts/schemas';
import { rightsOf } from './deps';
import { failure } from './pipeline';
import type { RouteRow } from './types';

export const chatNickCheckRoute: RouteRow = {
  key: 'chat-nick-check',
  method: 'POST',
  path: '/api/chat/nick-check',
  needs: ['db'],
  subject: 'required',
  body: nickCheckBody,
  maxBodyBytes: 4_096,
  rateLimit: 'chat-nick-check',
  async handler(ctx) {
    if (ctx.subject === undefined) return failure('unauthorized');
    const { nick } = ctx.body as NickCheckBody;
    return rightsOf(ctx.deps).profiles.checkNick(ctx.subject, nick);
  },
};
