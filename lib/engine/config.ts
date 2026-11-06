/**
 * Спільні константи двигунів (`data-model.md`, розділ 3; EXPERIENCE «Час і відлік», 5.1).
 * Пізніше їх віддаватиме адмінка. Усі тривалості — у мс.
 */
const SEC = 1_000;
const MIN = 60 * SEC;

/** «Як святкувати» — за 15 хв до півночі. */
export const HOWTO_BEFORE = 15 * MIN;
/** Штамп, системне повідомлення, стіна — через 15 с після півночі. */
export const STAMP_DELAY = 15 * SEC;
/** Оцінка відкривається через 5 хв після півночі (рішення власника 2026-11-01: о +2 хв ще йде салют)… */
export const RATE_OPEN_AFTER = 5 * MIN;
/** …і триває 3 хв (закрито о +5 хв, якщо гість не взаємодіє). */
export const RATE_DURATION = 3 * MIN;
/** Пропозиції — не раніше ніж через 5 хв після події… */
export const OFFER_MIN_AFTER = 5 * MIN;
/** …і не пізніше ніж за 10 хв до наступної. */
export const OFFER_MIN_BEFORE_NEXT = 10 * MIN;
/** Ефір переходить до наступної події через 15 хв після півночі. */
export const HANDOVER_AFTER = 15 * MIN;
/** «Остання хвилина» — з +14 хв. */
export const LAST_MINUTE_FROM = 14 * MIN;
/** Продаж «Першого ряду» закривається за 5 хв до півночі (рішення власника 2026-10-31; було 15). */
export const FIRSTROW_SALE_CLOSE = 5 * MIN;
/** Відкриття продажу «Першого ряду». */
export const FIRSTROW_SALE_OPEN = Date.parse('2026-12-01T00:00:00Z');
/** Утримання місця — 600 с. */
export const HOLD_SEC = 600;
export const HOLD_MS = HOLD_SEC * SEC;
/** Місць «Першого ряду» в ряду поясу (ряд один на часовий пояс, рішення власника 2026-11-05). */
export const SEATS = 10;
/**
 * Ціна місця «Першого ряду», USD — одна для всіх місць (рішення власника 2026-11-05: стартова ціна; підвищувати
 * за попитом власник може вручну, лише тут). Автоматичного «≤3 місця → $7,99» більше немає.
 */
export const FIRSTROW_PRICE = 4.99;
/**
 * Ціна ряду за поясом, USD (власник 2026-11-06: ціни можуть різнитися між поясами й мають задаватися в адмінці).
 * Поки адмінки немає — тут; пояс без запису — `FIRSTROW_PRICE`. Ключ — `zoneId` поясу.
 */
export const FIRSTROW_PRICES: Readonly<Partial<Record<string, number>>> = {};

/** Ціна місця в ряду поясу `zoneId`. */
export function firstRowPrice(zoneId: string | undefined): number {
  return (zoneId ? FIRSTROW_PRICES[zoneId] : undefined) ?? FIRSTROW_PRICE;
}
/** «Мало місць» (стан `last3`): лічильник виділено, «останнє місце». На ціну не впливає. */
export const FEW_SEATS_THRESHOLD = 3;
/** «Запис» після півночі. **Припущення** (data-model 1.4). */
export const RECORDING_AFTER = 30 * MIN;
/** Продовження утримання, один раз. **Припущення** (data-model 1.7). */
export const HOLD_EXTENSION = 5 * MIN;
/** «Швидкий стрибок» машини часу «наступна подія»: північ наступного слота − 22 хв. */
export const NEXT_EVENT_JUMP = -22 * MIN;

// ── Допоміжні (не з таблиці data-model; уточнення реалізації) ─────────────

/** «відео може запізнюватися» — з −5 хв до +15 с (таблиця фаз 3.2). */
export const DELAY_NOTICE_FROM = 5 * MIN;
/** Пауза після останнього натискання клавіші в чаті, до якої пропозиції не з’являються (~10 с). */
export const TYPING_QUIET = 10 * SEC;
/** Попередження утримання зчитувачем: на 5 і 1 хв. */
export const HOLD_WARN_5 = 5 * MIN;
export const HOLD_WARN_1 = 1 * MIN;
/** «Ще 2 хвилини» + «Продовжити». */
export const HOLD_EXTEND_OFFER = 2 * MIN;
/** Тривалість загоряння стіни «Першого ряду» (стильова; під «зменшити рух» — 0). */
export const WALL_LIGHTING_MS = 5 * SEC;
