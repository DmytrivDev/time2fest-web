/**
 * AC-53, AC-58 end to end (run in W53): the corrections slice opens a confirm dialog with "було → стане"
 * and the zone's local time, cancel changes nothing, confirm saves, and hiding the only visible event
 * of a pair shows a warning first. Needs the seeded catalog (the `reset` door seeds it).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { api, configured, COLD_MS, openDashboard, ownerContext, signIn, SKIP_REASON } from './admin-support';

test.describe.configure({ mode: 'serial' });
test.setTimeout(COLD_MS * 2);
test.beforeEach(() => test.skip(!configured, SKIP_REASON));

interface Ev {
  eventId: string;
  countryIso: string;
  zoneId: string;
  slot: string;
  isMainCelebration?: boolean;
}

async function midnightEvents(context: BrowserContext): Promise<Ev[]> {
  const res = await api(context, 'GET', '/events?limit=2000&depth=0&sort=eventId&where[slot][equals]=midnight');
  return ((res.body as { docs?: Ev[] } | null)?.docs ?? []) as Ev[];
}

async function patchOf(context: BrowserContext, eventId: string) {
  const res = await api(context, 'GET', `/event-patches?depth=0&where[eventId][equals]=${encodeURIComponent(eventId)}`);
  return ((res.body as { docs?: Array<Record<string, unknown>> } | null)?.docs ?? [])[0];
}

async function select(page: Page, eventId: string) {
  await openDashboard(page);
  const slice = page.locator('[data-testid="corrections-slice"]');
  await slice.locator('[data-testid="corr-filter"]').fill(eventId);
  await expect(slice.locator('[data-testid="corr-event"] option', { hasText: eventId }).first()).toBeAttached({ timeout: COLD_MS });
  await slice.locator('[data-testid="corr-event"]').selectOption(eventId);
  await expect(slice.locator('[data-testid="corr-moment"]')).toBeVisible();
}

test('AC-53: a moment change opens the dialog with both values and the local time; cancel changes nothing; confirm saves', async ({ browser, request }) => {
  const context = await ownerContext(browser, request);
  const page = await context.newPage();
  await signIn(page);
  const [event] = await midnightEvents(context);
  expect(event, 'the seeded catalog has events').toBeTruthy();
  const id = (event as Ev).eventId;
  const before = await patchOf(context, id);

  await select(page, id);
  const momentInput = page.locator('[data-testid="corr-moment"]');
  const old = await momentInput.inputValue();
  const shifted = new Date(Date.parse(`${old}:00Z`) + 10 * 60_000).toISOString().slice(0, 16);
  await momentInput.fill(shifted);
  await page.locator('[data-testid="corr-save"]').click();

  const dialog = page.locator('[data-testid="corr-dialog"]');
  await expect(dialog).toBeVisible();
  const diff = dialog.locator('[data-testid="corr-diff-moment"]');
  await expect(diff).toContainText('було');
  await expect(diff).toContainText('стане');
  await expect(diff).toContainText('місцевий час');

  await dialog.locator('[data-testid="corr-cancel"]').click();
  await expect(dialog).toHaveCount(0);
  expect(await patchOf(context, id)).toEqual(before);

  await page.locator('[data-testid="corr-save"]').click();
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-testid="corr-confirm"]').click();
  await expect(page.locator('[data-testid="corr-message"]')).toHaveText('Збережено.');
  const saved = await patchOf(context, id);
  expect(saved?.moment).toBe(Date.parse(`${shifted}:00Z`));
  await context.close();
});

test('AC-58: hiding the only event of a pair shows the warning, then saves after confirm', async ({ browser, request }) => {
  const context = await ownerContext(browser, request);
  const page = await context.newPage();
  await signIn(page);
  const events = await midnightEvents(context);
  const pairs = new Map<string, Ev[]>();
  for (const e of events) pairs.set(`${e.countryIso}|${e.zoneId}`, [...(pairs.get(`${e.countryIso}|${e.zoneId}`) ?? []), e]);
  // A run leaves its patch behind: take a lone main event that no earlier run has already hidden.
  let lone: Ev | undefined;
  for (const g of pairs.values()) {
    const [only] = g;
    if (g.length === 1 && only?.isMainCelebration === true && (await patchOf(context, only.eventId))?.hidden !== true) {
      lone = only;
      break;
    }
  }
  test.skip(!lone, 'the seeded catalog has no country × zone pair with a single main event');
  const id = (lone as Ev).eventId;

  await select(page, id);
  await page.locator('[data-testid="corr-hidden"]').check();
  await page.locator('[data-testid="corr-save"]').click();
  const dialog = page.locator('[data-testid="corr-dialog"]');
  await expect(dialog.locator('[data-testid="corr-warning"]')).toBeVisible();
  expect((await patchOf(context, id))?.hidden ?? false).toBe(false);

  await dialog.locator('[data-testid="corr-confirm"]').click();
  await expect(page.locator('[data-testid="corr-message"]')).toHaveText('Збережено.');
  expect((await patchOf(context, id))?.hidden).toBe(true);
  await context.close();
});
