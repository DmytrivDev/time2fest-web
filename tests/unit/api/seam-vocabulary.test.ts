/** Шов: словник SPEC-01 (причини, поля, `refunded`, `hide`). Типові твердження перевіряє кореневий `tsc`, час виконання — тут. */
import { describe, expect, it } from 'vitest';
import type { Session } from '@/lib/api/contracts/auth';
import type { ChatSendReason, ChatTranslateReason } from '@/lib/api/contracts/chat';
import {
  isFinalOrder,
  type CheckoutCancelReason,
  type CheckoutStartReason,
  type CheckoutStartRequest,
  type Order,
  type OrderStatus,
} from '@/lib/api/contracts/checkout';
import { applyStreamEvent } from '@/lib/api/contracts/live';
import type { PassportClaimReason } from '@/lib/api/contracts/passport';
import type { LinkGoogleReason, ProfileSettings } from '@/lib/api/contracts/profile';
import type { RatingVoteReason } from '@/lib/api/contracts/rating';
import type { ToastCheckReason } from '@/lib/api/contracts/toasts';
import { createSimProfile } from '@/lib/api/sim/profile';
import { getData } from '@/lib/data/load';
import type { StreamChain, StreamSource, SystemPayload } from '@/lib/data/types';

// ── Типові твердження (тест падає в `tsc`, а не у vitest) ───────────────────────────────────────────────────────
export const sendReason: ChatSendReason = 'chat-closed';
export const translateReason: ChatTranslateReason = 'translate-limit';
export const startReasons: readonly CheckoutStartReason[] = [
  'pass-owned',
  'payments-off',
  'banned',
  'price-changed',
  'toasts-closed',
  'tier-off',
  'countries',
];
export const cancelReason: CheckoutCancelReason = 'already-paid';
export const claimReasons: readonly PassportClaimReason[] = ['claim-closed', 'unknown-event'];
export const toastReason: ToastCheckReason = 'moderation';
export const googleReason: LinkGoogleReason = 'google-taken';
export const voteReason: RatingVoteReason = 'not-rated';

export const systemKinds: readonly SystemPayload[] = [
  { kind: 'country-midnight', countries: [], eventIds: [] },
  { kind: 'greetings-counter', count: 1, flagCodes: [], eventId: 'e' },
  { kind: 'slow-mode', seconds: 5 },
  { kind: 'poll-open', pollId: 'p' },
  { kind: 'rating-leader', eventId: 'e', city: 'c', flagCode: 'UA', score: 5 },
  { kind: 'toast-midnight', zoneId: 'z', offsetMinutes: 0, countryIsos: [], toasters: [] },
  { kind: 'announcement', text: 't' },
  { kind: 'time-pending', eventId: 'e' },
];

const product = { kind: 'pass' } as const;
export const reqWithout: CheckoutStartRequest = { product, returnPath: '/', clientId: 'c' };
export const reqWith: CheckoutStartRequest = { ...reqWithout, priceVersion: 3 };
export const orderExtras: readonly Pick<Order, 'price' | 'priceVersion'>[] = [{}, { price: { amount: 5, currency: 'USD' }, priceVersion: 3 }];
export const sessionExtras: readonly Pick<Session, 'passNight'>[] = [{}, { passNight: '2026-27' }];
export const settingsExtras: readonly Pick<ProfileSettings, 'reminderEmails'>[] = [{}, { reminderEmails: true }];

const data = getData();
const [eventId, chain] = [...data.chainsByEventId.entries()][0]!;
export const versionedChain: StreamChain = { ...chain, version: 2 };
export const overriddenSource: StreamSource = { ...chain.sources[0]!, override: true };

describe('словник шва', () => {
  it('isFinalOrder: refunded не кінцевий, решта — як було', () => {
    const final: OrderStatus[] = ['paid', 'declined', 'cancelled', 'expired'];
    const open: OrderStatus[] = ['open', 'pending', 'refunded'];
    for (const s of final) expect(isFinalOrder(s)).toBe(true);
    for (const s of open) expect(isFinalOrder(s)).toBe(false);
  });

  it('applyStreamEvent: hide ігнорується (та сама мапа)', () => {
    const chains = data.chainsByEventId;
    expect(applyStreamEvent(chains, { type: 'hide', eventId, sourceId: chain.sources[0]!.id })).toBe(chains);
  });

  it('AC-27: sim-профіль не має ключа reminderEmails', async () => {
    const res = await createSimProfile().get();
    expect(res.ok).toBe(true);
    if (res.ok) expect('reminderEmails' in res.value.settings).toBe(false);
  });
});
