import { describe, expect, it } from 'vitest';
import { viewerZoneLabel } from '@/lib/i18n/time';

describe('підпис поясу «за вашим часом (…)»', () => {
  it('застарілі назви IANA — сучасним написанням (Kiev → Kyiv, правка власника 2026-10-31)', () => {
    expect(viewerZoneLabel('Europe/Kiev')).toBe('Kyiv');
    expect(viewerZoneLabel('Europe/Kyiv')).toBe('Kyiv');
    expect(viewerZoneLabel('Asia/Calcutta')).toBe('Kolkata');
    expect(viewerZoneLabel('America/New_York')).toBe('New York');
  });
});
