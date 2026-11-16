/**
 * Ядро імітатора чату (T074, FR-056, `contracts/chat.md`). Чисті функції: «зараз» приходить аргументом
 * від `TimeSource` (через спільний годинник), годинник пристрою не читається.
 *
 * У US1 — лише `moments` сценарію `data/chat-script.json`: системне `country-midnight` на «+15 с» (тієї самої миті,
 * що й `moment:stamp`), `greetings-counter`, репліки й сплески навколо півночі. Фоновий потік (`ambient`), повільний
 * режим і відправлення — у US4. Привітання місць «Першого ряду» прибрано разом із рядом (рішення 2026-11-12).
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
import { getData } from '@/lib/data/load';
import { ratingState } from '@/lib/api/sim/rating';
import type { ToastRecord } from '@/lib/toast/feed';
import { toastGreetingMessages } from '@/lib/toast/greeting';
import { simulatedToasts } from '@/lib/toast/worldToasts';
import { toastMessage, toastRooms } from '@/lib/chat/toast';
import { compareMessages, messageId } from '@/lib/chat/message';
// Чисті id й порядок повідомлень — у `lib/chat/message` (реекспорт для імітатора й тестів).
export { compareMessages, messageId };

/** Що відбувається опівночі одного слота ефіру: подія, для якої настала північ, і її країни. */
export interface MomentContext {
  /** Північ слота (мс). */
  t0: Ms;
  /** Подія, за якою заповнюються порожні поля сценарію (лічильник). */
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
  /** Фоновий потік `ambient` і системне `slow-mode` (US4). За замовчуванням вимкнено — лише моменти. */
  ambient?: boolean;
  /** Поточна швидкість часу («машина часу»); потік не перевищує 40 повідомлень/с реального часу на кімнату. */
  getSpeed?: () => number;
  /** Свої тости гостя (`stores/toast`): у чаті «Світ» після перезавантаження й у привітанні опівночі. */
  ownToasts?: () => readonly ToastRecord[];
}

export interface ChatSimulator {
  /** Нові повідомлення з `(попередній виклик, now]`; перемотка назад нічого не повторює. */
  advance(now: Ms): ChatMessage[];
}

export const DEFAULT_BACKFILL_MS = 10 * 60_000;
export const DEFAULT_MAX_BATCH = 200;
/** Біля півночі (|t| ≤ 5 хв) частота `nearMidnight`. */
export const NEAR_MIDNIGHT_MS = 5 * 60_000;
/** Стеля фонового потоку, повідомлень/с реального часу на кімнату (`contracts/chat.md`). */
export const MAX_AMBIENT_PER_SEC = 40;
/** Скільки фонових повідомлень на одне, яке автор згодом видалить (імітація; рішення власника 2026-10-29). */
export const DELETE_ONE_IN = 12;

// ── ULID-подібні ідентифікатори ────────────────────────────────────────────

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

  for (const script_ of script.moments) {
    if (script_.eventId !== '*' && script_.eventId !== moment.eventId) continue;
    script_.offsets.forEach((offset, offsetIndex) => {
      const createdAt = moment.t0 + offset.atSec * 1_000;
      const msg = offset.message;
      if (!roomsOf(offset.room, moment).includes(room)) return;
      const base = { room, moderation: 'ok' as const };

      switch (msg.kind) {
        case 'system':
          out.push({ ...base, id: messageId(createdAt, offsetIndex, 0, room), kind: 'system', createdAt, system: fillSystem(msg.system, moment) });
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

// ── Фоновий потік і повільний режим (US4) ──────────────────────────────────

function hash32(a: number, b: string): number {
  let h = (2166136261 ^ a) >>> 0;
  for (let i = 0; i < b.length; i++) {
    h ^= b.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

function ruleFor(script: ChatScriptFile, room: RoomId) {
  if (room === 'world') return script.ambient.find((r) => r.room === 'world');
  if (room.startsWith('country:')) return script.ambient.find((r) => r.room === 'country:*');
  return undefined;
}

function nearMidnight(moments: readonly MomentContext[], t: Ms): boolean {
  for (const m of moments) if (Math.abs(t - m.t0) <= NEAR_MIDNIGHT_MS) return true;
  return false;
}

/** Початок ночі, від якого рахуємо порядкові номери ambient-реплік. */
const ORDINAL_ORIGIN_SEC = Math.floor(Date.UTC(2026, 11, 31) / 1_000);
const ordinalCaches = new Map<string, { hours: Int32Array[]; base: number[] }>();

/** Скільки ambient-реплік було від початку ночі до початку секунди `sec` (кеш по годинах). */
function ordinalFor(key: string, countAt: (sec: number) => number): (sec: number) => number {
  let cache = ordinalCaches.get(key);
  if (!cache) {
    if (ordinalCaches.size > 40) ordinalCaches.clear();
    cache = { hours: [], base: [0] };
    ordinalCaches.set(key, cache);
  }
  const c = cache;
  const hour = (h: number): Int32Array => {
    while (c.hours.length <= h) {
      const i = c.hours.length;
      const prefix = new Int32Array(3_601);
      for (let k = 0; k < 3_600; k++) prefix[k + 1] = prefix[k]! + countAt(ORDINAL_ORIGIN_SEC + i * 3_600 + k);
      c.hours.push(prefix);
      c.base.push(c.base[i]! + prefix[3_600]!);
    }
    return c.hours[h]!;
  };
  return (sec) => {
    const rel = sec - ORDINAL_ORIGIN_SEC;
    if (rel < 0 || rel > 14 * 86_400) return Math.abs(hash32(sec, key)) % 1_000_003;
    const h = Math.floor(rel / 3_600);
    const prefix = hour(h);
    return c.base[h]! + prefix[rel - h * 3_600]!;
  };
}

/**
 * Фоновий потік кімнати за `ambient`-правилами: час ділиться на секундні відра, у кожному кількість повідомлень і вибір
 * з `pool` визначає хеш (кімната, секунда) — перемотка повертає ті самі повідомлення з тими самими `id`.
 */
export function ambientBetween(
  script: ChatScriptFile,
  moments: readonly MomentContext[],
  rooms: readonly RoomId[],
  from: Ms,
  to: Ms,
  speed = 1,
): ChatMessage[] {
  if (to <= from) return [];
  const out: ChatMessage[] = [];
  const cap = MAX_AMBIENT_PER_SEC / Math.max(1, speed);
  for (const room of rooms) {
    const rule = ruleFor(script, room);
    if (!rule) continue;
    const pool = rule.pool;
    if (!pool.length) continue;
    // Скільки повідомлень у секундному відрі — чиста функція (id стабільні при перемотці).
    const countAt = (sec: number): number => {
      const rate = nearMidnight(moments, sec * 1_000) ? rule.ratePerMin.nearMidnight : rule.ratePerMin.idle;
      const p = Math.min(rate / 60, cap);
      let n = Math.floor(p);
      if ((hash32(sec, room) % 10_000) / 10_000 < p - n) n += 1;
      return n;
    };
    // Порядковий номер репліки від фіксованого початку ночі; репліки беруться з пулу «колами» (перемішаний пул на коло),
    // тож однакова репліка не йде поспіль і не повторюється, доки не вичерпано пул.
    const ordinalAt = ordinalFor(`${room}|${cap}|${moments.map((m) => m.t0).join(',')}`, countAt);
    const cycleOrder = (cycle: number): number[] => {
      const order = pool.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const k = hash32(cycle * 977 + i, room) % (i + 1);
        [order[i], order[k]] = [order[k]!, order[i]!];
      }
      return order;
    };
    const pickIndex = (ord: number): number => {
      const len = pool.length;
      const cycle = Math.floor(ord / len);
      const order = cycleOrder(cycle);
      if (len > 2 && ord % len < 2 && cycleOrder(cycle - 1)[len - 1] === order[0]) [order[0], order[1]] = [order[1]!, order[0]!];
      return order[((ord % len) + len) % len]!;
    };
    for (let sec = Math.floor(from / 1_000); sec <= Math.floor(to / 1_000); sec++) {
      const n = countAt(sec);
      for (let j = 0; j < n; j++) {
        const hj = hash32(sec * 31 + j + 1, room);
        // Повідомлення відра йдуть у порядку j (хронологія збігається з порядком пулу).
        const slot = Math.max(1, Math.floor(1_000 / n));
        const createdAt = sec * 1_000 + Math.min(999, j * slot + (hj % slot));
        if (createdAt <= from || createdAt > to) continue;
        const idx = pickIndex(ordinalAt(sec) + j);
        const item = pool[idx]!;
        const author = authorOf(script, item.authorId);
        if (!author) continue;
        const reply = item.replyToPoolIndex !== undefined ? pool[item.replyToPoolIndex] : undefined;
        // Приблизно кожне 12-те повідомлення (крім відповідей) автор видаляє за 15–45 с — у стрічці лишається рядок «видалено».
        const deletes = !reply && hash32(createdAt, `del:${room}`) % DELETE_ONE_IN === 0;
        const replyAuthor = reply ? authorOf(script, reply.authorId) : undefined;
        out.push({
          id: messageId(createdAt, 1_024 + j, idx, room),
          room,
          kind: 'regular',
          createdAt,
          author,
          text: item.text,
          moderation: 'ok',
          ...(deletes ? { deleteAt: createdAt + 15_000 + (hj % 31) * 1_000 } : {}),
          ...(reply && replyAuthor
            ? { replyTo: { id: `ambient:${room}:${item.replyToPoolIndex}`, nick: replyAuthor.nick, excerpt: reply.text.slice(0, 60) } }
            : {}),
          ...(item.reactionsHint
            ? {
                reactions: Object.fromEntries(
                  Object.entries(item.reactionsHint).map(([k, count]) => [k, { count: count ?? 0, mine: false }]),
                ),
              }
            : {}),
        });
      }
    }
  }
  return out;
}

/** Повільний режим кімнати в момент `now`, с (0 — вимкнено): `slowMode` сценарію з вікном `from…to`. */
export function slowSecondsAt(script: ChatScriptFile, room: RoomId, now: Ms): number {
  const s = script.slowMode;
  if (!s || s.room !== room) return 0;
  const from = s.from ? Date.parse(s.from) : -Infinity;
  const to = s.to ? Date.parse(s.to) : Infinity;
  return now >= from && now < to ? s.seconds : 0;
}

/** Системне `slow-mode` на початку вікна повільного режиму. */
export function slowModeMessages(script: ChatScriptFile, rooms: readonly RoomId[], from: Ms, to: Ms): ChatMessage[] {
  const s = script.slowMode;
  if (!s?.from || !rooms.includes(s.room)) return [];
  const at = Date.parse(s.from);
  if (!(at > from && at <= to)) return [];
  return [
    {
      id: messageId(at, 2_000, 0, s.room),
      room: s.room,
      kind: 'system',
      createdAt: at,
      system: { kind: 'slow-mode', seconds: s.seconds },
      moderation: 'ok',
    },
  ];
}

/**
 * «Новий лідер рейтингу святкувань» у «Світі» (рішення власника 2026-11-07): щогодини (на початку години UTC) імітатор
 * дивиться, хто перший у рейтингу, і пише, лише коли лідер змінився — не частіше разу на годину.
 */
export function ratingLeaderMessages(rooms: readonly RoomId[], from: Ms, to: Ms): ChatMessage[] {
  if (!rooms.includes('world') || to <= from) return [];
  const HOUR = 3_600_000;
  const data = getData();
  const leader = (at: Ms) => ratingState(data, at, {}).rows[0];
  const out: ChatMessage[] = [];
  for (let at = Math.ceil(from / HOUR) * HOUR; at <= to; at += HOUR) {
    if (at <= from) continue;
    const cur = leader(at);
    const prev = leader(at - HOUR);
    if (!cur || cur.eventId === prev?.eventId) continue;
    out.push({
      id: messageId(at, 3_000, 0, 'world'),
      room: 'world',
      kind: 'system',
      createdAt: at,
      system: { kind: 'rating-leader', eventId: cur.eventId, city: cur.city, flagCode: cur.flagCode, score: Math.round(cur.score * 10) / 10 },
      moderation: 'ok',
    });
  }
  return out;
}

/**
 * Тости в чаті (рішення власника 2026-11-12): золоті тости в «Світі» — імітовані інших глядачів (лише тестова й
 * демо-збірка, `simulatedToasts`) і свої (`own`), — та привітання опівночі поясу з ніками тих, хто сказав тост на $10.
 */
export function worldToastMessages(
  script: ChatScriptFile,
  rooms: readonly RoomId[],
  from: Ms,
  to: Ms,
  own: readonly ToastRecord[] = [],
): ChatMessage[] {
  if (to <= from) return [];
  const data = getData();
  const all = [...simulatedToasts(script, data, to), ...own];
  const out = toastGreetingMessages(data, rooms, from, to, all);
  for (const t of all) {
    if (t.createdAt <= from || t.createdAt > to) continue;
    // Свій тост іде ще й у чати країн, де його сказано (`ToastRecord.countries`); у кожній кімнаті — своє повідомлення.
    for (const room of toastRooms(t)) if (rooms.includes(room)) out.push(toastMessage(t, undefined, room));
  }
  return out;
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
      if (opts.ambient) {
        // Після стрибка часу фон не відтворюємо за години назад: лише останній проміжок `backfill`.
        const ambientFrom = Math.max(from, now - backfill);
        batch.push(
          ...ambientBetween(opts.script, opts.moments, opts.rooms, ambientFrom, now, opts.getSpeed?.() ?? 1),
          ...slowModeMessages(opts.script, opts.rooms, from, now),
          ...ratingLeaderMessages(opts.rooms, from, now),
          ...worldToastMessages(opts.script, opts.rooms, from, now, opts.ownToasts?.() ?? []),
        );
        batch.sort(compareMessages);
      }
      return batch.length > maxBatch ? batch.slice(-maxBatch) : batch;
    },
  };
}
