/** Ukrainian texts of the refusal reasons the first-screen slices show (pure, no React). */
const REASONS: Record<string, string> = {
  'changed-since': 'Запис уже змінили після того, як ви його відкрили. Оновіть сторінку й повторіть.',
  'not-revertible': 'Цю зміну не можна скасувати.',
  'correction-out-of-range': 'Момент поза допустимим діапазоном (±60 хв від базового).',
  'main-required': 'У парі має лишитися головне святкування.',
  'warnings-not-confirmed': 'Попередження потрібно підтвердити.',
  'unknown-event': 'Такої події немає в каталозі.',
  'invalid-input': 'Дані не прийнято: перевірте поля.',
  'end-not-after-start': 'Кінець вікна має бути після початку.',
  overlaps: 'Вікно перетинається з іншим вікном.',
  'invalid-kyiv-time': 'Час має бути у форматі РРРР-ММ-ДДTГГ:ХХ (Київ).',
  'pair-without-main': 'У парі країна × пояс не лишиться видимої події: головне святкування буде сховано.',
  forbidden: 'Недостатньо прав.',
  not_found: 'Запис не знайдено.',
};

/** Texts of the «Стан сайту» slice (SPEC-08 AC-17). */
export const SITE_TEXT = {
  title: 'Стан сайту',
  version: 'Версія',
  reason: 'Причина (обов’язкова, до 200 символів)',
  reasonRequired: 'Вкажіть причину зміни.',
  on: 'увімкнено',
  off: 'вимкнено',
  turnOn: 'Увімкнути',
  turnOff: 'Вимкнути',
  noProducts: 'Товарів ще немає — ціни з’являться після підключення PayPro (SPEC-17)',
  products: 'Ціни',
  loading: 'Завантаження…',
  unavailable: 'Стан сайту недоступний.',
  saved: 'Збережено.',
  rooms: 'Кімнати чату',
  roomName: 'Кімната',
  roomsAllOpen: 'усі відкриті',
  pause: 'Пауза платежів',
  pauseNone: 'немає',
  pauseManual: 'вручну',
  pauseAuto: 'автоматично',
  choose: 'Оберіть товар',
} as const;

export const SITE_SWITCH_LABELS: Record<string, string> = {
  chat: 'Чат',
  toasts: 'Тости',
  pass: 'Новорічний пас',
  passGift: 'Пас у подарунок',
  payments: 'Платежі',
  viewersMap: 'Мапа глядачів',
  viewersCount: 'Число людей біля плеєра',
  passOffer: 'Пропозиція паса',
  chatRooms: 'Кімнати чату',
  toastTiers: 'Рівні тостів',
};

export const SITE_PRODUCT_LABELS: Record<string, string> = {
  pass: 'Новорічний пас',
  'toast:2': 'Тост $2',
  'toast:5': 'Тост $5',
  'toast:10': 'Тост $10',
};

/** The Ukrainian text of a reason code; an unknown code gives a generic text (never the raw payload). */
export function reasonText(code: unknown): string {
  return typeof code === 'string' && REASONS[code] ? (REASONS[code] as string) : 'Не вдалося виконати дію.';
}

interface AnswerBody {
  error?: { reason?: unknown; code?: unknown };
  errors?: Array<{ message?: unknown; data?: { errors?: Array<{ message?: unknown }> } }>;
}

/** The reason code of an API answer: `error.reason`, else a Payload validation message, else `error.code`. */
export function reasonOf(body: unknown): string | null {
  const b = body as AnswerBody | null;
  if (typeof b?.error?.reason === 'string') return b.error.reason;
  const nested = b?.errors?.[0]?.data?.errors?.[0]?.message;
  if (typeof nested === 'string') return nested;
  const top = b?.errors?.[0]?.message;
  if (typeof top === 'string') return top;
  return typeof b?.error?.code === 'string' ? b.error.code : null;
}
