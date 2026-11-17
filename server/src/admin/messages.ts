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
