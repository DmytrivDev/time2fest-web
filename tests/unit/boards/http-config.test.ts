import { describe, expect, it } from 'vitest';
import config from '../../../playwright.http.config';

describe('playwright.http.config', () => {
  it('runs at most 2 workers and starts no web server', () => {
    expect(config.workers).toBeLessThanOrEqual(2);
    expect(config).not.toHaveProperty('webServer');
  });

  it('has phone and desktop projects and ignores prod specs', () => {
    expect(config.projects?.map((p) => p.name)).toEqual(['phone', 'desktop']);
    expect(String(config.testIgnore)).toContain('prod');
  });
});
