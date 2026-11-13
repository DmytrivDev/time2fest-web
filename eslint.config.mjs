import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import noArbitraryTailwind from './eslint/no-arbitrary-tailwind.mjs';

export default tseslint.config(
  { ignores: ['.cache/**', '.next/**', 'out/**', 'storybook-static/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts'] },
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
    // Шов з бекендом (docs/backend/frontend-seam.md): компоненти й сторінки ходять до даних лише через хуки
    // `@/lib/api/hooks/*`. Адаптери імітації — тільки для `lib/api`. Перенесений домен додає сюди свої старі імітатори.
    files: ['components/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/lib/api/sim', '@/lib/api/sim/*', '**/lib/api/sim', '**/lib/api/sim/*'],
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
          ],
        },
      ],
      // Рейтинг перенесено на шов: оцінку пишемо лише через `ratingActions.vote` (@/lib/api/hooks/rating). `lib/rating/rating`
      // тепер чиста (формула, ряди з агрегатів) — її імпорт дозволений.
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name=/^(addStamp|markPresence)$/]",
          message: 'Штамп видає сервіс паспорта (E5b): сторінка лише повідомляє присутність — usePresence з @/lib/api/hooks/passport.',
        },
        {
          selector: "MemberExpression[property.name=/^(toggleSchedule|replaceSchedule|setSchedule)$/][object.name!='profileActions']",
          message: '«Мій графік» — профіль (E5b): profileActions.toggleSchedule / replaceSchedule / setSchedule з @/lib/api/hooks/auth.',
        },
        {
          selector: "MemberExpression[property.name='setHasPass']",
          message: 'Пас — лише з сесії (useSession().session.hasPass / useHeaderPass); guest.hasPass пише тільки «сервер» імітації.',
        },
        {
          selector: "MemberExpression[property.name='setRate']",
          message: 'Оцінки пише сервіс рейтингу: ratingActions.vote з @/lib/api/hooks/rating (не guest.setRate).',
        },
        {
          selector: "MemberExpression[property.name='chainsByEventId'][object.type='CallExpression'][object.callee.name='getData']",
          message: 'Ланцюжки трансляцій — за швом «Ефір»: useStreamChains / useStreamChain / useLiveData з @/lib/api/hooks/live (не getData().chainsByEventId).',
        },
      ],
    },
  },
  {
    // Єдиний виняток: художні штампи
    files: ['components/windows/StampArt*'],
    rules: { 'local/no-arbitrary-tailwind': 'off' },
  },
);
