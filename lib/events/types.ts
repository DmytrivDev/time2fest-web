/** Події рівня застосунку (двигуни → компоненти) за `contracts/ui-events.md`. */
import type { Gender, ISO, Ms, PresenceSource, Stars } from '@/lib/data/types';

export type PlayerSlot = 'main' | `room:${number}`;

export interface MomentStamp {
  eventKey: string;
  at: Ms;
  firedAt: Ms;
  late?: boolean;
  slotMidnightUtc: ISO;
  eventIds: string[];
  presentEventIds: string[];
  presenceSources: Record<string, PresenceSource>;
  countries: { iso: string; gender: Gender }[];
  firstRowEventId?: string;
  announce: { cityId: string; text: 'midnight-stamp-ready' };
}

export interface MomentRateOpen {
  eventKey: string;
  at: Ms;
  eventIds: string[];
  closesAt: Ms;
  late?: boolean;
}

export interface MomentRateClose {
  eventKey: string;
  at: Ms;
  eventIds: string[];
  reason: 'timeout' | 'dismissed' | 'rated' | 'overridden';
  stars?: Stars;
  deferredMs?: number;
  late?: boolean;
}

export interface AirHandoverSoon {
  eventKey: string;
  at: Ms;
  fromEventId: string;
  toEventId: string;
  remainingMs: number;
  handoverAt: Ms;
  late?: boolean;
}

export interface AirHandover {
  eventKey: string;
  at: Ms;
  fromEventId: string;
  toEventId: string;
  viewChanged: 'stream' | 'countdown-scene' | 'expected-scene' | 'festival-over';
  stayedHere: boolean;
  reason: 'timer';
  late?: boolean;
}

export interface OfferShow {
  eventKey: string;
  at: Ms;
  kind: 'pass-offer' | 'tips';
  triggerEventId: string;
  stampCount: number;
  neutralizeSound: true;
}

export interface PlayerSourceSwitched {
  eventKey: string;
  at: Ms;
  slot: PlayerSlot;
  eventId: string;
  fromSourceId: string;
  toSourceId: string;
  chainIndex: number;
  reason: 'error' | 'not-embeddable' | 'not-live' | 'ended';
  errorCode?: 2 | 5 | 100 | 101 | 150;
  exhausted?: boolean;
}

export interface PlayerFacebookConsentRequired {
  eventKey: string;
  at: Ms;
  slot: PlayerSlot;
  eventId: string;
  sourceId: string;
}

export interface UiEventMap {
  'moment:stamp': MomentStamp;
  'moment:rate-open': MomentRateOpen;
  'moment:rate-close': MomentRateClose;
  'air:handover-soon': AirHandoverSoon;
  'air:handover': AirHandover;
  'offer:show': OfferShow;
  'player:source-switched': PlayerSourceSwitched;
  'player:facebook-consent-required': PlayerFacebookConsentRequired;
}

export type UiEventType = keyof UiEventMap;
export type UiEventHandler<K extends UiEventType> = (payload: UiEventMap[K]) => void;
