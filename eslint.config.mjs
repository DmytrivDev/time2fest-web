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
          ],
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
