/**
 * Postgres adapter of the site store (SPEC-08 AC-4), ring 4: the row of the global `site-state`.
 *
 * Every write runs on the caller's transaction connection (Payload: `req.transactionID` →
 * `payload.db.sessions[id].db`) and first takes a transaction-scoped advisory lock: the global's row does
 * not exist before its first write, so a row lock could not serialise the first change; the lock
 * serialises every one across instances. Under it the row is created when missing, and every change is
 * ONE `UPDATE … SET version = version + 1 … RETURNING`, so concurrent writers commit distinct,
 * increasing versions. Payload rows never leave this module: callers get `SiteRecord`.
 */
import { sql } from '@payloadcms/db-postgres';
import { commitTransaction, createLocalReq, initTransaction, killTransaction } from 'payload';
import type { Payload, PayloadRequest } from 'payload';
import type { SiteSwitches } from '@time2fest/contracts';
import { isProductKey, type ProductSelection, type ProductSelections } from '../domain/site/products';
import { DEFAULT_SITE_RECORD, type SiteRecord } from '../domain/site/snapshot';
import { DEFAULT_SWITCHES, TOAST_TIER_KEYS, type PaymentsPause } from '../domain/site/switches';
import type { Clock } from '../ports';
import type { FanOutClaim, RebuildStore, SiteRecordPatch, SiteStore, Tx } from '../site/ports';

export const SITE_STATE = 'site-state';

const CONTEXT = { t2fTrusted: true, t2fInternal: true };
const LOCK_KEY = 't2f:site-state';

interface Exec {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: Record<string, unknown>[] }>;
}
interface DrizzleAdapter {
  sessions: Record<string, { db: Exec } | undefined>;
  drizzle: Exec;
}

const COLUMNS = sql`"version"::text AS "version", "at", "switches", "payments_pause", "product_selections"`;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

function toSwitches(v: unknown): SiteSwitches {
  const d = DEFAULT_SWITCHES;
  if (!isRecord(v)) return d;
  const rooms: Record<string, boolean> = {};
  if (isRecord(v.chatRooms)) for (const [room, open] of Object.entries(v.chatRooms)) if (typeof open === 'boolean') rooms[room] = open;
  const tiers = isRecord(v.toastTiers) ? v.toastTiers : {};
  const [t2, t5, t10] = TOAST_TIER_KEYS.map((t) => bool(tiers[t], d.toastTiers[t]));
  return {
    chat: bool(v.chat, d.chat),
    toasts: bool(v.toasts, d.toasts),
    pass: bool(v.pass, d.pass),
    passGift: bool(v.passGift, d.passGift),
    payments: bool(v.payments, d.payments),
    viewersMap: bool(v.viewersMap, d.viewersMap),
    passOffer: bool(v.passOffer, d.passOffer),
    chatRooms: rooms,
    toastTiers: { '2': t2 ?? true, '5': t5 ?? true, '10': t10 ?? true },
  };
}

function toSelections(v: unknown): ProductSelections {
  if (!isRecord(v)) return {};
  const out: Partial<Record<string, ProductSelection>> = {};
  for (const [key, s] of Object.entries(v)) {
    if (!isProductKey(key) || !isRecord(s) || !isRecord(s.price)) continue;
    const amount = Number(s.price.amount);
    const priceVersion = Number(s.priceVersion);
    if (typeof s.productId !== 'string' || !Number.isInteger(amount) || s.price.currency !== 'USD' || !Number.isInteger(priceVersion)) continue;
    out[key] = { productId: s.productId, price: { amount, currency: 'USD' }, priceVersion };
  }
  return out;
}

function toRecord(row: Record<string, unknown> | undefined): SiteRecord {
  if (!row) return DEFAULT_SITE_RECORD;
  const at = row.at instanceof Date ? row.at : row.at ? new Date(String(row.at)) : null;
  const pause = row.payments_pause;
  return {
    version: Number(row.version) || 1,
    at: at && Number.isFinite(at.getTime()) ? at.toISOString() : null,
    switches: toSwitches(row.switches),
    paymentsPause: pause === 'manual' || pause === 'auto' ? (pause as PaymentsPause) : null,
    productSelections: toSelections(row.product_selections),
  };
}

async function sessionOf(tx: Tx): Promise<Exec> {
  const req = tx as PayloadRequest;
  const db = req.payload.db as unknown as DrizzleAdapter;
  const id = req.transactionID;
  const session = id ? db.sessions[String(await id)]?.db : undefined;
  if (!session) throw new Error('site-state: a write needs an open transaction');
  return session;
}

/** The site lock until the transaction ends, and the row (created with the column defaults when missing). */
async function lockRow(conn: Exec): Promise<void> {
  await conn.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`);
  await conn.execute(sql`
    INSERT INTO "site_state" ("version", "updated_at", "created_at")
    SELECT 1, clock_timestamp(), clock_timestamp()
    WHERE NOT EXISTS (SELECT 1 FROM "site_state")`);
}

const FIRST_ROW = sql`(SELECT "id" FROM "site_state" ORDER BY "id" LIMIT 1)`;

export interface PayloadSiteStateDeps {
  payload: () => Promise<Payload>;
  /** Real time: `at` of a change. */
  clock: Clock;
}

export function createPayloadSiteStore(deps: PayloadSiteStateDeps): SiteStore {
  const now = () => new Date(deps.clock.now()).toISOString();
  return {
    async inTransaction(tx, fn) {
      const req = tx ? (tx as PayloadRequest) : await createLocalReq({ context: CONTEXT }, await deps.payload());
      const started = await initTransaction(req);
      try {
        const result = await fn(req);
        if (started) await commitTransaction(req);
        return result;
      } catch (err) {
        await killTransaction(req);
        throw err;
      }
    },
    async read(tx) {
      if (!tx) {
        const db = (await deps.payload()).db as unknown as DrizzleAdapter;
        const { rows } = await db.drizzle.execute(sql`SELECT ${COLUMNS} FROM "site_state" ORDER BY "id" LIMIT 1`);
        return toRecord(rows[0]);
      }
      const conn = await sessionOf(tx);
      await lockRow(conn);
      const { rows } = await conn.execute(sql`SELECT ${COLUMNS} FROM "site_state" ORDER BY "id" LIMIT 1`);
      return toRecord(rows[0]);
    },
    async write(tx, patch: SiteRecordPatch) {
      const conn = await sessionOf(tx);
      await lockRow(conn);
      const at = now();
      const switches = patch.switches === undefined ? null : JSON.stringify(patch.switches);
      const selections = patch.productSelections === undefined ? null : JSON.stringify(patch.productSelections);
      const setPause = patch.paymentsPause !== undefined;
      const { rows } = await conn.execute(sql`
        UPDATE "site_state" SET
          "version" = "version" + 1,
          "at" = ${at}::timestamptz,
          "updated_at" = ${at}::timestamptz,
          "switches" = COALESCE(${switches}::jsonb, "switches"),
          "product_selections" = COALESCE(${selections}::jsonb, "product_selections"),
          "payments_pause" = CASE WHEN ${setPause}::boolean
            THEN ${setPause ? patch.paymentsPause : null}::"enum_site_state_payments_pause" ELSE "payments_pause" END
        WHERE "id" = ${FIRST_ROW}
        RETURNING ${COLUMNS}`);
      if (!rows[0]) throw new Error('site-state: update returned no row');
      return toRecord(rows[0]);
    },
    async bumpVersion(tx) {
      const conn = await sessionOf(tx);
      await lockRow(conn);
      const at = now();
      const { rows } = await conn.execute(sql`
        UPDATE "site_state" SET "version" = "version" + 1, "at" = ${at}::timestamptz, "updated_at" = ${at}::timestamptz
        WHERE "id" = ${FIRST_ROW}
        RETURNING "version"::text AS "version"`);
      if (!rows[0]) throw new Error('site-state: update returned no row');
      return Number(rows[0].version);
    },
  };
}

/**
 * The fan-out claim (SPEC-08 AC-5, AC-37): ONE conditional `UPDATE … SET last_fanned_out = v WHERE
 * last_fanned_out < v RETURNING`, outside any transaction, so exactly one instance and one event claim a
 * version, and none claims a version at or below one already fanned out.
 */
export function createPayloadFanOutClaim(payload: () => Promise<Payload>): FanOutClaim {
  return {
    async claim(version) {
      const db = (await payload()).db as unknown as DrizzleAdapter;
      const { rows } = await db.drizzle.execute(sql`
        UPDATE "site_state" SET "last_fanned_out" = ${version}::numeric
        WHERE "id" = ${FIRST_ROW} AND COALESCE("last_fanned_out", 0) < ${version}::numeric
        RETURNING "id"`);
      return rows.length === 1;
    },
  };
}

/**
 * The rebuild state of the site record (SPEC-08 AC-61 … AC-63): `rebuild_due_at`, `rebuild_deferred`. Each call is
 * ONE statement outside any transaction. `schedule` only moves the due time later (`GREATEST`), so events
 * delivered out of order never bring a launch forward; `claim` is a conditional `UPDATE … WHERE rebuild_due_at =
 * $due RETURNING`, so exactly one instance claims a due launch. The row exists once any change committed
 * (the catalog change bumps the site version first); without it `schedule` changes nothing.
 */
export function createPayloadRebuildStore(payload: () => Promise<Payload>): RebuildStore {
  const exec = async () => ((await payload()).db as unknown as DrizzleAdapter).drizzle;
  return {
    async schedule(dueAt, keepDeferred) {
      const due = new Date(dueAt).toISOString();
      await (await exec()).execute(sql`
        UPDATE "site_state" SET "rebuild_due_at" = CASE
          WHEN ${keepDeferred}::boolean AND "rebuild_deferred" AND "rebuild_due_at" IS NOT NULL THEN "rebuild_due_at"
          ELSE GREATEST(COALESCE("rebuild_due_at", ${due}::timestamptz), ${due}::timestamptz) END
        WHERE "id" = ${FIRST_ROW}`);
    },
    async pending() {
      const { rows } = await (await exec()).execute(sql`
        SELECT "rebuild_due_at" AS "due", "rebuild_deferred" AS "deferred" FROM "site_state"
        WHERE "id" = ${FIRST_ROW} AND "rebuild_due_at" IS NOT NULL`);
      const row = rows[0];
      if (!row) return null;
      const due = row.due instanceof Date ? row.due : new Date(String(row.due));
      return Number.isFinite(due.getTime()) ? { dueAt: due.getTime(), deferred: row.deferred === true } : null;
    },
    async claim(dueAt, next) {
      const due = new Date(dueAt).toISOString();
      const to = next === null ? null : new Date(next).toISOString();
      const { rows } = await (await exec()).execute(sql`
        UPDATE "site_state" SET "rebuild_due_at" = ${to}::timestamptz, "rebuild_deferred" = ${to !== null}::boolean
        WHERE "id" = ${FIRST_ROW} AND "rebuild_due_at" = ${due}::timestamptz
        RETURNING "id"`);
      return rows.length === 1;
    },
  };
}

/**
 * Test-class reset of the site record (SPEC-08 W19, the `reset` action of `POST /api/_test/site`): every
 * column back to its default — version 1, no change time, default switches, no pause, no selections, no
 * rebuild — AND `last_fanned_out` back to 0, so the next change (version 2) is claimed and fanned out again.
 * One transaction under the site lock. Reached only through the test door (the composition root wires it in
 * the `test` class only).
 */
export function createPayloadSiteReset(deps: PayloadSiteStateDeps): () => Promise<void> {
  const store = createPayloadSiteStore(deps);
  return () =>
    store.inTransaction(null, async (tx) => {
      const conn = await sessionOf(tx);
      await lockRow(conn);
      await conn.execute(sql`
        UPDATE "site_state" SET
          "version" = DEFAULT,
          "at" = NULL,
          "switches" = DEFAULT,
          "payments_pause" = NULL,
          "product_selections" = DEFAULT,
          "rebuild_due_at" = NULL,
          "rebuild_deferred" = DEFAULT,
          "last_fanned_out" = DEFAULT,
          "updated_at" = clock_timestamp()
        WHERE "id" = ${FIRST_ROW}`);
    });
}
