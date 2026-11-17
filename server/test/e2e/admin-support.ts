/**
 * Shared helpers of the admin e2e specs (run in W53 against a production build started in the `test`
 * class with doors). Env: T2F_E2E_SERVER (server URL; its host must be T2F_ADMIN_HOST), T2F_OWNER_EMAILS
 * (the test owner is its first address), T2F_E2E_OWNER_PASSWORD (the password given to `owner:create`).
 * Nothing here names an address or a password.
 */
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const server = process.env.T2F_E2E_SERVER ?? '';
export const ownerEmail = (process.env.T2F_OWNER_EMAILS ?? '').split(',')[0]?.trim() ?? '';
export const ownerPassword = process.env.T2F_E2E_OWNER_PASSWORD ?? '';
export const configured = Boolean(server && ownerEmail && ownerPassword);
export const SKIP_REASON = 'set T2F_E2E_SERVER, T2F_OWNER_EMAILS, T2F_E2E_OWNER_PASSWORD (test class, doors on, owner created)';

/** A cold server compiles on the first request; every wait below is generous for that. */
export const COLD_MS = 120_000;

export const originHeaders = { Origin: server };

async function accessJwt(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${server}/api/_test/access-token`, { data: { kind: 'person', email: ownerEmail }, headers: originHeaders });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { value: { token: string } }).value.token;
}

/** A browser context that carries the Access JWT of the owner on every request. */
export async function ownerContext(browser: Browser, request: APIRequestContext): Promise<BrowserContext> {
  return browser.newContext({ extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': await accessJwt(request) } });
}

/** Signs in through the login form and waits for the first screen: the page is warm after this. */
export async function signIn(page: Page): Promise<void> {
  page.setDefaultTimeout(COLD_MS);
  await page.goto(`${server}/admin/login`, { waitUntil: 'domcontentloaded', timeout: COLD_MS });
  await page.locator('#field-email').waitFor({ timeout: COLD_MS });
  await page.locator('#field-email').fill(ownerEmail);
  await page.locator('#field-password').fill(ownerPassword);
  await page.locator('form button[type="submit"]').click();
  await page.locator('[data-testid="dashboard"]').waitFor({ timeout: COLD_MS });
}

/** Opens the first screen and waits until the shell is there. */
export async function openDashboard(page: Page): Promise<void> {
  await page.goto(`${server}/admin`, { waitUntil: 'domcontentloaded', timeout: COLD_MS });
  await page.locator('[data-testid="dashboard"]').waitFor({ timeout: COLD_MS });
}

/** A JSON call of the owner interface with the context's cookie and JWT. */
export async function api(context: BrowserContext, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, data?: unknown) {
  const res = await context.request.fetch(`${server}/cms-api${path}`, { method, data, headers: originHeaders });
  return { status: res.status(), body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}
