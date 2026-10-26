import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];

export async function runAxe(page: Page, opts: { exclude?: string[] } = {}) {
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  for (const sel of opts.exclude ?? []) builder = builder.exclude(sel);
  return (await builder.analyze()).violations;
}
