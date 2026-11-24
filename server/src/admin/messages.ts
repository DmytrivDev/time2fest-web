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

/** Texts of the «Ефір» slice (SPEC-12 AC-50). */
export const LIVE_TEXT = {
  title: 'Ефір',
  loading: 'Завантаження…',
  unavailable: 'Ефір недоступний.',
  saved: 'Збережено.',
  reason: 'Причина (обов’язкова, до 200 символів)',
  reasonRequired: 'Вкажіть причину зміни.',
  videoId: 'Ідентифікатор відео для заміни',
  videoIdRequired: 'Вкажіть ідентифікатор відео.',
  current: 'Поточний слот',
  next: 'Наступний слот',
  noEvents: 'У слоті немає подій.',
  noSources: 'Джерел немає.',
  zone: 'Пояс',
  zoneLiveUntil: 'наживо до',
  hide: 'Сховати',
  unhide: 'Показати',
  main: 'Основне',
  override: 'Примусово наживо',
  zoneLive: 'Пояс наживо',
  zoneLiveOff: 'Зняти «пояс наживо»',
  replace: 'Замінити відео',
  hidden: 'сховано',
  dead: 'мертве',
  served: 'віддається',
  notServed: 'не віддається',
  quota: 'Квота YouTube',
  used: 'використано',
  resetAt: 'скидання (UTC)',
  bucket: { queries: 'Запити', search: 'Пошук', batchGetStats: 'Статистика пакетом' } as Record<string, string>,
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

/** Texts of the «Моніторинг» slice (SPEC-13b AC-37): every Ukrainian string of `OpsView` / `OpsSlice` lives here. */
export const OPS_TEXT = {
  title: 'Моніторинг',
  loading: 'Завантаження…',
  unavailable: 'Моніторинг недоступний.',
  blockUnavailable: 'Блок недоступний.',
  noData: 'немає даних',
  notMeasured: 'ще не заміряно',
  never: 'ще не було',
  yes: 'так',
  no: 'ні',
  on: 'увімкнено',
  off: 'вимкнено',
  acknowledge: 'Підтвердити',
  acknowledgeFailed: 'Не вдалося підтвердити тривогу.',
  action: 'Що робити',
  unknownDomain: 'невідомо',
  blocks: {
    alarms: 'Відкриті тривоги',
    logAlarms: 'Тривоги журналу за 24 години',
    time: 'Час краю й сервера',
    scheduler: 'Планувальник',
    catalog: 'Каталог',
    site: 'Стан сайту',
    live: 'Ефір',
    moderation: 'Модерація й AI',
    backups: 'Копії',
    telegram: 'Telegram',
    spend: 'Витрати',
    pending: 'Метрики наступних хвиль',
  },
  alarmsEmpty: 'Відкритих тривог немає.',
  alarmsTotal: 'Усього відкритих',
  logEmpty: 'За останні 24 години тривог журналу немає.',
  count: 'разів',
  last: 'остання',
  skew: 'Розбіжність',
  threshold: 'поріг',
  over: 'вище порогу',
  clockVirtual: 'годинник віртуальний',
  holder: 'Власник оренди',
  epoch: 'Епоха',
  lag: 'Затримка',
  renewedAge: 'Оренду поновлено тому',
  missed: 'Пропущено за добу',
  lagUnknown: 'затримку знає лише власник оренди',
  season: 'Сезон',
  generatedAt: 'Зібрано',
  r2Ok: 'Остання вдала копія в R2',
  r2Failed: 'Остання невдала копія в R2',
  version: 'Версія',
  outage: 'Технічна пауза',
  paymentsPause: 'Пауза платежів',
  quota: 'Квота',
  sources: 'Джерела',
  sourcesDead: 'мертві',
  sourcesHidden: 'сховані',
  nightSpend: 'AI за ніч',
  monthSpend: 'AI за місяць',
  tasks: 'Задачі',
  providers: 'Постачальники',
  lastBackup: 'Остання копія',
  lastOkBackup: 'Остання вдала копія',
  age: 'вік',
  lastRestore: 'Останнє відновлення',
  duration: 'тривалість',
  loss: 'вікно втрат',
  ok: 'вдало',
  failed: 'невдало',
  stage: 'етап',
  notConfigured: 'не налаштовано',
  configured: 'налаштовано',
  lastHeartbeat: 'Останнє контрольне повідомлення',
  silentFor: 'Тиша',
  inWindow: 'у вікні свята',
  outOfWindow: 'поза вікном свята',
  spendOf: 'з',
  cloudflareFloor: 'нижня межа: без читань краю',
  noProvider: 'немає провайдера',
  unknown: 'невідомо',
  pendingWave: 'хвиля',
  minutes: 'хв',
  seconds: 'с',
  ms: 'мс',
  settingsTitle: 'Параметри моніторингу',
  settingsSaved: 'Збережено.',
} as const;
