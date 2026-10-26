import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatClock,
  formatCountdown,
  formatMidnightAgo,
  formatShortCountdown,
  formatTimeForViewer,
  formatUtcHint,
} from '@/lib/i18n/time';

const LONDON = Date.parse('2027-01-01T00:00:00Z');

describe('formatTimeForViewer', () => {
  it('«03:00 за вашим часом» без дати в той самий день (Київ)', () => {
    const r = formatTimeForViewer(LONDON + 60 * 60_000, {
      now: Date.parse('2027-01-01T00:30:00Z'),
      timeZone: 'Europe/Kyiv',
    });
    expect(r.time).toBe('03:00');
    expect(r.date).toBeNull();
    expect(r.text).toBe('03:00 за вашим часом');
  });

  it('дата, якщо інший день', () => {
    const r = formatTimeForViewer('2027-01-01T00:00:00Z', {
      now: Date.parse('2026-12-31T20:00:00Z'),
      timeZone: 'Europe/Kyiv',
    });
    expect(r.date).toBe('1 січня');
    expect(r.text).toBe('1 січня, 02:00 за вашим часом');
  });

  it('12/24 год за мовою', () => {
    expect(formatClock(LONDON + 15 * 3_600_000 + 5 * 60_000, { locale: 'uk', timeZone: 'UTC' })).toBe('15:05');
    expect(formatClock(LONDON + 15 * 3_600_000 + 5 * 60_000, { locale: 'en-US', timeZone: 'UTC' })).toMatch(
      /^3:05\sPM$/,
    );
  });

  it('UTC лише для підказки', () => {
    const r = formatTimeForViewer(LONDON, { now: LONDON, timeZone: 'America/New_York' });
    expect(r.text).not.toContain('UTC');
    expect(r.utcHint).toBe('00:00 UTC');
    expect(formatUtcHint('2026-12-31T18:15:00Z')).toBe('18:15 UTC');
  });
});

describe('«північ була … тому»', () => {
  it('Intl.RelativeTimeFormat', () => {
    expect(formatMidnightAgo(38 * 60_000)).toBe('північ була 38 хв тому');
    expect(formatAgo(38 * 60_000 + 59_000)).toBe('38 хв тому');
    expect(formatAgo(20_000)).toMatch(/^20 с(ек\.)? тому$/);
    expect(formatAgo(2 * 3_600_000 + 5 * 60_000)).toMatch(/^2 год\.? тому$/);
  });
});

describe('відлік', () => {
  it('00:22:15 і 0:59', () => {
    expect(formatCountdown((22 * 60 + 15) * 1_000)).toBe('00:22:15');
    expect(formatCountdown(3 * 3_600_000 + 1_000)).toBe('03:00:01');
    expect(formatCountdown(0)).toBe('00:00:00');
    expect(formatCountdown(-5_000)).toBe('00:00:00');
    expect(formatCountdown(400)).toBe('00:00:01');
    expect(formatShortCountdown(59_000)).toBe('0:59');
    expect(formatShortCountdown(60_000)).toBe('1:00');
    expect(formatShortCountdown(5_000)).toBe('0:05');
  });
});
