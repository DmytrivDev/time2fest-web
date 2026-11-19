import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import timeRules from '../packages/rules/eslint/no-time-rule-copy.mjs';

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'src/migrations/**',
      'src/payload-types.ts',
      'src/app/(payload)/admin/importMap.js',
      'next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node } } },
  {
    // Time only through server/src/clock (AC-34).
    files: ['src/**/*.ts'],
    ignores: ['src/clock/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'time only through server/src/clock (AC-34)',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'time only through server/src/clock (AC-34)',
        },
      ],
    },
  },
  {
    // Onion ban 2: the platform ring and the ports file import no adapter, endpoint or SDK.
    files: ['src/platform/**/*.ts', 'src/ports.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['ioredis', 'pg', 'payload', '@payloadcms/*', 'next', 'next/*'], message: 'platform ring stays free of SDKs (onion ban 2)' },
            { group: ['**/adapters/*', '**/endpoints/*', '**/container'], message: 'platform ring imports no outer ring (onion ban 2)' },
          ],
        },
      ],
    },
  },
  {
    // Time-rule boundaries only through @time2fest/rules (SPEC-07 AC-23; same rule as the site, SPEC-03 AC-5).
    files: ['src/**/*.ts'],
    ignores: ['src/migrations/**'],
    plugins: { 't2f-time': timeRules },
    rules: { 't2f-time/no-rule-copy': 'error' },
  },
);
