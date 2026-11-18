import { describe, expect, it } from 'vitest';
import config from '../../../playwright.http.config';

describe('playwright.http.config', () => {
  it('runs at most 2 workers and starts no web server', () => {
    expect(config.workers).toBeLessThanOrEqual(2);
    expect(config).not.toHaveProperty('webServer');
  });

  it('has phone and desktop projects, the serial server-clock and edge-offline projects, and ignores prod specs', () => {
    expect(config.projects?.map((p) => p.name)).toEqual(['phone', 'desktop', 'server-clock', 'edge-offline']);
    const serverClock = config.projects?.find((p) => p.name === 'server-clock');
    expect(serverClock?.fullyParallel).not.toBe(true);
    expect(String(config.testIgnore)).toContain('prod');
  });
});
