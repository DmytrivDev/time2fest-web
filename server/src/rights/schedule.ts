/**
 * "My schedule" on the server (SPEC-11 W24; AC-35, AC-38 … AC-42, NFR-4): `set`, `toggle`, `replace` for the subject of
 * the session. Each: a pass (account or device) else `forbidden` (AC-41); ids known and not hidden else
 * `validation/invalid-input`, at most 512 (AC-42, NFR-4); then ONE transaction — the profile row is inserted if absent
 * and locked `FOR UPDATE`, the shared rule (`@time2fest/rules/schedule`) computes the next list, a full zone answers
 * `conflict/schedule-full` with no change (AC-39, AC-40); the `profile` event follows. Ids are never logged.
 */
import type { ApiError } from '@time2fest/contracts';
import {
  replaceCountryZone,
  scheduleToggleResult,
  toggleCountryZone,
  validateScheduleIds,
  ZONE_SLOT_LIMIT,
  type ScheduleCatalog,
} from '@time2fest/rules/schedule';
import { SCHEDULE_MAX_IDS } from '../domain/rights/schedule';
import type { RightsDb } from './ports';

export type ScheduleResult = { ok: true; value: string[] } | { ok: false; error: ApiError };

export interface ScheduleServiceDeps {
  db(): Promise<RightsDb>;
  hasPass(subject: string, device: string): Promise<boolean>;
  catalog(): Promise<ScheduleCatalog>;
  /** Publishes the `profile` event to the subject; never throws. */
  publish(subject: string): Promise<void>;
}

export interface ScheduleService {
  set(subject: string, device: string, ids: readonly string[]): Promise<ScheduleResult>;
  toggle(subject: string, device: string, eventId: string): Promise<ScheduleResult>;
  replace(subject: string, device: string, outIso: string, eventId: string): Promise<ScheduleResult>;
}

const refuse = (code: ApiError['code'], reason?: string): { ok: false; error: ApiError } => ({
  ok: false,
  error: reason === undefined ? { code } : { code, reason },
});
const INVALID = refuse('validation', 'invalid-input');
const FULL = refuse('conflict', 'schedule-full');

/** The countries a list holds in each zone are within the zone's slots (PUT, AC-39). */
function fits(ids: readonly string[], cat: ScheduleCatalog): boolean {
  const byId = new Map(cat.events.map((e) => [e.eventId, e]));
  const perZone = new Map<string, Set<string>>();
  for (const id of ids) {
    const e = byId.get(id);
    if (e === undefined) continue;
    let s = perZone.get(e.zoneId);
    if (s === undefined) perZone.set(e.zoneId, (s = new Set()));
    s.add(e.countryIso);
  }
  for (const [zoneId, countries] of perZone) {
    if (countries.size > Math.min(ZONE_SLOT_LIMIT, new Set(cat.zoneCountryIsos(zoneId)).size)) return false;
  }
  return true;
}

export function createScheduleService(deps: ScheduleServiceDeps): ScheduleService {
  /** `next` gets the locked current list and the catalog; `null` = refuse with the given error. */
  async function change(
    subject: string,
    device: string,
    validate: (cat: ScheduleCatalog) => boolean,
    next: (current: string[], cat: ScheduleCatalog) => string[] | ScheduleResult & { ok: false },
  ): Promise<ScheduleResult> {
    if (!(await deps.hasPass(subject, device))) return refuse('forbidden');
    const cat = await deps.catalog();
    if (!validate(cat)) return INVALID;
    const db = await deps.db();
    const result = await db.tx(async (q): Promise<ScheduleResult> => {
      await q.query(
        `INSERT INTO profiles (subject_id, settings, schedule, updated_at) VALUES ($1, '{}'::jsonb, '{}'::text[], now())
         ON CONFLICT (subject_id) DO NOTHING`,
        [subject],
      );
      const cur = await q.query<{ schedule: string[] }>('SELECT schedule FROM profiles WHERE subject_id = $1 FOR UPDATE', [subject]);
      const current = cur.rows[0]?.schedule ?? [];
      const out = next(current, cat);
      if (!Array.isArray(out)) return out;
      await q.query('UPDATE profiles SET schedule = $2::text[], updated_at = now() WHERE subject_id = $1', [subject, out]);
      return { ok: true, value: out };
    });
    if (result.ok) await deps.publish(subject);
    return result;
  }

  return {
    set: (subject, device, ids) =>
      ids.length > SCHEDULE_MAX_IDS
        ? Promise.resolve(INVALID)
        : change(subject, device, (cat) => validateScheduleIds(ids, cat), (_cur, cat) => {
            const list = [...new Set(ids)];
            return fits(list, cat) ? list : FULL;
          }),

    toggle: (subject, device, eventId) =>
      change(subject, device, (cat) => validateScheduleIds([eventId], cat), (cur, cat) =>
        scheduleToggleResult(cur, eventId, cat) === 'full' ? FULL : toggleCountryZone(cur, eventId, cat),
      ),

    replace: (subject, device, outIso, eventId) =>
      change(subject, device, (cat) => validateScheduleIds([eventId], cat), (cur, cat) => {
        const zone = cat.events.find((e) => e.eventId === eventId)?.zoneId;
        const out = new Set(cat.events.filter((e) => e.zoneId === zone && e.countryIso === outIso).map((e) => e.eventId));
        if (!cur.some((id) => out.has(id))) return INVALID;
        return replaceCountryZone(cur, outIso, eventId, cat);
      }),
  };
}
