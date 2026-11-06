/**
 * Логіка «Першого ряду» поза React-рендером (T112/T116): імітація місць на момент `now`, утримання, результат
 * імітованої оплати, «час утримання вийшов», підтвердження «очікування», наслідки успіху.
 * Читає й пише стан через `getState()`, тож працює однаково з модуля, вікна й таймерів.
 */
import type { ChatMessage, FirstRowSeat, Ms, RoomId, ScheduledEvent } from '@/lib/data/types';
import { CHAT_SCRIPT } from '@/lib/chat-sim/useChatSimulator';
import { messageId } from '@/lib/chat-sim/simulator';
import { useChatFeed } from '@/lib/chat-sim/store';
import { STAMP_DELAY } from '@/lib/engine/config';
import { firstRowView, type FirstRowView } from '@/lib/engine/firstRowView';
import { confirmPending, releaseHold, settle, startHold } from '@/lib/firstrow/pay';
import { firstFreeSeat, simulateSeats } from '@/lib/firstrow/seatsSim';
import { applyOutcome, emptyFlow, readEntry, useFirstRowStore, writeEntry } from '@/stores/firstRow';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';
import { getData } from '@/lib/data/load';
import { seatConflict } from '@/lib/firstrow/rooms';
import { zoneRows } from '@/lib/firstrow/zone';

export const FIRST_ROW_WINDOW_ID = 'O-FIRST-ROW';
export const FIRST_ROW_INFO_ID = 'O-FIRST-ROW-INFO';
export const FIRST_ROW_MORE_ID = 'O-FIRST-ROW-MORE';

/** Ряд поясу — подія-носій (`lib/firstrow/zone`). */
export type FirstRowEvent = Pick<ScheduledEvent, 'id' | 'cityId' | 'zoneId' | 'midnightUtc' | 'midnightMs' | 'restrained' | 'firstRow'>;

export interface FirstRowSnapshot {
  seats: FirstRowSeat[];
  holdLost: boolean;
  view: FirstRowView;
}

/** Чи дає пас знижку (лише куплений; подарований першою покупкою — ні). */
export function boughtPassNow(): boolean {
  return useGuestStore.getState().hasPass && !useFirstRowStore.getState().passGifted;
}

/** Місця й вигляд модуля на момент `now` зі свіжого стану сторів. */
export function snapshot(event: FirstRowEvent, now: Ms, opts: { reducedMotion?: boolean; ignoreHold?: boolean } = {}): FirstRowSnapshot {
  const g = useGuestStore.getState();
  // Без запису в стор (можна викликати з рендера); `ensureSim` — у діях і ефекті модуля.
  const simStart = useFirstRowStore.getState().simStart[event.id] ?? now;
  const seed = CHAT_SCRIPT.firstRowSeed.find((s) => s.eventId === event.id);
  const raw = g.firstRow[event.id] ?? {};
  const entry = opts.ignoreHold ? releaseHold(raw) : raw;
  const flagCode = g.flagCode ?? g.detectedFlag;
  const { seats, holdLost } = simulateSeats(seed, event.id, simStart, now, { id: g.id, nick: g.nick, flagCode, entry });
  const view = firstRowView(now, event, seats, { ...entry, id: g.id, hasPass: boughtPassNow() }, { reducedMotion: opts.reducedMotion });
  return { seats, holdLost, view };
}

export type OpenResult = 'success' | 'form' | 'returned' | 'pending' | 'soldout' | 'closed' | 'blocked';

/** Подія, де в гостя вже є місце (або утримання) в тому ж поясі, місті чи країні — купівля на `event` заблокована. */
export function blockingEvent(event: Pick<FirstRowEvent, 'id'>, now: Ms) {
  const data = getData();
  const target = data.eventsById.get(event.id);
  if (!target) return null;
  return seatConflict(zoneRows(data), useGuestStore.getState().firstRow, target, now);
}

/** «Зайняти місце»: нове утримання (або повернення до наявного), фіксація ціни. */
export function openForm(event: FirstRowEvent, now: Ms): OpenResult {
  const store = useFirstRowStore.getState();
  store.ensureSim(event.id, now);
  const entry = readEntry(event.id);
  if (entry.seat !== undefined) {
    store.setFlow(emptyFlow(event.id, 'success'));
    return 'success';
  }
  if (store.flow?.eventId === event.id && store.flow.phase === 'pending') return 'pending';
  if (blockingEvent(event, now)) return 'blocked';
  if (entry.hold && entry.hold.until > now) {
    store.setFlow({ ...emptyFlow(event.id, 'form'), returned: true });
    return 'returned';
  }
  const { seats, view } = snapshot(event, now, { ignoreHold: true });
  if (view.state === 'closed' || view.state === 'restrained') return 'closed';
  const price = view.price.current;
  const res = startHold(releaseHold(entry), firstFreeSeat(seats, now), now, price ?? view.price.full);
  if (!res.ok || price === null) {
    store.setFlow(emptyFlow(event.id, 'soldout'));
    return 'soldout';
  }
  writeEntry(event.id, res.entry);
  store.setFlow(emptyFlow(event.id, 'form'));
  return 'form';
}

/** Утримання минуло з відкритою формою: «Час утримання вийшов — місце знову вільне» і нове утримання з новою ціною. */
export function expireHold(event: FirstRowEvent, now: Ms): void {
  const store = useFirstRowStore.getState();
  const prev = readEntry(event.id);
  const { seats, view } = snapshot(event, now, { ignoreHold: true });
  const seat = firstFreeSeat(seats, now);
  const price = view.price.current;
  const res = startHold(releaseHold(prev), seat, now, price ?? view.price.full);
  if (!res.ok || price === null) {
    applyOutcome(event.id, { phase: 'soldout', entry: releaseHold(prev) }, now);
    return;
  }
  writeEntry(event.id, res.entry);
  store.patchFlow({
    phase: 'expired',
    returned: false,
    submitting: false,
    expired: { free: view.freeCount, price, until: res.entry.hold!.until, priceChanged: prev.priceLocked !== undefined && prev.priceLocked !== price },
  });
}

/** Результат імітованої оплати (`stores/testControls.payResult`, за замовчуванням `success`). */
export function settlePayment(event: FirstRowEvent, now: Ms): void {
  const { holdLost } = snapshot(event, now);
  const outcome = settle(useTestControls.getState().payResult, readEntry(event.id), { now, holdLost });
  applyOutcome(event.id, outcome, now);
  if (outcome.phase === 'success') afterSuccess(event, now);
  else if (outcome.phase === 'expired') expireHold(event, now);
}

/** «Чекаємо підтвердження» → підтверджено. */
export function confirmPayment(event: FirstRowEvent, now: Ms): void {
  const { holdLost } = snapshot(event, now);
  const outcome = confirmPending(readEntry(event.id), { now, holdLost });
  applyOutcome(event.id, outcome, now);
  if (outcome.phase === 'success') afterSuccess(event, now);
}

function participantOf(eventId: string) {
  const g = useGuestStore.getState();
  const entry = g.firstRow[eventId] ?? {};
  return {
    seat: entry.seat,
    name: entry.draft?.name || g.nick || '',
    greeting: entry.draft?.greeting ?? '',
    emojiId: entry.draft?.emojiId ?? 'glasses',
    flagCode: g.flagCode ?? g.detectedFlag ?? '',
  };
}

/** Після підтвердження: пас у подарунок, системне повідомлення в чаті «Світ» і в кімнаті «Перший ряд». */
export function afterSuccess(event: FirstRowEvent, now: Ms): void {
  const g = useGuestStore.getState();
  if (!g.hasPass) {
    useFirstRowStore.getState().markPassGifted();
    g.setHasPass(true);
  }
  const p = participantOf(event.id);
  if (p.seat === undefined) return;
  const rooms: RoomId[] = ['world', `firstrow:${event.id}`];
  const messages: ChatMessage[] = rooms.map((room) => ({
    id: messageId(now, 900, p.seat!, room),
    room,
    kind: 'system',
    createdAt: now,
    moderation: 'ok',
    system: { kind: 'firstrow-joined', participantName: p.name, flagCode: p.flagCode, eventId: event.id, cityId: event.cityId },
  }));
  useChatFeed.getState().append(messages);
}

/**
 * «<ім’я> тепер у першому ряду · <місто>» для чужих місць, зайнятих у проміжку `(since, now]` (імітатор: розклад
 * місць і «гонки»). Своє місце гість отримує через `afterSuccess`. Id повідомлення стабільний — повторів немає.
 */
export function seatJoinedMessages(event: FirstRowEvent, seats: readonly FirstRowSeat[], since: Ms, now: Ms): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const seat of seats) {
    if (seat.state !== 'taken' || seat.participant.isMine) continue;
    if (seat.takenAt <= since || seat.takenAt > now) continue;
    for (const room of ['world', `firstrow:${event.id}`] as RoomId[]) {
      out.push({
        id: messageId(seat.takenAt, 902, seat.number, room),
        room,
        kind: 'system',
        createdAt: seat.takenAt,
        moderation: 'ok',
        system: {
          kind: 'firstrow-joined',
          participantName: seat.participant.name,
          flagCode: seat.participant.flagCode,
          eventId: event.id,
          cityId: event.cityId,
        },
      });
    }
  }
  return out;
}

/** Привітання гостя-учасника на «+15 с» — синхронно зі стіною (картка `first-row-greeting`). */
export function guestGreetingMessages(event: FirstRowEvent): ChatMessage[] {
  const p = participantOf(event.id);
  if (p.seat === undefined) return [];
  const createdAt = event.midnightMs + STAMP_DELAY;
  const rooms: RoomId[] = ['world', `firstrow:${event.id}`];
  return rooms.map((room) => ({
    id: messageId(createdAt, 901, p.seat!, room),
    room,
    kind: 'greeting',
    createdAt,
    moderation: 'ok',
    greeting: { eventId: event.id, seat: p.seat!, participantName: p.name, flagCode: p.flagCode, emojiId: p.emojiId, cityId: event.cityId, text: p.greeting, mine: true },
  }));
}
