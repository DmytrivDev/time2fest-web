/**
 * Profiles (SPEC-11 W20; AC-27 … AC-36, EC-5, EC-6): `get`, `patch`, `checkNick` for the subject of the session.
 * Order of a patch: nick verdict (`block` → the rule's reason, `review` → `forbidden`) → flag → settings → one
 * upsert in a transaction (`nick_key` unique index: `23505` → `taken`); then the `profile` event. A patch with only
 * `detectedFlag` (or nothing) is a no-op success. The nick text is never logged: neither here nor in the errors.
 */
import type { ApiError } from '@time2fest/contracts';
import type { ProfileWire } from '@time2fest/contracts/schemas';
import { isAllowedFlag } from '../domain/rights/flags';
import { nickDisplay, nickKey } from '../domain/rights/nick';
import { applySettingsPatch, settingsOf } from '../domain/rights/settings';
import type { VerdictService } from '../moderation/verdict';
import type { RightsDb, RightsQuery } from './ports';

export type ProfileResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export interface ProfilePatchInput {
  nick?: string;
  flagCode?: string;
  settings?: Record<string, unknown>;
}

export interface CatalogRefs {
  countryIsos: ReadonlySet<string>;
  zoneIds: ReadonlySet<string>;
}

export interface ProfileServiceDeps {
  db(): Promise<RightsDb>;
  verdict(): VerdictService;
  refs(): Promise<CatalogRefs>;
  /** Publishes the `profile` event to the subject; never throws. */
  publish(subject: string): Promise<void>;
}

export interface ProfileService {
  get(subject: string, edgeCountry: string): Promise<ProfileWire>;
  patch(subject: string, patch: ProfilePatchInput, edgeCountry: string): Promise<ProfileResult<ProfileWire>>;
  checkNick(subject: string, nick: string): Promise<ProfileResult<null>>;
  /** The profile row exists with this nick key held by another subject. */
  nickTaken(db: RightsQuery, key: string, subject: string): Promise<boolean>;
}

interface Row extends Record<string, unknown> {
  nick: string | null;
  flag_code: string | null;
  settings: unknown;
  schedule: string[];
}

const NICK_REASONS = new Set(['short', 'long', 'link', 'forbidden']);

function refuse(reason: string, code: ApiError['code'] = 'validation'): { ok: false; error: ApiError } {
  return { ok: false, error: { code, reason } };
}

const INVALID: { ok: false; error: ApiError } = { ok: false, error: { code: 'validation', reason: 'invalid-input' } };

const isUnique = (err: unknown, depth = 0): boolean =>
  depth < 4 && err !== null && typeof err === 'object' && ((err as { code?: unknown }).code === '23505' || isUnique((err as { cause?: unknown }).cause, depth + 1));

export function createProfileService(deps: ProfileServiceDeps): ProfileService {
  /** `null` = the nick may be used; otherwise the refusal. */
  async function nickVerdict(nick: string): Promise<{ ok: false; error: ApiError } | null> {
    const v = await deps.verdict().verdict({ kind: 'nick', text: nick });
    if (v.outcome === 'allow') return null;
    if (v.outcome === 'review') return refuse('forbidden');
    return refuse(v.reason !== undefined && NICK_REASONS.has(v.reason) ? v.reason : 'forbidden');
  }

  async function extras(db: RightsQuery, subject: string): Promise<{ googleLinked: boolean }> {
    const g = await db.query(
      `SELECT 1 FROM user_accounts WHERE provider_id = 'google' AND user_id::text = $1 LIMIT 1`,
      [subject],
    );
    return { googleLinked: g.rowCount > 0 };
  }

  const detected = (country: string): string | null => (country === 'unknown' || country === '' ? null : country);

  function wire(row: Row | undefined, googleLinked: boolean, edgeCountry: string): ProfileWire {
    return {
      nick: row?.nick ?? null,
      flagCode: row?.flag_code ?? null,
      detectedFlag: detected(edgeCountry),
      settings: settingsOf(row?.settings),
      schedule: row?.schedule ?? [],
      googleLinked,
      // The pending email change arrives with SPEC-11 P10.
      pendingEmail: null,
    };
  }

  async function readRow(db: RightsQuery, subject: string, lock = false): Promise<Row | undefined> {
    const res = await db.query<Row>(
      `SELECT nick, flag_code, settings, schedule FROM profiles WHERE subject_id = $1${lock ? ' FOR UPDATE' : ''}`,
      [subject],
    );
    return res.rows[0];
  }

  return {
    async get(subject, edgeCountry) {
      const db = await deps.db();
      const [row, x] = await Promise.all([readRow(db, subject), extras(db, subject)]);
      return wire(row, x.googleLinked, edgeCountry);
    },

    async nickTaken(db, key, subject) {
      const res = await db.query('SELECT 1 FROM profiles WHERE nick_key = $1 AND subject_id <> $2 LIMIT 1', [key, subject]);
      return res.rowCount > 0;
    },

    async checkNick(subject, nick) {
      const bad = await nickVerdict(nick);
      if (bad) return bad;
      if (await this.nickTaken(await deps.db(), nickKey(nick), subject)) return refuse('taken');
      return { ok: true, value: null };
    },

    async patch(subject, patch, edgeCountry) {
      const db = await deps.db();
      const nick = patch.nick === undefined ? undefined : nickDisplay(patch.nick);
      if (nick !== undefined) {
        const bad = await nickVerdict(nick);
        if (bad) return bad;
      }
      const refs = patch.flagCode !== undefined || patch.settings !== undefined ? await deps.refs() : undefined;
      if (patch.flagCode !== undefined && !isAllowedFlag(patch.flagCode, refs!.countryIsos)) return INVALID;
      const touches = nick !== undefined || patch.flagCode !== undefined || (patch.settings !== undefined && Object.keys(patch.settings).length > 0);
      if (!touches) return { ok: true, value: await this.get(subject, edgeCountry) };

      let result: ProfileResult<ProfileWire>;
      try {
        result = await db.tx(async (q) => {
          const current = await readRow(q, subject, true);
          let settings = settingsOf(current?.settings);
          if (patch.settings !== undefined) {
            const applied = applySettingsPatch(settings, patch.settings, refs!);
            if (!applied.ok) return INVALID;
            settings = applied.value;
          }
          const nextNick = nick ?? current?.nick ?? null;
          const nextFlag = patch.flagCode ?? current?.flag_code ?? null;
          await q.query(
            `INSERT INTO profiles (subject_id, nick, nick_key, flag_code, settings, schedule, updated_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6::text[], now())
             ON CONFLICT (subject_id) DO UPDATE SET nick = EXCLUDED.nick, nick_key = EXCLUDED.nick_key,
               flag_code = EXCLUDED.flag_code, settings = EXCLUDED.settings, updated_at = now()`,
            [subject, nextNick, nextNick === null ? null : nickKey(nextNick), nextFlag, JSON.stringify(settings), current?.schedule ?? []],
          );
          const row = await readRow(q, subject);
          return { ok: true, value: wire(row, (await extras(q, subject)).googleLinked, edgeCountry) } as ProfileResult<ProfileWire>;
        });
      } catch (err) {
        if (isUnique(err)) return refuse('taken');
        throw err;
      }
      if (result.ok) await deps.publish(subject);
      return result;
    },
  };
}
