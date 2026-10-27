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
    // Єдиний виняток: художні штампи
    files: ['components/windows/StampArt*'],
    rules: { 'local/no-arbitrary-tailwind': 'off' },
  },
);
