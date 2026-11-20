/**
 * «Toggle with a reason» and the product choice (SPEC-08 AC-4, AC-10 … AC-14, AC-19, AC-20), ring 3.
 * No Payload import.
 *
 * Each change runs in ONE transaction: read the site record under the site lock, apply the rule
 * (`domain/site/{switches,products}`), and only if something changes: write it (`version + 1`), append
 * ONE journal row and publish ONE internal event `site.changed` `{ version }`. A refusal or a no-op writes
 * nothing. The reason and the mode live in the row's `after` (`JournalEntry` has no reason field, DR-11).
 * The site lock is taken before the publish (see `ports.ts`, lock order).
 */
import type { ProductKey } from '@time2fest/contracts';
import type { Actor, Journal, RevertHandler, StoredJournalEntry } from '../audit/ports';
import { deepEqual } from '../domain/audit/revert';
import { chooseProduct as choose, clearProduct, isProductKey, type ProductSelection } from '../domain/site/products';
import { applyToggle, checkToggle, switchValue, validReason, type ToggleMode, type ToggleRequest } from '../domain/site/switches';
import type { EventPublisher } from '../events/ports';
import type { Clock } from '../ports';
import type { ProductCatalog, SiteRecord, SiteStore, Tx } from './ports';

export const SITE_STATE = 'site-state';
export const SITE_CHANGED_TOPIC = 'site.changed';
export const SITE_SWITCH_ACTION = 'site.switch';
export const SITE_PRODUCT_ACTION = 'site.product';

export interface SiteDeps {
  store: SiteStore;
  products: ProductCatalog;
  journal: Journal;
  publisher: EventPublisher;
  clock: Clock;
}

export type SiteRefusal = 'invalid' | 'forbidden';
/** `version` = the site version after the call (unchanged when `changed` is false). */
export type SiteResult = { ok: true; version: number; changed: boolean } | { ok: false; reason: SiteRefusal; detail?: string };

export interface SwitchInput {
  key: string;
  value: boolean;
  reason: string;
  room?: string;
  tier?: string;
}

export interface ProductInput {
  key: string;
  productId: string;
  reason: string;
}

/** Payload of `site.changed`. */
export interface SiteChangedPayload {
  version: number;
}

const refuse = (reason: SiteRefusal, detail?: string): SiteResult => (detail ? { ok: false, reason, detail } : { ok: false, reason });

/** The journalled view of one switch: what it targets, its value and the payments pause. */
function switchView(record: SiteRecord, req: Pick<ToggleRequest, 'key' | 'room' | 'tier'>): Record<string, unknown> {
  return {
    key: req.key,
    ...(req.key === 'chatRooms' ? { room: req.room } : {}),
    ...(req.key === 'toastTiers' ? { tier: req.tier } : {}),
    value: switchValue(record.switches, req),
    pause: record.paymentsPause,
  };
}

function productView(key: ProductKey, selection: ProductSelection | undefined): Record<string, unknown> {
  return { key, selection: selection ? { productId: selection.productId, price: { ...selection.price }, priceVersion: selection.priceVersion } : null };
}

function switchTarget(req: Pick<ToggleRequest, 'key' | 'room' | 'tier'>): string {
  if (req.key === 'chatRooms') return `chatRooms:${req.room}`;
  if (req.key === 'toastTiers') return `toastTiers:${req.tier}`;
  return req.key;
}

async function commitChange(
  deps: SiteDeps,
  tx: Tx,
  write: () => Promise<SiteRecord>,
  journal: { actor: Actor; action: string; target: string; before: Record<string, unknown>; after: (r: SiteRecord) => Record<string, unknown>; revertOf: string | null },
): Promise<number> {
  const written = await write();
  await deps.journal.append(tx, {
    actor: journal.actor,
    action: journal.action,
    target: { collection: SITE_STATE, id: journal.target },
    at: deps.clock.now(),
    before: journal.before,
    after: journal.after(written),
    revertOf: journal.revertOf,
  });
  const payload: SiteChangedPayload = { version: written.version };
  await deps.publisher.publish(tx, SITE_CHANGED_TOPIC, payload);
  return written.version;
}

/**
 * Toggles one switch with a reason (AC-10 … AC-14). `mode: 'auto'` is the system's payments pause/resume only.
 * An agent actor is refused (`forbidden`); the route checks the owner role first (AC-16).
 */
export async function toggle(deps: SiteDeps, tx: Tx | null, actor: Actor, input: SwitchInput, mode: ToggleMode, revertOf: string | null = null): Promise<SiteResult> {
  if (actor.kind === 'agent') return refuse('forbidden');
  const req: ToggleRequest = { ...input, mode };
  return deps.store.inTransaction(tx, async (t) => {
    const record = await deps.store.read(t);
    const check = checkToggle(record.switches, record.paymentsPause, req);
    if (!check.ok) return refuse(check.refuse);
    const next = applyToggle(record.switches, record.paymentsPause, req);
    if (deepEqual(next.switches, record.switches) && next.paymentsPause === record.paymentsPause) {
      return { ok: true, version: record.version, changed: false };
    }
    const version = await commitChange(deps, t, () => deps.store.write(t, { switches: next.switches, paymentsPause: next.paymentsPause }), {
      actor,
      action: SITE_SWITCH_ACTION,
      target: switchTarget(req),
      before: switchView(record, req),
      after: (w) => ({ ...switchView(w, req), reason: req.reason.trim(), mode }),
      revertOf,
    });
    return { ok: true, version, changed: true };
  });
}

/** Chooses a listed product for a key (AC-19, AC-20); `invalid` with `unknown-product` / `other-key` otherwise. */
export async function chooseProduct(deps: SiteDeps, tx: Tx | null, actor: Actor, input: ProductInput, revertOf: string | null = null): Promise<SiteResult> {
  if (actor.kind === 'agent') return refuse('forbidden');
  if (!isProductKey(input.key) || typeof input.productId !== 'string' || !validReason(input.reason)) return refuse('invalid');
  const key = input.key;
  const list = await deps.products.list();
  return deps.store.inTransaction(tx, async (t) => {
    const record = await deps.store.read(t);
    const chosen = choose(list, key, input.productId, record.productSelections);
    if (!chosen.ok) return refuse('invalid', chosen.refuse);
    const version = await commitChange(deps, t, () => deps.store.write(t, { productSelections: chosen.selections }), {
      actor,
      action: SITE_PRODUCT_ACTION,
      target: key,
      before: productView(key, record.productSelections[key]),
      after: (w) => ({ ...productView(key, w.productSelections[key]), reason: input.reason.trim(), mode: 'manual' }),
      revertOf,
    });
    return { ok: true, version, changed: true };
  });
}

/** The reason of a revert row. */
const revertReason = (entry: StoredJournalEntry) => `revert ${entry.id}`.slice(0, 200);

/** The current value in the shape of the entry's `after` (the revert check compares every field of it). */
async function currentOf(deps: SiteDeps, tx: Tx, entry: StoredJournalEntry): Promise<Record<string, unknown> | null> {
  const after = entry.after;
  if (!after || typeof after.key !== 'string') return null;
  const record = await deps.store.read(tx);
  const bookkeeping = { reason: after.reason, mode: after.mode };
  if (entry.action === SITE_SWITCH_ACTION) {
    const req = { key: after.key, room: typeof after.room === 'string' ? after.room : undefined, tier: typeof after.tier === 'string' ? after.tier : undefined };
    return { ...switchView(record, req), ...bookkeeping };
  }
  if (!isProductKey(after.key)) return null;
  return { ...productView(after.key, record.productSelections[after.key]), ...bookkeeping };
}

/** Restores a `site.switch` row's `before` through `toggle` (mode `manual`): one more row, a new version (AC-12). */
async function revertSwitch(deps: SiteDeps, tx: Tx, entry: StoredJournalEntry, actor: Actor): Promise<void> {
  const before = entry.before ?? {};
  if (typeof before.key !== 'string' || typeof before.value !== 'boolean') throw new Error('site revert: unreadable journal row');
  const input: SwitchInput = {
    key: before.key,
    value: before.value,
    reason: revertReason(entry),
    ...(typeof before.room === 'string' ? { room: before.room } : {}),
    ...(typeof before.tier === 'string' ? { tier: before.tier } : {}),
  };
  const result = await toggle(deps, tx, actor, input, 'manual', entry.id);
  if (!result.ok) throw new Error(`site revert refused: ${result.reason}`);
}

/**
 * Restores a `site.product` row's `before`: the earlier product (still listed by the port, for its key) or
 * no product. One more row, a new version.
 */
async function revertProduct(deps: SiteDeps, tx: Tx, entry: StoredJournalEntry, actor: Actor): Promise<void> {
  const before = entry.before ?? {};
  if (!isProductKey(before.key)) throw new Error('site revert: unreadable journal row');
  const key = before.key;
  const selection = before.selection as { productId?: unknown } | null | undefined;
  if (selection && typeof selection.productId === 'string') {
    const result = await chooseProduct(deps, tx, actor, { key, productId: selection.productId, reason: revertReason(entry) }, entry.id);
    if (!result.ok) throw new Error(`site revert refused: ${result.reason}`);
    return;
  }
  await deps.store.inTransaction(tx, async (t) => {
    const record = await deps.store.read(t);
    if (!record.productSelections[key]) return;
    await commitChange(deps, t, () => deps.store.write(t, { productSelections: clearProduct(key, record.productSelections) }), {
      actor,
      action: SITE_PRODUCT_ACTION,
      target: key,
      before: productView(key, record.productSelections[key]),
      after: (w) => ({ ...productView(key, w.productSelections[key]), reason: revertReason(entry), mode: 'manual' }),
      revertOf: entry.id,
    });
  });
}

/**
 * The revert-handler rows of the site (AC-12, AC-22 of SPEC-02). `depsOf` resolves the process's site
 * deps lazily; `actorOf` names who reverts from the revert's transaction.
 */
export function siteRevertHandlers(depsOf: () => Promise<SiteDeps>, actorOf: (tx: Tx) => Actor): RevertHandler[] {
  return [SITE_PRODUCT_ACTION, SITE_SWITCH_ACTION].map((key) => ({
    key,
    async current(tx: Tx, entry: StoredJournalEntry) {
      return currentOf(await depsOf(), tx, entry);
    },
    async revert(tx: Tx, entry: StoredJournalEntry) {
      const deps = await depsOf();
      const actor = actorOf(tx);
      if (key === SITE_SWITCH_ACTION) await revertSwitch(deps, tx, entry, actor);
      else await revertProduct(deps, tx, entry, actor);
    },
  }));
}
