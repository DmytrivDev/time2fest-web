/**
 * Типи даних області «Ефір і перегляд» за `specs/001-live-viewing/data-model.md`
 * і контрактами `contracts/schedule.md`, `contracts/streams.md`, `contracts/chat.md`.
 *
 * `ISO` — рядок ISO 8601 з `Z` або зсувом; `Ms` — мілісекунди epoch UTC; `Sec` — секунди.
 */

export type ISO = string;
export type Ms = number;
export type Sec = number;

// ── 1.1 Country ────────────────────────────────────────────────────────────

export type Gender = 'm' | 'f' | 'n' | 'pl' | null;

export interface HowTo {
  traditions: { id: string; title: string; text: string; iconId: string }[];
  gallery?: { src: string; alt: string; author: string; license: string }[];
  text: string;
}

export interface Country {
  iso: string;
  slug: string;
  name: { uk: string };
  gender: Gender;
  flagCode: string;
  zoneIds: string[];
  illustrationId: string;
  howTo: HowTo;
  popularity: number;
}

// ── 1.2 Zone ───────────────────────────────────────────────────────────────

export interface Zone {
  id: string;
  order: number;
  offsetMinutes: number;
  midnightUtc: ISO;
  representativeCityId: string;
}

// ── 1.3 City ───────────────────────────────────────────────────────────────

export type CelebrationType = 'main' | 'webcam' | 'tv' | 'countdown-only';

export interface City {
  id: string;
  countryIso: string;
  zoneId: string;
  name: { uk: string };
  landmark?: { uk: string };
  celebrationType: CelebrationType;
  mapPoint: { x: number; y: number };
  isCountryMain: boolean;
}

// ── 1.4 Event ──────────────────────────────────────────────────────────────

export type EventStatus = 'soon' | 'live' | 'ended' | 'recording';

export interface Event {
  id: string;
  cityId: string;
  zoneId: string;
  countryIso: string;
  midnightUtc: ISO;
  isMainCelebration: boolean;
  type: CelebrationType;
  popularity: number;
  restrained?: { note: { uk: string } };
  firstRow?: { saleEnabled: boolean };
}

/** Подія після завантаження: `midnightUtc` розібрано один раз (`Date.parse`). */
export interface ScheduledEvent extends Event {
  midnightMs: Ms;
}

export interface EventRuntime extends ScheduledEvent {
  status: EventStatus;
  /** now − midnightUtc, секунди (від’ємне до півночі). */
  t: Sec;
}

// ── 1.5–1.6 StreamSource, ланцюжок, тестова трансляція ─────────────────────

export type StreamPlatform = 'youtube' | 'facebook' | 'twitch';
export type StreamStatus = 'live' | 'expected' | 'possible';

export interface StreamSource {
  id: string;
  platform: StreamPlatform;
  videoId?: string;
  url: string;
  kind: 'main' | 'webcam' | 'tv';
  title: { uk: string };
  order: number;
  status: StreamStatus;
  startsAt?: ISO;
  embeddable: boolean;
  lastChecked: ISO;
  verified: boolean;
  isLive: boolean;
  replay?: { videoId?: string; url: string };
  isRecording?: boolean;
  test?: boolean;
  /** TestStreamExtra (1.6). */
  testNote?: string;
  alwaysOn?: boolean;
}

export interface TestStreamExtra {
  test: true;
  testNote?: string;
  alwaysOn: boolean;
}

export interface StreamChain {
  eventId: string;
  sources: StreamSource[];
}

// ── 1.7 FirstRowSeat ───────────────────────────────────────────────────────

export interface SeatParticipant {
  holderId: string;
  name: string;
  flagCode: string;
  greeting: string;
  emojiId: string;
  isMine?: boolean;
}

export type SeatState =
  | { state: 'free' }
  | { state: 'held'; until: Ms; holderId: string }
  | { state: 'taken'; takenAt: Ms; participant: SeatParticipant };

export type FirstRowSeat = { eventId: string; number: number } & SeatState;

export type PayResult = 'success' | 'pending' | 'declined' | 'soldout' | 'expired';

// ── 1.8–1.9 Chat ───────────────────────────────────────────────────────────

export type RoomId = 'world' | `country:${string}` | `firstrow:${string}`;

export interface ChatRoom {
  id: RoomId;
  kind: 'world' | 'country' | 'first-row';
  label: string;
  flagCode?: string;
  slowModeSec?: number;
  connection: 'ok' | 'slow' | 'unavailable' | 'offline';
  memberRule: 'public' | 'first-row-participants';
}

export type MessageKind = 'regular' | 'system' | 'greeting';
export type ReactionId =
  | 'clap'
  | 'heart'
  | 'glasses'
  | 'fireworks'
  | 'laugh'
  | 'hug'
  | 'party'
  | 'champagne'
  | 'sparkles'
  | 'pray'
  | 'loveeyes'
  | 'fire'
  | 'applause'
  | 'starstruck'
  | 'smile'
  | 'sad'
  | 'tree'
  | 'thumbs'
  | 'raised'
  | 'dancer'
  | 'dancing'
  | 'gift'
  | 'star'
  | 'earth'
  | 'yellowheart';
export type AuthorBadge = 'pass' | 'first-row' | 'vip';

export interface Author {
  id: string;
  nick: string;
  flagCode: string;
  badges: AuthorBadge[];
  firstRowEmojiId?: string;
  isMine?: boolean;
}

export type SystemPayload =
  | { kind: 'country-midnight'; countries: { iso: string; gender: Gender }[]; eventIds: string[] }
  | { kind: 'firstrow-joined'; participantName: string; flagCode: string; eventId: string; cityId: string }
  | { kind: 'greetings-counter'; count: number; flagCodes: string[]; eventId: string }
  | { kind: 'slow-mode'; seconds: number }
  | { kind: 'poll-open'; pollId: string };

export interface GreetingPayload {
  eventId: string;
  seat: number;
  participantName: string;
  flagCode: string;
  emojiId: string;
  cityId: string;
  text: string;
  /** Привітання власного місця гостя («це ти»). */
  mine?: boolean;
}

export interface ChatMessage {
  id: string;
  room: RoomId;
  kind: MessageKind;
  createdAt: Ms;
  author?: Author;
  text?: string;
  replyTo?: { id: string; nick: string; excerpt: string };
  reactions?: Partial<Record<ReactionId, { count: number; mine: boolean }>>;
  system?: SystemPayload;
  greeting?: GreetingPayload;
  moderation: 'ok' | 'hidden';
  /** Автор видалив повідомлення назавжди: у стрічці — тонкий рядок «видалено» (рішення власника 2026-10-29). */
  deleted?: boolean;
  /** Імітатор: коли автор видалить це повідомлення (інші люди теж видаляють свої). */
  deleteAt?: Ms;
}

// ── 1.10 Stamp, 1.11 Path ──────────────────────────────────────────────────

export type PresenceSource = 'country' | 'air' | 'room' | 'tv';

export interface Stamp {
  eventId: string;
  grantedAt: Ms;
  presenceSource: PresenceSource;
  firstRowSeat?: number;
  illustrationId: string;
  cityName: string;
  countryIso: string;
}

export interface PathPoint {
  eventId: string;
  cityId: string;
  countryIso: string;
  midnightUtc: ISO;
  planned: boolean;
  firstRowSeat?: number;
}

export interface Path {
  owner: { nick: string; flagCode: string; hasPass: boolean };
  visibleToOthers: boolean;
  points: PathPoint[];
}

// ── 2. Стан гостя й пропозицій ─────────────────────────────────────────────

export type OfferKind = 'pass-offer' | 'tips' | 'pass-gate' | 'pass-info';
export type NightId = '2026-27';

export interface OfferEntry {
  kind: OfferKind;
  triggerEventId: string;
  shownAt: Ms;
  dismissedAt?: Ms;
  acted?: 'primary' | 'details';
}

export interface OfferState {
  nightId: NightId;
  history: OfferEntry[];
  visible: OfferKind | null;
}

export interface GuestConsent {
  answered: boolean;
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  facebookVideo: boolean;
}

export interface GuestRoomWindow {
  slot: number;
  sourceId: string;
  eventId: string;
}

export interface GuestFirstRowEntry {
  seat?: number;
  hold?: { seat: number; until: Ms; extended: boolean };
  draft?: { name: string; greeting: string; emojiId?: string };
  priceLocked?: 4.99 | 7.99;
}

export type Stars = 1 | 2 | 3 | 4 | 5;

export interface GuestState {
  v: 1;
  id: string;
  locale: 'uk';
  detectedFlag?: string;
  nick?: string;
  flagCode?: string;
  consent: GuestConsent;
  reducedMotion: boolean;
  chatHidden: boolean;
  zoneStreamsCollapsed: boolean;
  chat: { lastRoom: RoomId; sentAt: Ms[] };
  room: { windows: GuestRoomWindow[]; soundSlot: number | null };
  stamps: Stamp[];
  /** Події, штамп яких гість прибрав «×» під плеєром (у паспорті лишається); скидається з новою ніччю. */
  stampsDismissed?: string[];
  pendingPresence: Record<string, { at: Ms; source: PresenceSource }>;
  rate: Record<string, { stars?: Stars; closed: boolean }>;
  offers: OfferState;
  schedule: string[];
  hasPass: boolean;
  firstRow: Record<string, GuestFirstRowEntry>;
  nightId: NightId;
}

// ── Файли даних (contracts/schedule.md, streams.md, chat.md) ───────────────

export interface EventNode {
  id: string;
  midnightUtc: ISO;
  isMainCelebration: boolean;
  type: CelebrationType;
  popularity: number;
  restrained?: { note: { uk: string } };
  firstRow?: { saleEnabled: boolean };
}

export interface CityNode {
  id: string;
  name: { uk: string };
  landmark?: { uk: string };
  celebrationType: CelebrationType;
  isCountryMain: boolean;
  mapPoint: { x: number; y: number };
  events: EventNode[];
}

export interface CountryNode {
  iso: string;
  cities: CityNode[];
}

export interface ZoneNode extends Zone {
  countries: CountryNode[];
}

export interface ScheduleFile {
  version: 1;
  season: '2026-27';
  generatedAt: ISO;
  tzdbVersion: string;
  zones: ZoneNode[];
}

export interface CountriesFile {
  version: 1;
  countries: Country[];
}

export interface StreamsFile {
  version: 1;
  season: '2026-27';
  generatedAt: ISO;
  lastCheckedAt: ISO | null;
  chains: StreamChain[];
}

export interface ScriptAuthor {
  id: string;
  nick: string;
  flagCode: string;
  badges: AuthorBadge[];
  path?: { eventId: string; planned: boolean }[];
  /** Автор з пасом вимкнув «Показувати мій шлях» — інші бачать «{нік} приховав свій шлях». */
  pathHidden?: boolean;
}

export interface AmbientRule {
  room: 'world' | 'country:*';
  ratePerMin: { idle: number; nearMidnight: number };
  pool: {
    authorId: string;
    text: string;
    replyToPoolIndex?: number;
    reactionsHint?: Partial<Record<ReactionId, number>>;
  }[];
}

export interface MomentScript {
  eventId: string;
  offsets: {
    atSec: number;
    room: RoomId | 'world+country';
    message:
      | { kind: 'system'; system: SystemPayload }
      | { kind: 'greeting'; seatFrom: 'seed' }
      | { kind: 'regular'; authorId: string; text: string }
      | { kind: 'burst'; count: number; spreadSec: number; pool: string };
  }[];
}

export interface FirstRowSeedEntry {
  eventId: string;
  seats: {
    number: number;
    state: 'free' | 'taken' | 'held';
    name?: string;
    flagCode?: string;
    greeting?: string;
    emojiId?: string;
    takenAtOffsetSec?: number;
    heldUntilOffsetSec?: number;
  }[];
  takeOverTime?: { number: number; atOffsetFromNowSec: number }[];
}

export interface ChatScriptFile {
  version: 1;
  season: '2026-27';
  authors: ScriptAuthor[];
  presets: { lang: 'uk' | 'en' | 'es' | 'fr'; flagCode: string; text: string }[];
  ambient: AmbientRule[];
  moments: MomentScript[];
  firstRowSeed: FirstRowSeedEntry[];
  slowMode?: { room: RoomId; seconds: number; from?: ISO; to?: ISO };
}

// ── Індекси після завантаження (lib/data/load.ts) ──────────────────────────

export interface LoadedZone extends Zone {
  midnightMs: Ms;
}

/** Усі події одного моменту півночі (слот ефіру), у порядку зростання `midnightMs`. */
export interface SlotGroup {
  midnightMs: Ms;
  midnightUtc: ISO;
  zoneId: string;
  events: ScheduledEvent[];
}

export interface Dataset {
  meta: { season: string; generatedAt: ISO; tzdbVersion: string };
  zones: LoadedZone[];
  zonesById: ReadonlyMap<string, LoadedZone>;
  countries: Country[];
  countriesByIso: ReadonlyMap<string, Country>;
  countriesBySlug: ReadonlyMap<string, Country>;
  cities: City[];
  citiesById: ReadonlyMap<string, City>;
  events: ScheduledEvent[];
  eventsById: ReadonlyMap<string, ScheduledEvent>;
  eventsBySlot: SlotGroup[];
  chainsByEventId: ReadonlyMap<string, StreamChain>;
}
