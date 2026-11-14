/**
 * Пас у тестах (шов, залишки E5): пас — лише з сесії того, хто увійшов (`accountHasPass`), окремого «паса на пристрої»
 * (`guest.hasPass`) більше немає. Тест, якому потрібен пас, входить в акаунт і оформлює пас — як справжня людина.
 * Після тесту, що видав пас, вхід і паси скидаються самі (`afterEach`), щоб пас не протікав у наступний тест.
 */
import { afterEach } from 'vitest';
import { accountHasPass, useAuthStore } from '@/stores/auth';

export const TEST_PASS_EMAIL = 'pass@example.com';

let granted = false;
afterEach(() => {
  if (!granted) return;
  granted = false;
  revokeTestPass();
});

/** Увійти в акаунт `email` (без листа — примітив «сервера» імітації) і видати на нього пас. */
export function grantTestPass(email = TEST_PASS_EMAIL, now = Date.now()): void {
  granted = true;
  useAuthStore.getState().signInVerified(email, now);
  useAuthStore.getState().grantPass(email, now);
}

/** Вийти й забути акаунти й паси: тест без пасу. */
export function revokeTestPass(): void {
  useAuthStore.setState({ user: null, accounts: [], passes: {} });
}

/** Чи має пас той, хто зараз увійшов (те саме, що `session.hasPass`). */
export function testHasPass(): boolean {
  return accountHasPass(useAuthStore.getState());
}
