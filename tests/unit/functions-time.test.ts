import { describe, expect, it } from 'vitest';
import { onRequestGet } from '@/functions/api/time';

describe('GET /api/time', () => {
  it('віддає серверний час і потрібні заголовки', async () => {
    const before = Date.now();
    const res = await onRequestGet();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { now: number };
    expect(Number.isInteger(body.now)).toBe(true);
    expect(body.now).toBeGreaterThanOrEqual(before);
    expect(Object.keys(body)).toEqual(['now']);
    expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
  });
});
