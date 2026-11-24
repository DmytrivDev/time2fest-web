/**
 * Реєстр «тривоги й метрики» (SPEC-13b AC-24, AC-25, AC-29, AC-35): рядок на домен, відсортований за
 * `domain`. Кожен вид тривоги — `source` / `code` точно як у коді (стилі змішані: `live` і `site` пишуть
 * домен і в `code`, нові коди 13b — `домен/kebab`), рівень, значення й дія українською, білий список
 * ключів деталей. Зарезервовані рядки — домени наступних хвиль: метрики «немає даних» із хвилею-власником.
 * Лише дані: жодного імпорту адаптерів.
 */
import { assertRegistry } from '../platform/registry';

export type OpsAlarmLevel = 'info' | 'log' | 'page';

export interface OpsAlarmRow {
  source: string;
  code: string;
  level: OpsAlarmLevel;
  /** Коли рівень залежить від обставин (`live/statuses-stale`: `page` у вікні, `log` поза ним). */
  levelNote?: string;
  /** Що сталося — українською. */
  meaning: string;
  /** Що робити — українською. */
  action: string;
  /** Ключі деталей, що можуть піти в Telegram і в `alarms.details` (AC-11). */
  detailKeys: readonly string[];
}

export interface OpsMetricRow {
  key: string;
  title: string;
  /** Метрики ще немає в коді (AC-35): хвиля, що її додасть; моніторинг показує «немає даних». */
  pendingNote?: string;
}

export interface OpsDomainRow {
  domain: string;
  title: string;
  /** Хвиля, що володіє доменом. */
  ownerWave: string;
  /** Домен наступної хвилі: тривог ще немає, метрики — «немає даних». */
  reserved?: true;
  alarms: readonly OpsAlarmRow[];
  metrics: readonly OpsMetricRow[];
}

const CHECK_LOG = 'Подивитися журнал сервера біля часу тривоги; якщо повторюється — розібратися з причиною.';

export const opsRegistry: readonly OpsDomainRow[] = [
  {
    domain: 'catalog',
    title: 'Каталог',
    ownerWave: 'SPEC-04',
    alarms: [
      {
        source: 'catalog',
        code: 'catalog-r2-copy-failed',
        level: 'page',
        meaning: 'Копія каталогу в R2 не записалася після всіх спроб — край віддає стару версію.',
        action: 'Перевірити доступ до R2 і ключі; повторити публікацію каталогу.',
        detailKeys: ['attempts'],
      },
    ],
    metrics: [
      { key: 'catalog.version', title: 'Версія каталогу' },
      { key: 'catalog.r2LastCopy', title: 'Остання копія в R2' },
    ],
  },
  {
    domain: 'chat',
    title: 'Чат',
    ownerWave: 'SPEC-15',
    reserved: true,
    alarms: [],
    metrics: [
      { key: 'chat.messages', title: 'Повідомлення чату', pendingNote: 'SPEC-15' },
      { key: 'chat.moderationQueue', title: 'Черга модерації', pendingNote: 'SPEC-16' },
    ],
  },
  {
    domain: 'clock',
    title: 'Час',
    ownerWave: 'SPEC-07',
    alarms: [
      {
        source: 'clock',
        code: 'edge-divergence',
        level: 'page',
        meaning: 'Час краю й сервера розходиться понад поріг кілька вікон поспіль.',
        action: 'Перевірити синхронізацію часу на вузлі й відповідь краю; відлік на сайті може зсунутися.',
        detailKeys: ['ms', 'windows'],
      },
      {
        source: 'clock',
        code: 'edge-divergence-warn',
        level: 'log',
        meaning: 'Розбіжність часу краю й сервера близька до порогу.',
        action: 'Стежити; якщо зростає — перевірити синхронізацію часу.',
        detailKeys: ['ms', 'windows'],
      },
      {
        source: 'clock',
        code: 'refresh_failed',
        level: 'log',
        meaning: 'Не вдалося оновити спільний годинник із бази.',
        action: CHECK_LOG,
        detailKeys: ['pgCode'],
      },
    ],
    metrics: [{ key: 'clock.edgeDivergenceMs', title: 'Розбіжність часу краю й сервера' }],
  },
  {
    domain: 'edge',
    title: 'Край',
    ownerWave: 'SPEC-22a',
    reserved: true,
    alarms: [
      {
        source: 'edge',
        code: 'origin-down',
        level: 'page',
        meaning: 'Зовнішня перевірка не дістає сервер через край (зарезервовано, SPEC-22a).',
        action: 'Перевірити вузол, тунель і стан сервера.',
        detailKeys: ['status'],
      },
    ],
    metrics: [{ key: 'edge.originCheck', title: 'Зовнішня перевірка сервера', pendingNote: 'SPEC-22a' }],
  },
  {
    domain: 'live',
    title: 'Ефір',
    ownerWave: 'SPEC-12',
    alarms: [
      {
        source: 'live',
        code: 'live/override-kept',
        level: 'log',
        meaning: 'Ручне перемикання джерела збережено, хоча опитування бачить інший стан.',
        action: 'Переконатися, що ручне перемикання ще потрібне; зняти його в зрізі «Ефір».',
        detailKeys: ['override'],
      },
      {
        source: 'live',
        code: 'live/publish-failed',
        level: 'log',
        meaning: 'Зміна ефіру не опублікувалася в Centrifugo; зміна в базі лишилася.',
        action: 'Перевірити Centrifugo; клієнти отримають стан за опитуванням.',
        detailKeys: ['version'],
      },
      {
        source: 'live',
        code: 'live/purge-failed',
        level: 'log',
        meaning: 'Очищення кешу краю після зміни ефіру не вдалося.',
        action: 'Перевірити токен очищення Cloudflare; кеш оновиться за часом життя.',
        detailKeys: ['attempts', 'version'],
      },
      {
        source: 'live',
        code: 'live/purge-skipped',
        level: 'info',
        meaning: 'Очищення кешу краю пропущено: не налаштовано токен, зону чи адресу сайту.',
        action: 'Нічого, якщо так задумано для цього середовища.',
        detailKeys: ['version'],
      },
      {
        source: 'live',
        code: 'live/quota-80',
        level: 'page',
        meaning: 'Використано 80 % добової квоти YouTube.',
        action: 'Зменшити частоту позачергових перевірок; стежити за квотою до 00:00 за тихоокеанським часом.',
        detailKeys: ['bucket'],
      },
      {
        source: 'live',
        code: 'live/quota-exceeded',
        level: 'log',
        meaning: 'Квоту YouTube вичерпано — опитування призупинено до скидання.',
        action: 'Чекати скидання квоти; статуси візьмуться з розкладу.',
        detailKeys: ['bucket'],
      },
      {
        source: 'live',
        code: 'live/r2-copy-failed',
        level: 'page',
        meaning: 'Копія стану ефіру в R2 не записалася після всіх спроб.',
        action: 'Перевірити доступ до R2; повторити зміну ефіру.',
        detailKeys: ['attempts', 'version'],
      },
      {
        source: 'live',
        code: 'live/r2-copy-skipped',
        level: 'info',
        meaning: 'Копію ефіру в R2 пропущено: не налаштовано бакет чи префікс.',
        action: 'Нічого, якщо так задумано для цього середовища.',
        detailKeys: ['version'],
      },
      {
        source: 'live',
        code: 'live/statuses-stale',
        level: 'page',
        levelNote: 'page — у вікні ночі (scope: window), log — поза ним (scope: off-window).',
        meaning: 'Статуси трансляцій давно не оновлювалися.',
        action: 'Перевірити опитувач і квоту YouTube; за потреби позначити пояс наживо вручну.',
        detailKeys: ['scope'],
      },
      {
        source: 'live',
        code: 'poller_tick_failed',
        level: 'log',
        meaning: 'Такт опитувача ефіру впав.',
        action: CHECK_LOG,
        detailKeys: ['pgCode'],
      },
      {
        source: 'live',
        code: 'viewers_tick_failed',
        level: 'log',
        meaning: 'Такт підрахунку глядачів впав.',
        action: CHECK_LOG,
        detailKeys: ['pgCode'],
      },
    ],
    metrics: [
      { key: 'live.quotaPercent', title: 'Квота YouTube, %' },
      { key: 'live.statusesAge', title: 'Застарілість статусів' },
      { key: 'live.playerErrorsByCity', title: 'Помилки плеєрів за містами', pendingNote: 'SPEC-20' },
      { key: 'live.autoSwitches', title: 'Автоперемикання джерел', pendingNote: 'SPEC-20' },
    ],
  },
  {
    domain: 'mail',
    title: 'Листи',
    ownerWave: 'SPEC-17',
    reserved: true,
    alarms: [],
    metrics: [{ key: 'mail.sent', title: 'Надіслані листи', pendingNote: 'SPEC-17' }],
  },
  {
    domain: 'moderation',
    title: 'Модерація й AI',
    ownerWave: 'SPEC-09',
    alarms: [
      {
        source: 'mod',
        code: 'moderation_degraded',
        level: 'log',
        meaning: 'Постачальник AI відповідає з помилками — модерація на запасному.',
        action: 'Стежити; перевірити стан постачальника.',
        detailKeys: ['reason'],
      },
      {
        source: 'mod',
        code: 'moderation_fallback',
        level: 'page',
        meaning: 'Обидва постачальники AI недоступні — працює лише запасний фільтр.',
        action: 'Перевірити ключі й стан постачальників AI; запасний фільтр суворіший.',
        detailKeys: ['reason'],
      },
      {
        source: 'mod',
        code: 'moderation_recovered',
        level: 'log',
        meaning: 'Модерація повернулася до основного постачальника.',
        action: 'Нічого.',
        detailKeys: [],
      },
      {
        source: 'mod',
        code: 'moderation_rejected_requests',
        level: 'log',
        meaning: 'Помітна частка запитів до AI відхилена постачальником.',
        action: 'Перевірити ліміти облікового запису постачальника.',
        detailKeys: ['provider', 'share', 'task'],
      },
      {
        source: 'mod',
        code: 'moderation_saturated',
        level: 'page',
        meaning: 'Постачальник AI перевантажений — запити відкладаються.',
        action: 'Перевірити ліміти постачальника; за потреби зменшити навантаження.',
        detailKeys: ['backoffMs', 'provider'],
      },
      {
        source: 'mod',
        code: 'moderation_throttled',
        level: 'page',
        meaning: 'Запити до AI впираються в ліміт частоти.',
        action: 'Перевірити ліміт хвилини постачальника й налаштування частки.',
        detailKeys: ['provider', 'share', 'task'],
      },
      {
        source: 'mod',
        code: 'provider_not_configured',
        level: 'page',
        meaning: 'Постачальник AI не налаштований — немає ключа.',
        action: 'Додати ключ постачальника в змінні середовища.',
        detailKeys: ['provider'],
      },
      {
        source: 'mod',
        code: 'spend_100',
        level: 'page',
        meaning: 'Витрати на AI досягли стелі періоду — AI вимкнено до кінця періоду.',
        action: 'Вирішити, чи піднімати стелю; модерація на запасному фільтрі.',
        detailKeys: ['ceilingUsd', 'period', 'spentUsd'],
      },
      {
        source: 'mod',
        code: 'spend_50',
        level: 'log',
        meaning: 'Витрати на AI — половина стелі періоду.',
        action: 'Стежити за витратами.',
        detailKeys: ['ceilingUsd', 'period', 'spentUsd'],
      },
      {
        source: 'mod',
        code: 'spend_80',
        level: 'page',
        meaning: 'Витрати на AI — 80 % стелі періоду.',
        action: 'Перевірити, звідки витрати; вирішити, чи піднімати стелю.',
        detailKeys: ['ceilingUsd', 'period', 'spentUsd'],
      },
      {
        source: 'mod',
        code: 'spend_store_down',
        level: 'page',
        meaning: 'Сховище витрат AI недоступне — витрати не рахуються.',
        action: 'Перевірити базу; до відновлення AI працює під обмеженням.',
        detailKeys: ['seconds'],
      },
      {
        source: 'mod',
        code: 'spend_store_recovered',
        level: 'log',
        meaning: 'Сховище витрат AI знову доступне.',
        action: 'Нічого.',
        detailKeys: [],
      },
      {
        source: 'mod',
        code: 'toasts_spend_100',
        level: 'page',
        meaning: 'Частка витрат AI на перевірку тостів вичерпана.',
        action: 'Вирішити, чи піднімати частку тостів.',
        detailKeys: ['ceilingUsd', 'period', 'spentUsd'],
      },
      {
        source: 'mod',
        code: 'toasts_spend_50',
        level: 'log',
        meaning: 'Половину частки витрат AI на тости використано.',
        action: 'Стежити за витратами.',
        detailKeys: ['ceilingUsd', 'period', 'spentUsd'],
      },
      {
        source: 'mod',
        code: 'toasts_spend_80',
        level: 'page',
        meaning: '80 % частки витрат AI на тости використано.',
        action: 'Перевірити кількість тостів; вирішити, чи піднімати частку.',
        detailKeys: ['ceilingUsd', 'period', 'spentUsd'],
      },
    ],
    metrics: [
      { key: 'moderation.providers', title: 'Стан постачальників AI' },
      { key: 'moderation.spendNight', title: 'Витрати AI за ніч' },
      { key: 'moderation.spendMonth', title: 'Витрати AI за місяць' },
    ],
  },
  {
    domain: 'ops',
    title: 'Копії й моніторинг',
    ownerWave: 'SPEC-13b',
    alarms: [
      {
        source: 'ops',
        code: 'backup-failed',
        level: 'page',
        meaning: 'Копія бази не вдалася; етап — у деталях.',
        action: 'Подивитися рядок журналу копій; запустити копію вручну після виправлення.',
        detailKeys: ['stage'],
      },
      {
        source: 'ops',
        code: 'backup-not-configured',
        level: 'page',
        meaning: 'Копія бази не стартує: немає ключа шифрування.',
        action: 'Задати T2F_BACKUP_KEY у змінних вузла.',
        detailKeys: [],
      },
      {
        source: 'ops',
        code: 'backup-stale',
        level: 'page',
        meaning: 'Останній вдалий знімок бази застарий.',
        action: 'Перевірити розклад копій і R2; запустити копію вручну.',
        detailKeys: ['ageMinutes'],
      },
      {
        source: 'ops',
        code: 'heartbeat-fallback-window',
        level: 'log',
        meaning: 'У каталозі немає поясів — вікно ночі взято за замовчуванням.',
        action: 'Перевірити імпорт каталогу.',
        detailKeys: [],
      },
      {
        source: 'ops',
        code: 'unregistered-alarm',
        level: 'log',
        meaning: 'Піднято тривогу, якої немає в реєстрі.',
        action: 'Додати вид у реєстр «тривоги й метрики».',
        detailKeys: [],
      },
    ],
    metrics: [
      { key: 'ops.lastBackup', title: 'Остання копія бази' },
      { key: 'ops.lastRestore', title: 'Останнє відновлення' },
    ],
  },
  {
    domain: 'payments',
    title: 'Оплати',
    ownerWave: 'SPEC-17',
    reserved: true,
    alarms: [],
    metrics: [
      { key: 'payments.checkouts', title: 'Оплати', pendingNote: 'SPEC-17' },
      { key: 'payments.webhooks', title: 'Вебхуки PayPro', pendingNote: 'SPEC-17' },
      { key: 'payments.autopause', title: 'Автопауза продажу', pendingNote: 'SPEC-17' },
      { key: 'payments.cardTesting', title: 'Перебір карток', pendingNote: 'SPEC-17' },
      { key: 'payments.refunds', title: 'Повернення', pendingNote: 'SPEC-17' },
      { key: 'payments.paypro', title: 'Стан PayPro', pendingNote: 'SPEC-17' },
    ],
  },
  {
    domain: 'platform',
    title: 'Платформа',
    ownerWave: 'SPEC-02',
    alarms: [
      {
        source: 'access',
        code: 'access-jwks-unreachable',
        level: 'log',
        meaning: 'Ключі Cloudflare Access недоступні — вхід в адмінку може не працювати.',
        action: 'Перевірити адресу ключів Access і мережу вузла.',
        detailKeys: [],
      },
      {
        source: 'alarms',
        code: 'alarm_store_failed',
        level: 'log',
        meaning: 'Тривогу не вдалося зберегти в базі.',
        action: CHECK_LOG,
        detailKeys: [],
      },
      {
        source: 'events',
        code: 'background_start_failed',
        level: 'log',
        meaning: 'Фонові процеси сервера не стартували.',
        action: 'Перезапустити сервер; подивитися журнал запуску.',
        detailKeys: [],
      },
      {
        source: 'events',
        code: 'listener_error',
        level: 'log',
        meaning: 'Слухач подій бази впав.',
        action: CHECK_LOG,
        detailKeys: ['pgCode'],
      },
      {
        source: 'postgres',
        code: 'pool_client_error',
        level: 'log',
        meaning: 'Помилка з’єднання в пулі бази.',
        action: CHECK_LOG,
        detailKeys: ['pgCode'],
      },
      {
        source: 'unattended',
        code: 'tick_failed',
        level: 'log',
        meaning: 'Такт режиму без нагляду впав.',
        action: CHECK_LOG,
        detailKeys: ['pgCode'],
      },
    ],
    metrics: [{ key: 'platform.openPageAlarms', title: 'Відкриті тривоги' }],
  },
  {
    domain: 'presence',
    title: 'Присутність',
    ownerWave: 'SPEC-14',
    reserved: true,
    alarms: [],
    metrics: [
      { key: 'presence.rooms', title: 'Присутність у кімнатах', pendingNote: 'SPEC-14' },
      { key: 'presence.realtimeConnections', title: 'Підключення realtime', pendingNote: 'SPEC-14' },
    ],
  },
  {
    domain: 'scheduler',
    title: 'Планувальник',
    ownerWave: 'SPEC-07',
    alarms: [
      {
        source: 'scheduler',
        code: 'action_failed',
        level: 'log',
        meaning: 'Дія моменту впала.',
        action: 'Подивитися журнал запусків планувальника.',
        detailKeys: ['action', 'reason'],
      },
      {
        source: 'scheduler',
        code: 'lag',
        level: 'page',
        meaning: 'Дія моменту виконалася із затримкою понад поріг.',
        action: 'Перевірити навантаження вузла й базу.',
        detailKeys: ['action', 'at', 'lagMs'],
      },
      {
        source: 'scheduler',
        code: 'lease_unreachable',
        level: 'page',
        meaning: 'Оренда планувальника недоступна — моменти можуть не спрацювати.',
        action: 'Перевірити базу; переконатися, що працює хоча б один сервер.',
        detailKeys: ['cause'],
      },
      {
        source: 'scheduler',
        code: 'moments_load_failed',
        level: 'log',
        meaning: 'Не вдалося завантажити моменти.',
        action: CHECK_LOG,
        detailKeys: ['cause'],
      },
    ],
    metrics: [
      { key: 'scheduler.lagMs', title: 'Затримка планувальника' },
      { key: 'scheduler.lease', title: 'Оренда планувальника' },
    ],
  },
  {
    domain: 'site',
    title: 'Стан сайту',
    ownerWave: 'SPEC-08',
    alarms: [
      {
        source: 'site',
        code: 'rebuild_tick_failed',
        level: 'log',
        meaning: 'Такт перезбирання сайту впав.',
        action: CHECK_LOG,
        detailKeys: ['pgCode'],
      },
      {
        source: 'site',
        code: 'site/publish-failed',
        level: 'log',
        meaning: 'Зміна стану сайту не опублікувалася в Centrifugo; зміна в базі лишилася.',
        action: 'Перевірити Centrifugo; клієнти отримають стан за опитуванням.',
        detailKeys: ['version'],
      },
      {
        source: 'site',
        code: 'site/purge-failed',
        level: 'log',
        meaning: 'Очищення кешу краю після зміни сайту не вдалося.',
        action: 'Перевірити токен очищення Cloudflare; кеш оновиться за часом життя.',
        detailKeys: ['attempts', 'version'],
      },
      {
        source: 'site',
        code: 'site/purge-skipped',
        level: 'info',
        meaning: 'Очищення кешу краю пропущено: не налаштовано токен, зону чи адресу сайту.',
        action: 'Нічого, якщо так задумано для цього середовища.',
        detailKeys: ['version'],
      },
      {
        source: 'site',
        code: 'site/r2-copy-failed',
        level: 'page',
        meaning: 'Копія стану сайту в R2 не записалася після всіх спроб.',
        action: 'Перевірити доступ до R2; повторити зміну.',
        detailKeys: ['attempts', 'version'],
      },
      {
        source: 'site',
        code: 'site/r2-copy-skipped',
        level: 'info',
        meaning: 'Копію стану сайту в R2 пропущено: не налаштовано бакет чи префікс.',
        action: 'Нічого, якщо так задумано для цього середовища.',
        detailKeys: ['version'],
      },
      {
        source: 'site',
        code: 'site/rebuild-disabled',
        level: 'info',
        meaning: 'Перезбирання в production вимкнене перемикачем.',
        action: 'Нічого, якщо так задумано.',
        detailKeys: ['catalogVersion'],
      },
      {
        source: 'site',
        code: 'site/rebuild-failed',
        level: 'page',
        meaning: 'Запуск перезбирання сайту не вдався після всіх спроб.',
        action: 'Перевірити токен GitHub і стан робочого процесу збирання.',
        detailKeys: ['attempts', 'catalogVersion'],
      },
      {
        source: 'site',
        code: 'site/rebuild-frozen',
        level: 'info',
        meaning: 'Перезбирання відкладено: вікно заморожування.',
        action: 'Нічого; запуск відбудеться після вікна.',
        detailKeys: ['catalogVersion'],
      },
      {
        source: 'site',
        code: 'site/rebuild-not-configured',
        level: 'info',
        meaning: 'Перезбирання пропущено: немає токена запуску.',
        action: 'Нічого, якщо так задумано для цього середовища.',
        detailKeys: ['catalogVersion'],
      },
    ],
    metrics: [
      { key: 'site.state', title: 'Стан сайту' },
      { key: 'site.switches', title: 'Вимикачі' },
    ],
  },
  {
    domain: 'spend',
    title: 'Витрати',
    ownerWave: 'SPEC-13b',
    alarms: [
      {
        source: 'spend',
        code: 'cloudflare-50',
        level: 'log',
        meaning: 'Витрати Cloudflare (нижня межа) — половина стелі місяця.',
        action: 'Стежити за витратами.',
        detailKeys: ['percent', 'period'],
      },
      {
        source: 'spend',
        code: 'cloudflare-80',
        level: 'page',
        meaning: 'Витрати Cloudflare (нижня межа) — 80 % стелі місяця.',
        action: 'Перевірити рахунок Cloudflare; вирішити, чи піднімати стелю.',
        detailKeys: ['percent', 'period'],
      },
      {
        source: 'spend',
        code: 'mail-50',
        level: 'log',
        meaning: 'Витрати на листи — половина стелі місяця.',
        action: 'Стежити за витратами.',
        detailKeys: ['percent', 'period'],
      },
      {
        source: 'spend',
        code: 'mail-80',
        level: 'page',
        meaning: 'Витрати на листи — 80 % стелі місяця.',
        action: 'Перевірити рахунок постачальника листів.',
        detailKeys: ['percent', 'period'],
      },
      {
        source: 'spend',
        code: 'server-50',
        level: 'log',
        meaning: 'Витрати на сервер — половина стелі місяця.',
        action: 'Стежити за витратами.',
        detailKeys: ['percent', 'period'],
      },
      {
        source: 'spend',
        code: 'server-80',
        level: 'page',
        meaning: 'Витрати на сервер — 80 % стелі місяця.',
        action: 'Перевірити розмір вузла; повернути нічний розмір, якщо він зайвий.',
        detailKeys: ['percent', 'period'],
      },
    ],
    metrics: [{ key: 'spend.rows', title: 'Витрати платних служб' }],
  },
  {
    domain: 'telegram',
    title: 'Telegram',
    ownerWave: 'SPEC-13b',
    alarms: [
      {
        source: 'ops',
        code: 'telegram-delivery-failed',
        level: 'log',
        meaning: 'Повідомлення в Telegram не доставлено після всіх спроб.',
        action: 'Перевірити токен бота й id чату; подивитися тривогу в моніторингу.',
        detailKeys: ['status'],
      },
      {
        source: 'ops',
        code: 'telegram-not-configured',
        level: 'log',
        meaning: 'Telegram не налаштовано — тривоги лише в журнал і моніторинг.',
        action: 'Задати токен бота й id чату (справа власника).',
        detailKeys: ['reason'],
      },
    ],
    metrics: [
      { key: 'telegram.sink', title: 'Стан Telegram' },
      { key: 'telegram.lastHeartbeat', title: 'Останнє «усе гаразд»' },
    ],
  },
  {
    domain: 'toasts',
    title: 'Тости',
    ownerWave: 'SPEC-18',
    reserved: true,
    alarms: [],
    metrics: [{ key: 'toasts.sent', title: 'Тости', pendingNote: 'SPEC-18' }],
  },
];

const DETAIL_KEY = /^[a-zA-Z]{1,32}$/;
const CYRILLIC = /[Ѐ-ӿ]/;

/** `source/code` as an alarm kind; `live` and `site` already carry the domain in `code`. */
export function kindOf(a: { source: string; code: string }): string {
  return a.code.startsWith(`${a.source}/`) ? a.code : `${a.source}/${a.code}`;
}

/**
 * Static check (AC-24): sorted by domain, one row per domain, every kind once across the registry,
 * non-empty Ukrainian `meaning` / `action`, detail keys `[a-zA-Z]{1,32}`, reserved rows name their wave.
 */
export function assertOpsRegistry(rows: readonly OpsDomainRow[]): void {
  assertRegistry('ops', rows, (r) => r.domain);
  const kinds = new Set<string>();
  for (const row of rows) {
    if (row.ownerWave.trim() === '' || row.title.trim() === '') throw new Error(`registry ops: row ${row.domain} title or ownerWave empty`);
    for (const a of row.alarms) {
      const kind = `${a.source}\u0000${a.code}`;
      if (kinds.has(kind)) throw new Error(`registry ops: kind ${kindOf(a)} duplicate`);
      kinds.add(kind);
      for (const text of [a.meaning, a.action]) {
        if (text.trim() === '' || !CYRILLIC.test(text)) throw new Error(`registry ops: kind ${kindOf(a)} text empty or not Ukrainian`);
      }
      for (const k of a.detailKeys) if (!DETAIL_KEY.test(k)) throw new Error(`registry ops: kind ${kindOf(a)} detail key ${k} invalid`);
    }
    const metricKeys = new Set<string>();
    for (const m of row.metrics) {
      if (metricKeys.has(m.key)) throw new Error(`registry ops: metric ${m.key} duplicate`);
      metricKeys.add(m.key);
      if (row.reserved && !m.pendingNote) throw new Error(`registry ops: reserved row ${row.domain} metric ${m.key} has no pendingNote`);
    }
  }
}

assertOpsRegistry(opsRegistry);

const byKind = new Map<string, { domain: OpsDomainRow; alarm: OpsAlarmRow }>(
  opsRegistry.flatMap((domain) => domain.alarms.map((alarm) => [`${alarm.source}\u0000${alarm.code}`, { domain, alarm }] as const)),
);

/** The registry row of a raised kind; `undefined` → domain «невідомо» (AC-27). */
export function findKind(source: string, code: string): { domain: OpsDomainRow; alarm: OpsAlarmRow } | undefined {
  return byKind.get(`${source}\u0000${code}`);
}
