import { describe, expect, it } from 'vitest';
import { signInCodeMail } from '../../src/mail/templates/signInCode';

describe('signInCodeMail', () => {
  const m = signInCodeMail({ code: '123456', id: 'abc123', from: 'Time2Fest <no-reply@mail.time2fest.com>' });
  it('has code, validity and ignore line in text and html', () => {
    expect(m.subject).toContain('123456');
    for (const body of [m.text, m.html]) {
      expect(body).toContain('123456');
      expect(body).toContain('дійсний 10 хвилин');
      expect(body).toContain('проігноруйте');
    }
    expect(m.class).toBe('code');
  });
  it('contains no http(s) anywhere', () => {
    expect(JSON.stringify(m)).not.toMatch(/https?/i);
  });
  it('carries the four headers', () => {
    expect(m.headers['Auto-Submitted']).toBe('auto-generated');
    expect(m.headers['Resend-Idempotency-Key']).toBe('abc123');
    expect(m.headers['X-Entity-Ref-ID']).toBe('abc123');
    expect(m.headers['Message-ID']).toBe('<abc123@mail.time2fest.com>');
  });
});
