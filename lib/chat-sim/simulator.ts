/**
 * Ядро імітатора чату (T074, FR-056, `contracts/chat.md`). Чисті функції: «зараз» приходить аргументом
 * від `TimeSource` (через спільний годинник), годинник пристрою не читається.
 *
 * У US1 — лише `moments` сценарію `data/chat-script.json`: системне `country-midnight` і привітання
 * «Першого ряду» на «+15 с» (тієї самої миті, що й `moment:stamp`), `greetings-counter`, репліки й сплески навколо
 * півночі. Фоновий потік (`ambient`), повільний режим і відправлення — у US4.
 *
 * Формат повідомлень — `ChatMessage` (`data-model.md` 1.9), той самий, що прийде з Centrifugo.
 * `id` — ULID-подібний (26 символів Crockford base32): час + послідовність, тож порядок `(createdAt, id)` сталий.
 */
import type {
  Author,
  ChatMessage,
  ChatScriptFile,
  Country,
  Event,
  Gender,
  Ms,
  RoomId,
  SlotGroup,
  StreamChain,
  SystemPayload,
} from '@/lib/data/types';
import { airSlots, pickSlotEvent } from '@/lib/engine/currentAirEvent';

/** Що відбувається опівночі одного слота ефіру: подія, для якої настала північ, і її країни. */
export interface MomentContext {
  /** Північ слота (мс). */
  t0: Ms;
  /** Подія, за якою заповнюються порожні поля сценарію (привітання, лічильник). */
  eventId: string;
  cityId: string;
  /** Для `country-midnight` (без відмінювання назв: рядок збирає i18n за родом). */
  countries: { iso: string; gender: Gender }[];
  eventIds: string[];
}

export interface SimulatorOptions {
  script: ChatScriptFile;
  moments: readonly MomentContext[];
  /** Кімнати, які слухає сторінка (головна — `world`; країна — `world` і `country:<ISO>`). */
  rooms: readonly RoomId[];
  /** Перший виклик `advance` показує повідомлення за цей проміжок назад (щоб чат не був порожнім). */
  backfillMs?: number;
  /** Скільки повідомлень віддавати щонайбільше за раз (решта — найстаріші — відкидаються). */
  maxBatch?: number;
}

export interface ChatSimulator {
  /** Нові повідомлення з `(попередній виклик, now]`; перемотка назад нічого не повторює. */
  advance(now: Ms): ChatMessage[];
}

export const DEFAULT_BACKFILL_MS = 10 * 60_000;
export const DEFAULT_MAX_BATCH = 200;

// ── ULID-подібні ідентифікатори ────────────────────────────────────────────

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeBase32(value: number, length: number): string {
  let out = '';
  let v = Math.max(0, Math.floor(value));
  for (let i = 0; i < length; i++) {
    out = CROCKFORD[v % 32] + out;
    v = Math.floor(v / 32);
  }
  return out;
}

function hashRoom(room: string): number {
  let h = 0;
  for (let i = 0; i < room.length; i++) h = (h * 31 + room.charCodeAt(i)) % 1_048_576; // 32^4
  return h;
}

/**
 * Детермінований ULID-подібний id: 10 символів часу + 16 символів послідовності
 * (номер репліки в моменті, номер у сплеску/привітаннях, кімната). Той самий момент → той самий id.
 */
export function messageId(createdAt: Ms, offsetIndex: number, sub: number, room: string): string {
  return encodeBase32(createdAt, 10) + encodeBase32(offsetIndex, 4) + encodeBase32(sub, 4) + encodeBase32(0, 4) + encodeBase32(hashRoom(room), 4);
}

// ── Моменти з розкладу ─────────────────────────────────────────────────────

export interface MomentData {
  eventsBySlot: readonly SlotGroup[];
  countriesByIso: ReadonlyMap<string, Pick<Country, 'popularity' | 'gender'>>;
  chainsByEventId: ReadonlyMap<string, StreamChain>;
}

/**
 * Моменти для всіх слотів ефіру: подія слота — та сама, що бере ефір (`pickSlotEvent` на «+15 с»),
 * тож системне повідомлення називає країну, яку людина бачить у плеєрі.
 */
export function buildMomentContexts(data: MomentData): MomentContext[] {
  return airSlots(data).map((slot) => {
    const pick = pickSlotEvent(slot.midnightMs + 15_000, slot.events, data.countriesByIso, data.chainsByEventId);
    const event: Pick<Event, 'id' | 'cityId' | 'countryIso'> = pick?.event ?? slot.events[0]!;
    return {
      t0: slot.midnightMs,
      eventId: event.id,
      cityId: event.cityId,
      countries: [{ iso: event.countryIso, gender: data.countriesByIso.get(event.countryIso)?.gender ?? null }],
      eventIds: [event.id],
    };
  });
}

// ── Розгортання сценарію ───────────────────────────────────────────────────

function roomsOf(target: RoomId | 'world+country', moment: MomentContext): RoomId[] {
  if (target === 'world+country') return ['world', ...moment.countries.map((c) => `country:${c.iso}` as RoomId)];
  return [target];
}

function authorOf(script: ChatScriptFile, authorId: string): Author | undefined {
  const a = script.authors.find((x) => x.id === authorId);
  return a ? { id: a.id, nick: a.nick, flagCode: a.flagCode, badges: [...a.badges] } : undefined;
}

function fillSystem(system: SystemPayload, moment: MomentContext): SystemPayload {
  switch (system.kind) {
    case 'country-midnight':
      return {
        kind: 'country-midnight',
        countries: system.countries.length ? system.countries : moment.countries,
        eventIds: system.eventIds.length ? system.eventIds : moment.eventIds,
      };
    case 'greetings-counter':
      return { ...system, flagCodes: [...system.flagCodes], eventId: system.eventId || moment.eventId };
    default:
      return { ...system };
  }
}

/** Усі повідомлення одного моменту для однієї кімнати, у порядку `(createdAt, id)`. */
export function momentMessages(script: ChatScriptFile, moment: MomentContext, room: RoomId): ChatMessage[] {
  const out: ChatMessage[] = [];
  const seed = script.firstRowSeed.find((s) => s.eventId === moment.eventId);
  const seatsTaken = (seed?.seats ?? [])
    .filter((s) => s.state === 'taken' && s.name)
    .sort((a, b) => a.number - b.number);

  for (const script_ of script.moments) {
    if (script_.eventId !== '*' && script_.eventId !== moment.eventId) continue;
    let greetingIndex = 0;
    script_.offsets.forEach((offset, offsetIndex) => {
      const createdAt = moment.t0 + offset.atSec * 1_000;
      const msg = offset.message;
      const isGreeting = msg.kind === 'greeting';
      const seat = isGreeting ? seatsTaken[greetingIndex++] : undefined;
      if (!roomsOf(offset.room, moment).includes(room)) return;
      const base = { room, moderation: 'ok' as const };

      switch (msg.kind) {
        case 'system':
          out.push({ ...base, id: messageId(createdAt, offsetIndex, 0, room), kind: 'system', createdAt, system: fillSystem(msg.system, moment) });
          break;
        case 'greeting':
          if (!seat) return; // вільне місце — привітання немає
          out.push({
            ...base,
            id: messageId(createdAt, offsetIndex, seat.number, room),
            kind: 'greeting',
            createdAt,
            greeting: {
              eventId: moment.eventId,
              seat: seat.number,
              participantName: seat.name!,
              flagCode: seat.flagCode ?? 'earth',
              emojiId: seat.emojiId ?? 'glasses',
              cityId: moment.cityId,
              text: seat.greeting ?? '',
            },
          });
          break;
        case 'regular': {
          const author = authorOf(script, msg.authorId);
          if (!author) return;
          out.push({ ...base, id: messageId(createdAt, offsetIndex, 0, room), kind: 'regular', createdAt, author, text: msg.text });
          break;
        }
        case 'burst': {
          const pool = script.ambient.find((r) => r.room === msg.pool || (msg.pool === 'country' && r.room === 'country:*'))?.pool ?? [];
          if (!pool.length) return;
          for (let i = 0; i < msg.count; i++) {
            const item = pool[i % pool.length]!;
            const author = authorOf(script, item.authorId);
            if (!author) continue;
            const at = createdAt + Math.floor((i * msg.spreadSec * 1_000) / Math.max(1, msg.count));
            out.push({ ...base, id: messageId(at, offsetIndex, i + 1, room), kind: 'regular', createdAt: at, author, text: item.text });
          }
          break;
        }
      }
    });
  }
  return out.sort(compareMessages);
}

export function compareMessages(a: ChatMessage, b: ChatMessage): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Межі моменту відносно `t0` (мс), щоб не розгортати далекі моменти. */
function momentSpan(script: ChatScriptFile): { from: number; to: number } {
  let from = 0;
  let to = 0;
  for (const m of script.moments) {
    for (const o of m.offsets) {
      const start = o.atSec * 1_000;
      const end = start + (o.message.kind === 'burst' ? o.message.spreadSec * 1_000 : 0);
      from = Math.min(from, start);
      to = Math.max(to, end);
    }
  }
  return { from, to };
}

/** Повідомлення кімнат `rooms` із `createdAt ∈ (from, to]`. */
export function messagesBetween(
  script: ChatScriptFile,
  moments: readonly MomentContext[],
  rooms: readonly RoomId[],
  from: Ms,
  to: Ms,
): ChatMessage[] {
  if (to <= from) return [];
  const span = momentSpan(script);
  const out: ChatMessage[] = [];
  for (const moment of moments) {
    if (moment.t0 + span.to <= from || moment.t0 + span.from > to) continue;
    for (const room of rooms) {
      for (const m of momentMessages(script, moment, room)) if (m.createdAt > from && m.createdAt <= to) out.push(m);
    }
  }
  return out.sort(compareMessages);
}

export function createChatSimulator(opts: SimulatorOptions): ChatSimulator {
  const backfill = opts.backfillMs ?? DEFAULT_BACKFILL_MS;
  const maxBatch = opts.maxBatch ?? DEFAULT_MAX_BATCH;
  let prev: Ms | null = null;
  return {
    advance(now) {
      const from = prev === null ? now - backfill : prev;
      if (now < from) {
        // Перемотка назад: нічого не повторюємо, рахуємо далі від нового «зараз».
        prev = now;
        return [];
      }
      prev = now;
      const batch = messagesBetween(opts.script, opts.moments, opts.rooms, from, now);
      return batch.length > maxBatch ? batch.slice(-maxBatch) : batch;
    },
  };
}
