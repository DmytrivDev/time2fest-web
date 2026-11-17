import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import noArbitraryTailwind from './eslint/no-arbitrary-tailwind.mjs';
import timeRules, { RULE_CONSTANT_NAMES } from './packages/rules/eslint/no-time-rule-copy.mjs';

// Шов з бекендом (docs/backend/frontend-seam.md): компоненти й сторінки ходять до даних лише через хуки
// `@/lib/api/hooks/*`. Адаптери імітації — тільки для `lib/api`. Перенесений домен додає сюди свої старі імітатори.
const seamPatterns = [
  {
    group: ['@/lib/api/sim', '@/lib/api/sim/*', '**/lib/api/sim', '**/lib/api/sim/*', '@/lib/api/simEntry', '@/lib/api/simRuntimeEntry', '**/lib/api/simEntry', '**/lib/api/simRuntimeEntry'],
    message: 'Імітація — лише за швом: бери дані через хук з @/lib/api/hooks/*.',
  },
  {
    group: ['@/stores/notifications', '**/stores/notifications', '@/lib/notifications/*', '**/lib/notifications/*'],
    message: 'Сповіщення перенесено на шов: @/lib/api/hooks/notifications (типи — @/lib/api/contracts/notifications).',
  },
  {
    group: ['@/stores/auth', '**/stores/auth', '@/lib/auth/sim', '**/lib/auth/sim'],
    message: 'Вхід перенесено на шов (E3): сесія й дії — @/lib/api/hooks/auth (useSession, authActions, profileActions); пошта — @/lib/auth/email.',
  },
  {
    group: ['@/lib/chat-sim', '@/lib/chat-sim/*', '**/lib/chat-sim', '**/lib/chat-sim/*'],
    message: 'Чат перенесено на шов (E5a): стрічки й дії — @/lib/api/hooks/chat; чисті перевірки — @/lib/chat/*.',
  },
  {
    group: ['@/lib/toast/worldToasts', '**/lib/toast/worldToasts', '@/lib/offers/paySim', '**/lib/offers/paySim'],
    message: 'Тости й оплата перенесено на шов (E4): стрічка — @/lib/api/hooks/toasts, події замовлень — @/lib/api/hooks/checkout.',
  },
  {
    group: ['@/lib/presence/useStampGrant', '**/lib/presence/useStampGrant', '@/lib/presence/surfaces', '**/lib/presence/surfaces'],
    message: 'Паспорт перенесено на шов (E5b): присутність — usePresence, штампи — useStamps з @/lib/api/hooks/passport.',
  },
  {
    group: ['@/lib/presence/viewers', '**/lib/presence/viewers'],
    message: 'Глядачі перенесено на шов «Ефір»: useViewers з @/lib/api/hooks/live (імітація — lib/api/sim/live).',
  },
];

// Рейтинг перенесено на шов: оцінку пишемо лише через `ratingActions.vote` (@/lib/api/hooks/rating). `lib/rating/rating`
// тепер чиста (формула, ряди з агрегатів) — її імпорт дозволений.
const seamSyntax = [
  {
    selector: "MemberExpression[property.name=/^(addStamp|markPresence)$/]",
    message: 'Штамп видає сервіс паспорта (E5b): сторінка лише повідомляє присутність — usePresence з @/lib/api/hooks/passport.',
  },
  {
    selector: "MemberExpression[property.name=/^(toggleSchedule|replaceSchedule|setSchedule)$/][object.name!='profileActions']",
    message: '«Мій графік» — профіль (E5b): profileActions.toggleSchedule / replaceSchedule / setSchedule з @/lib/api/hooks/auth.',
  },
  {
    selector: "MemberExpression[property.name=/^(setNick|setFlag|setDetectedFlag|setHasPass)$/]",
    message: 'Нік і прапор пише профіль (profileActions.update з @/lib/api/hooks/auth); пас — лише з сесії (useHasPass / hasPassNow).',
  },
  {
    selector: "CallExpression[callee.name='useGuestStore'] MemberExpression[property.name=/^(nick|flagCode|detectedFlag|schedule|hasPass)$/]",
    message: 'Профіль і графік читай через useProfile / useSchedule, пас — через useHasPass (@/lib/api/hooks/auth).',
  },
  {
    selector: "MemberExpression[property.name='setRate']",
    message: 'Оцінки пише сервіс рейтингу: ratingActions.vote з @/lib/api/hooks/rating (не guest.setRate).',
  },
  {
    selector: "MemberExpression[property.name='chainsByEventId'][object.type='CallExpression'][object.callee.name='getData']",
    message: 'Ланцюжки трансляцій — за швом «Ефір»: useStreamChains / useStreamChain / useLiveData з @/lib/api/hooks/live (не getData().chainsByEventId).',
  },
];

// Правила часу переїхали в пакет (SPEC-03, AC-4): старі шляхи заборонено — і через `@/…`, і відносно.
// Видалені модулі заборонено цілком; з модулів, що лишились у застосунку, — лише перенесені імена.
const OLD_RULE_MESSAGE = 'Правила часу — лише @time2fest/rules/time (SPEC-03).';
const DELETED_ENGINE = 'celebration|eventStatus|zoneState|newYear|presence|momentTimeline|captionPhase';
const MOVED_NAMES = {
  'engine/config': [...RULE_CONSTANT_NAMES],
  'engine/currentAirEvent': ['currentSlotIndex'],
  'rating/rating': ['RATING_OPEN_AFTER', 'RATING_CLOSE_AFTER', 'ratingCloseAt'],
  'toast/feed': ['nextMidnightAfter', 'prevMidnightAtOrBefore'],
  'stamp/stampCelebration': ['CATCH_UP_MAX_AGE_MS'],
};
// `lib/<dir>/<m>` як `@/lib/…`, `../../lib/…` або `../<dir>/<m>` з сусідньої теки `lib`.
const oldModule = (dirAndModule, importNames) => [
  { regex: `(^|/)lib/${dirAndModule}$`, ...(importNames && { importNames }), message: OLD_RULE_MESSAGE },
  { regex: `^(\\.\\./)+${dirAndModule}$`, ...(importNames && { importNames }), message: OLD_RULE_MESSAGE },
];
const oldRulePatterns = [
  ...oldModule(`engine/(${DELETED_ENGINE})`),
  ...oldModule('toast/season'),
  ...Object.entries(MOVED_NAMES).flatMap(([path, names]) => oldModule(path, names)),
];
// Те саме як `./<m>` усередині теки старого модуля.
const oldRuleLocalPatterns = [
  { regex: `^\\./(${DELETED_ENGINE}|season)$`, message: OLD_RULE_MESSAGE },
  ...Object.entries(MOVED_NAMES).map(([path, importNames]) => ({ regex: `^\\./${path.split('/')[1]}$`, importNames, message: OLD_RULE_MESSAGE })),
];

export default tseslint.config(
  { ignores: ['.cache/**', '.claude/**', '.next/**', '.next-*/**', 'out/**', 'out-*/**', 'public/yt/**', 'storybook-static/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...nextVitals,
  { rules: jsxA11y.flatConfigs.recommended.rules },
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { local: noArbitraryTailwind },
    rules: { 'local/no-arbitrary-tailwind': 'error' },
  },
  {
    // Старі шляхи правил часу — для всього, крім пакета й шва (у шва свій блок нижче, з тими самими шляхами).
    files: ['**/*.{ts,tsx,mjs}'],
    ignores: ['packages/rules/**', 'components/**', 'app/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: oldRulePatterns }] },
  },
  {
    // Теки старих модулів: ще й відносний `./<m>`. Пізніший блок заміняє опції правила, тож шляхи — разом.
    files: ['lib/engine/**/*.{ts,tsx}', 'lib/toast/**/*.{ts,tsx}', 'lib/rating/**/*.{ts,tsx}', 'lib/stamp/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [...oldRulePatterns, ...oldRuleLocalPatterns] }] },
  },
  {
    // Шов з бекендом + старі шляхи правил часу: у flat config пізніший блок заміняє опції правила для тих самих файлів,
    // тому обидва набори — в одному списку.
    files: ['components/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...seamPatterns, ...oldRulePatterns] }],
      'no-restricted-syntax': ['error', ...seamSyntax],
    },
  },
  {
    // Пакет правил (SPEC-03, AC-2, AC-3, NFR-2): без годинника, без застосунку й фреймворків, без змінного стану модуля.
    files: ['packages/rules/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/*', '@/**', '../../../*', '../../../**'],
              message: 'Пакет правил не імпортує застосунок: лише власні модулі packages/rules (SPEC-03, AC-3).',
            },
            { group: ['next', 'next/*', 'react', 'react/*'], message: 'Пакет правил не залежить від фреймворків (SPEC-03, NFR-1).' },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'Правила не читають годинник: now приходить аргументом (SPEC-03, AC-2).' },
        { selector: "CallExpression[callee.object.name='performance'][callee.property.name='now']", message: 'Правила не читають годинник: now приходить аргументом (SPEC-03, AC-2).' },
        { selector: 'NewExpression[callee.name=\'Date\'][arguments.length=0]', message: 'Правила не читають годинник: new Date() без аргументу заборонено (SPEC-03, AC-2).' },
        { selector: "Program > VariableDeclaration[kind!='const']", message: 'Без змінного стану модуля: лише const (SPEC-03, NFR-2).' },
        { selector: "Program > ExportNamedDeclaration > VariableDeclaration[kind!='const']", message: 'Без змінного стану модуля: лише const (SPEC-03, NFR-2).' },
      ],
    },
  },
  {
    // Перевірка дублювання меж правил часу (SPEC-03, AC-5). Тести будують межові миті навмисно — їх не перевіряємо.
    files: ['**/*.{ts,tsx}'],
    ignores: ['packages/rules/**', 'tests/**'],
    plugins: { 't2f-time': timeRules },
    rules: { 't2f-time/no-rule-copy': 'error' },
  },
  {
    // Єдиний виняток: художні штампи
    files: ['components/stamp/StampArt*'],
    rules: { 'local/no-arbitrary-tailwind': 'off' },
  },
);
