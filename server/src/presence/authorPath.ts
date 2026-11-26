/**
 * The author-path service (SPEC-14 [А14]; AC-49 … AC-53, EC-14, EC-15), application ring. Reads: the subject behind the
 * author id, the author's device and kind (`users`), the pass (`passes.view`: an account by its id, a guest by the device
 * it was created on, an account also by its device pass as the author sees it), `showPath` (`settingsOf` over the stored
 * settings, default on), the schedule (`profiles.schedule`), `bans.isBlocked`, the author's stamps of the current season
 * and the catalog's effective moments. Pure rules: `domain/passport/authorPath.ts`. An unknown author id → `null`
 * (`not_found`). Nothing is logged (NFR-5).
 */
import type { AuthorPathResponse } from '@time2fest/contracts';
import { authorPathOf } from '../domain/passport/authorPath';
import { settingsOf } from '../domain/rights/settings';
import type { BanService } from '../rights/bans';
import type { PassService } from '../rights/passes';
import type { RightsDb } from '../rights/ports';
import type { AuthorIds } from './authorIds';
import type { PresenceCatalogView } from './beats';

export interface AuthorPathDeps {
  db(): Promise<RightsDb>;
  authorIds: AuthorIds;
  passes: Pick<PassService, 'view'>;
  bans: Pick<BanService, 'isBlocked'>;
  catalog(now: number): Promise<PresenceCatalogView>;
  /** The author's stamps of the current season (the passport list). */
  stampedEventIds(subjectId: string, now: number): Promise<string[]>;
}

export interface AuthorPathService {
  /** `null` when no author has this id. `viewer` = the request's subject, if any. */
  pathOf(input: { authorId: string; viewer: string | undefined; now: number }): Promise<AuthorPathResponse | null>;
}

export function createAuthorPathService(deps: AuthorPathDeps): AuthorPathService {
  return {
    async pathOf({ authorId, viewer, now }) {
      const author = await deps.authorIds.subjectOfAuthor(authorId);
      if (author === null) return null;
      const own = viewer !== undefined && viewer === author;
      const db = await deps.db();
      const user = (await db.query<{ is_anonymous: boolean | null; device_id: string | null }>('SELECT is_anonymous, device_id FROM users WHERE id::text = $1', [author])).rows[0];
      const guest = user?.is_anonymous === true;
      const device = user?.device_id ?? null;
      const profile = (await db.query<{ settings: unknown; schedule: string[] }>('SELECT settings, schedule FROM profiles WHERE subject_id = $1', [author])).rows[0];
      const stamped = await deps.stampedEventIds(author, now);
      const events = (await deps.catalog(now)).catalog.events;
      const scheduled = (profile?.schedule ?? []).flatMap((id) => {
        const e = events.get(id);
        return e === undefined ? [] : [{ eventId: e.eventId, momentMs: e.momentMs }];
      });
      if (own) return authorPathOf({ own: true, blocked: false, hasPass: true, showPath: true, stampedEventIds: stamped, scheduled, now });
      const blocked = (await deps.bans.isBlocked(author, { device, subjectKind: guest ? 'guest' : 'account' })).blocked;
      const hasPass = (await deps.passes.view({ accountId: guest ? null : author, device: device ?? '' })).hasPass;
      return authorPathOf({ own: false, blocked, hasPass, showPath: settingsOf(profile?.settings).showPath, stampedEventIds: stamped, scheduled, now });
    },
  };
}
