import { describe, expect, it } from 'vitest';
import { buildIcs } from '@/lib/prefest/ics';

describe('buildIcs', () => {
  it('подія в UTC з нагадуванням за 10 хв і екранованим текстом', () => {
    const ics = buildIcs(
      { uid: 'x', title: 'Північ · Париж, Франція', description: 'a;b', startMs: Date.parse('2026-12-31T23:00:00Z') },
      Date.parse('2026-11-17T10:00:00Z'),
    );
    expect(ics).toContain('DTSTART:20261231T230000Z');
    expect(ics).toContain('DTEND:20261231T233000Z');
    expect(ics).toContain('DTSTAMP:20261117T100000Z');
    expect(ics).toContain('SUMMARY:Північ · Париж\\, Франція');
    expect(ics).toContain('DESCRIPTION:a\\;b');
    expect(ics).toContain('TRIGGER:-PT10M');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
});
