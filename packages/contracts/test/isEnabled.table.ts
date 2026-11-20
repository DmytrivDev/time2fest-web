/** Full decision table of `isEnabled` (SPEC-08 AC-15). Exported for the server and web tests. */
import type { SiteSwitches } from '../src/site';
import type { IsEnabledTarget } from '../src/siteRules';

export interface IsEnabledCase {
  name: string;
  switches: SiteSwitches;
  target: IsEnabledTarget;
  expected: boolean;
}

const base = (): SiteSwitches => ({
  chat: true,
  toasts: true,
  pass: true,
  passGift: true,
  payments: true,
  viewersMap: true,
  passOffer: true,
  chatRooms: {},
  toastTiers: { '2': true, '5': true, '10': true },
});

/** Every combination of `n` booleans. */
function combos(n: number): boolean[][] {
  return Array.from({ length: 2 ** n }, (_, i) => Array.from({ length: n }, (_, b) => Boolean((i >> b) & 1)));
}

export function buildIsEnabledTable(): IsEnabledCase[] {
  const rows: IsEnabledCase[] = [];
  for (const key of ['pass', 'passGift'] as const) {
    for (const [own = false, payments = false] of combos(2)) {
      rows.push({ name: `${key} own=${own} payments=${payments}`, switches: { ...base(), [key]: own, payments }, target: { kind: 'product', key }, expected: own && payments });
    }
  }
  for (const tier of ['2', '5', '10'] as const) {
    for (const [toasts = false, tierOn = false, payments = false] of combos(3)) {
      rows.push({
        name: `tier ${tier} toasts=${toasts} tier=${tierOn} payments=${payments}`,
        switches: { ...base(), toasts, payments, toastTiers: { ...base().toastTiers, [tier]: tierOn } },
        target: { kind: 'tier', tier },
        expected: toasts && tierOn && payments,
      });
    }
  }
  for (const [chat, roomState] of [
    [true, 'absent'],
    [true, 'true'],
    [true, 'false'],
    [false, 'absent'],
    [false, 'true'],
    [false, 'false'],
  ] as const) {
    const chatRooms: Record<string, boolean> = roomState === 'absent' ? {} : { kyiv: roomState === 'true' };
    rows.push({ name: `room chat=${chat} room=${roomState}`, switches: { ...base(), chat, chatRooms }, target: { kind: 'room', room: 'kyiv' }, expected: chat && roomState !== 'false' });
  }
  for (const key of ['chat', 'viewersMap', 'passOffer'] as const) {
    for (const value of [true, false]) {
      rows.push({ name: `switch ${key}=${value}`, switches: { ...base(), [key]: value }, target: { kind: 'switch', key }, expected: value });
    }
  }
  return rows;
}
