/**
 * Site switch rules (SPEC-08 AC-11, AC-13, AC-14; C4), ring 1 — pure, no clock.
 *
 * `checkToggle` decides whether a «toggle with a reason» may run; `applyToggle` computes the new switches
 * and payments pause. Pause table (AC-13):
 *
 * | current pause | call                 | result                         |
 * |---------------|----------------------|--------------------------------|
 * | manual        | `auto` enables       | `forbidden`, payments stay off |
 * | auto          | `auto` enables       | allowed, pause cleared         |
 * | manual        | manual enables       | allowed, pause cleared         |
 * | auto          | manual enables       | allowed, pause cleared         |
 * | manual        | `auto` pauses        | the manual pause holds         |
 *
 * `auto` concerns `payments` only (AC-14).
 */
import type { SiteSwitches } from '@time2fest/contracts';

export const SWITCH_KEYS = ['chat', 'toasts', 'pass', 'passGift', 'payments', 'viewersMap', 'passOffer', 'chatRooms', 'toastTiers'] as const;
export type SwitchKey = (typeof SWITCH_KEYS)[number];
export type BooleanSwitchKey = Exclude<SwitchKey, 'chatRooms' | 'toastTiers'>;
export const TOAST_TIER_KEYS = ['2', '5', '10'] as const;
export type ToastTierKey = (typeof TOAST_TIER_KEYS)[number];

/** Who paused payments; `null` = no pause on record. */
export type PaymentsPause = 'manual' | 'auto' | null;
export type ToggleMode = 'manual' | 'auto';
export type ToggleRefusal = 'invalid' | 'forbidden';

/** Longest reason, after trimming (AC-11). */
export const REASON_MAX_LENGTH = 200;

export interface ToggleRequest {
  key: string;
  value: boolean;
  reason: string;
  mode: ToggleMode;
  /** Required for `chatRooms` only. */
  room?: string;
  /** Required for `toastTiers` only. */
  tier?: string;
}

export interface ToggleOutcome {
  switches: SiteSwitches;
  paymentsPause: PaymentsPause;
}

export const DEFAULT_SWITCHES: SiteSwitches = Object.freeze({
  chat: true,
  toasts: true,
  pass: true,
  passGift: true,
  payments: true,
  viewersMap: true,
  passOffer: true,
  chatRooms: Object.freeze({}),
  toastTiers: Object.freeze({ '2': true, '5': true, '10': true }),
}) as SiteSwitches;

const isSwitchKey = (key: string): key is SwitchKey => (SWITCH_KEYS as readonly string[]).includes(key);
const isTier = (tier: string | undefined): tier is ToastTierKey => tier !== undefined && (TOAST_TIER_KEYS as readonly string[]).includes(tier);

/** A reason is valid when, trimmed, it has 1 … 200 characters (AC-11). */
export function validReason(reason: unknown): boolean {
  if (typeof reason !== 'string') return false;
  const length = [...reason.trim()].length;
  return length >= 1 && length <= REASON_MAX_LENGTH;
}

/** Whether the toggle may run (see the module comment); `ok` does not mean anything changes. */
export function checkToggle(current: SiteSwitches, pause: PaymentsPause, req: ToggleRequest): { ok: true } | { ok: false; refuse: ToggleRefusal } {
  if (!isSwitchKey(req.key) || typeof req.value !== 'boolean') return { ok: false, refuse: 'invalid' };
  if (req.mode !== 'manual' && req.mode !== 'auto') return { ok: false, refuse: 'invalid' };
  if (req.mode === 'auto' && req.key !== 'payments') return { ok: false, refuse: 'forbidden' };
  if (!validReason(req.reason)) return { ok: false, refuse: 'invalid' };
  const roomGiven = req.room !== undefined;
  const tierGiven = req.tier !== undefined;
  if (req.key === 'chatRooms') {
    if (typeof req.room !== 'string' || req.room.trim() === '' || tierGiven) return { ok: false, refuse: 'invalid' };
  } else if (req.key === 'toastTiers') {
    if (!isTier(req.tier) || roomGiven) return { ok: false, refuse: 'invalid' };
  } else if (roomGiven || tierGiven) {
    return { ok: false, refuse: 'invalid' };
  }
  if (req.key === 'payments' && req.mode === 'auto' && req.value && pause === 'manual') {
    return { ok: false, refuse: 'forbidden' };
  }
  return { ok: true };
}

/** The current value a request targets (a room absent from the map is open). */
export function switchValue(switches: SiteSwitches, req: Pick<ToggleRequest, 'key' | 'room' | 'tier'>): boolean {
  if (req.key === 'chatRooms') return switches.chatRooms[req.room ?? ''] !== false;
  if (req.key === 'toastTiers') return isTier(req.tier) ? switches.toastTiers[req.tier] : true;
  return switches[req.key as BooleanSwitchKey];
}

/**
 * The switches and pause after a request that passed `checkToggle`. Returns the same `current`
 * and `pause` values when nothing changes (e.g. `auto` pausing while a manual pause holds).
 */
export function applyToggle(current: SiteSwitches, pause: PaymentsPause, req: ToggleRequest): ToggleOutcome {
  if (req.key === 'payments') {
    if (req.value) return { switches: current.payments ? current : { ...current, payments: true }, paymentsPause: null };
    // Pausing: a manual pause is never downgraded to an automatic one.
    const nextPause: PaymentsPause = req.mode === 'manual' || pause === 'manual' ? 'manual' : 'auto';
    return { switches: current.payments ? { ...current, payments: false } : current, paymentsPause: nextPause };
  }
  if (switchValue(current, req) === req.value) return { switches: current, paymentsPause: pause };
  if (req.key === 'chatRooms') {
    const room = req.room as string;
    const { [room]: _dropped, ...rest } = current.chatRooms;
    void _dropped;
    // Absent = open: an opened room leaves the map.
    return { switches: { ...current, chatRooms: req.value ? rest : { ...rest, [room]: false } }, paymentsPause: pause };
  }
  if (req.key === 'toastTiers') {
    return { switches: { ...current, toastTiers: { ...current.toastTiers, [req.tier as ToastTierKey]: req.value } }, paymentsPause: pause };
  }
  return { switches: { ...current, [req.key as BooleanSwitchKey]: req.value }, paymentsPause: pause };
}
