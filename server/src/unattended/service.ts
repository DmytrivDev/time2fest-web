/**
 * Unattended mode (AC-31 … AC-36, AC-20, AC-22), ring 3. No Payload import.
 *
 * Every change of the mode runs in ONE transaction under the store's lock: read the state, compute
 * the next one, and only if it differs (`sameMode`) write it with `version + 1`, append ONE journal
 * row and publish ONE `unattended.changed` event `{ on, cause, at, version }`. Evaluating the same
 * instant twice — or on two instances — therefore makes one transition.
 *
 * - `evaluate`: the rule (`domain/unattended/machine.ts`) at an instant; actor `system:unattended`;
 * - `setManual`: the owner's switch (AC-33, AC-35); revertible (`unattended.set-manual`);
 * - `revertManual`: restores a switch row's `before` (AC-22);
 * - `readUnattended`: the state, the windows and the instant the manual switch stops holding.
 */
import { UnattendedChangedSchema } from '@time2fest/contracts/schemas';
import type { Actor, Journal, StoredJournalEntry } from '../audit/ports';
import { desiredState, manualState, sameMode, transitionCause, type ModeState, type UnattendedCause } from '../domain/unattended/machine';
import { holdUntil } from '../domain/unattended/override';
import type { SleepWindow } from '../domain/unattended/windows';
import type { EventPublisher } from '../events/ports';
import type { Clock } from '../ports';
import type { OpenPageAlarms, StoredMode, Tx, UnattendedStore } from './ports';

export const UNATTENDED_STATE = 'unattended-state';
export const UNATTENDED_WINDOWS = 'unattended-windows';
export const UNATTENDED_CHANGED_TOPIC = 'unattended.changed';
export const UNATTENDED_TRANSITION_ACTION = 'unattended.transition';
export const UNATTENDED_MANUAL_ACTION = 'unattended.set-manual';
export const UNATTENDED_SYSTEM_ACTOR: Actor = Object.freeze({ kind: 'system', id: 'unattended', label: 'unattended' });

export interface UnattendedDeps {
  store: UnattendedStore;
  alarms: OpenPageAlarms;
  journal: Journal;
  publisher: EventPublisher;
  clock: Clock;
}

/** The journalled shape of the mode (`before`/`after`, and the revert check). */
export function modeView(state: ModeState): Record<string, unknown> {
  return { on: state.on, cause: state.cause, manualAt: state.manualAt === null ? null : new Date(state.manualAt).toISOString() };
}

const CAUSES: readonly string[] = ['schedule', 'manual', 'alarm'];

/** A journalled view back as a mode; anything unreadable is the initial mode. */
export function modeOf(view: Record<string, unknown> | null): ModeState {
  const cause = typeof view?.cause === 'string' && CAUSES.includes(view.cause) ? (view.cause as UnattendedCause) : null;
  const at = typeof view?.manualAt === 'string' ? Date.parse(view.manualAt) : NaN;
  const manualAt = cause === 'manual' && Number.isFinite(at) ? at : null;
  return { on: view?.on === true, cause: cause === 'manual' && manualAt === null ? null : cause, manualAt };
}

interface Write {
  next: ModeState;
  actor: Actor;
  action: string;
  cause: UnattendedCause;
  at: number;
  revertOf: string | null;
}

/** Writes one transition: the state, one journal row, one event — all in `tx`. */
async function transition(deps: UnattendedDeps, tx: Tx, prev: StoredMode, w: Write): Promise<StoredMode> {
  const stored: StoredMode = { ...w.next, version: prev.version + 1, changedAt: w.at };
  await deps.store.write(tx, stored);
  await deps.journal.append(tx, {
    actor: w.actor,
    action: w.action,
    target: { collection: UNATTENDED_STATE, id: UNATTENDED_STATE },
    at: w.at,
    before: modeView(prev),
    after: modeView(w.next),
    revertOf: w.revertOf,
  });
  const payload = UnattendedChangedSchema.parse({ on: stored.on, cause: w.cause, at: new Date(w.at).toISOString(), version: stored.version });
  await deps.publisher.publish(tx, UNATTENDED_CHANGED_TOPIC, payload);
  return stored;
}

export interface Outcome {
  changed: boolean;
  state: StoredMode;
}

/** Applies the rule at `now` (default: the server clock). `tx`: join a transaction, or `null` for a new one. */
export async function evaluate(deps: UnattendedDeps, tx: Tx | null, now: number = deps.clock.now()): Promise<Outcome> {
  return deps.store.inTransaction(tx, async (t) => {
    await deps.store.lock(t);
    const current = await deps.store.state(t);
    const windows = await deps.store.windows(t);
    const openPageAlarms = await deps.alarms.listOpenPage();
    const next = desiredState({ windows, openPageAlarms, now, current });
    if (sameMode(current, next)) return { changed: false, state: current };
    const state = await transition(deps, t, current, {
      next,
      actor: UNATTENDED_SYSTEM_ACTOR,
      action: UNATTENDED_TRANSITION_ACTION,
      cause: transitionCause(current, next),
      at: now,
      revertOf: null,
    });
    return { changed: true, state };
  });
}

/**
 * The owner's manual switch (AC-33): holds until the next window boundary. A manual off also ends
 * the alarm-caused mode (AC-35). Switching to the value a manual switch already holds writes nothing.
 */
export async function setManual(deps: UnattendedDeps, tx: Tx | null, on: boolean, actor: Actor): Promise<Outcome> {
  return deps.store.inTransaction(tx, async (t) => {
    await deps.store.lock(t);
    const current = await deps.store.state(t);
    if (current.cause === 'manual' && current.on === on) return { changed: false, state: current };
    const at = deps.clock.now();
    const state = await transition(deps, t, current, { next: manualState(on, at), actor, action: UNATTENDED_MANUAL_ACTION, cause: 'manual', at, revertOf: null });
    return { changed: true, state };
  });
}

/** The current mode in the journalled shape (the revert check of `unattended.set-manual`, AC-22). */
export async function journalledMode(store: UnattendedStore, tx: Tx): Promise<Record<string, unknown>> {
  return modeView(await store.state(tx));
}

/**
 * Reverts an `unattended.set-manual` row (AC-22): restores its `before` as one more transition
 * (journal row pointing at the reverted one, one event with the cause `manual` — an owner's action).
 * The rule applies again on the next evaluation.
 */
export async function revertManual(deps: UnattendedDeps, tx: Tx, entry: StoredJournalEntry, actor: Actor): Promise<void> {
  await deps.store.inTransaction(tx, async (t) => {
    await deps.store.lock(t);
    const current = await deps.store.state(t);
    const next = modeOf(entry.before);
    if (sameMode(current, next)) return;
    await transition(deps, t, current, { next, actor, action: UNATTENDED_MANUAL_ACTION, cause: 'manual', at: deps.clock.now(), revertOf: entry.id });
  });
}

export interface UnattendedView {
  state: StoredMode;
  windows: SleepWindow[];
  /** When the manual switch stops holding (epoch ms); `null` with a manual cause = until the next switch. */
  manualUntil: number | null;
}

/** Read port of the admin slice (P10). */
export async function readUnattended(store: UnattendedStore): Promise<UnattendedView> {
  return store.inTransaction(null, async (t) => {
    const state = await store.state(t);
    const windows = await store.windows(t);
    const manualUntil = state.cause === 'manual' && state.manualAt !== null ? holdUntil(windows, state.manualAt) : null;
    return { state, windows, manualUntil };
  });
}
