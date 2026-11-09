import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, baseURL: 'http://localhost:3000' } },
    // Десктоп — опорна ширина пропорційного макета 1520 (макет 1440 + по 40 px, рішення 2026-11-09): кегль кореня рівно 16 px.
    { name: 'desktop', use: { viewport: { width: 1520, height: 900 }, baseURL: 'http://localhost:3000' } },
    { name: 'tv', use: { viewport: { width: 1920, height: 1080 }, baseURL: 'http://localhost:3000' } },
    // Робоча збірка (без NEXT_PUBLIC_ENV=test), інший порт: US8.2
    {
      name: 'prod',
      testMatch: /.*\.prod\.spec\.ts/,
      use: { viewport: { width: 1440, height: 900 }, baseURL: 'http://localhost:3100' },
    },
  ],
  webServer: [
    {
      command: 'pnpm dev:test',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'pnpm build && npx --yes serve@14 out -l 3100',
      url: 'http://localhost:3100',
      reuseExistingServer: true,
      timeout: 300_000,
    },
  ],
});
