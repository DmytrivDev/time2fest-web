/**
 * `GET /api/chat/authors/:authorId/path` (SPEC-14 [А14]; AC-49 … AC-54, NFR-7): the path of a chat author for the card.
 * `authorId` is the opaque public id (never the subject id); an unknown or malformed one → `not_found`. Others see the
 * points only by the author's pass and `showPath`; the viewer's own path is always shown. Rate row `author-path`
 * (60 a minute per device, memory fallback). Not public: the pipeline answers `Cache-Control: private, no-store`.
 * No session is needed (a viewer without one is just not the author).
 */
import type { AuthorPathResponse } from '@time2fest/contracts';
import { authorPathOf } from './deps';
import { failure } from './pipeline';
import type { RouteRow } from './types';

export const chatAuthorPathRoute: RouteRow = {
  key: 'chat-author-path',
  method: 'GET',
  path: '/api/chat/authors/:authorId/path',
  needs: ['db'],
  rateLimit: 'author-path',
  async handler(ctx) {
    const authorId = ctx.params?.authorId;
    if (authorId === undefined) return failure('not_found');
    const value: AuthorPathResponse | null = await authorPathOf(ctx.deps).pathOf({ authorId, viewer: ctx.subject, now: ctx.clock.now() });
    if (value === null) return failure('not_found');
    return { ok: true, value };
  },
};
