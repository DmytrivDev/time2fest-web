import { TimeResponseSchema } from '@time2fest/contracts/schemas';
import { describe, expect, it } from 'vitest';

const EXPECTED_HEADERS: Record<string, string> = {
  'cache-control': 'no-store, max-age=0',
  'content-type': 'application/json; charset=utf-8',
  'x-robots-tag': 'noindex',
};

/** One behaviour suite for GET /api/time, run on the sim function and on the http server (AC-64, AC-40). */
export function describeDomain(name: string, makeFetch: () => Promise<Response>): void {
  describe(name, () => {
    it('answers 200 with the bare { now } body and the three headers', async () => {
      const before = Date.now();
      const res = await makeFetch();
      const after = Date.now();
      expect(res.status).toBe(200);
      for (const [k, v] of Object.entries(EXPECTED_HEADERS)) expect(res.headers.get(k)).toBe(v);
      const body = (await res.json()) as Record<string, unknown>;
      expect(TimeResponseSchema.safeParse(body).success).toBe(true);
      expect(Object.keys(body)).toEqual(['now']);
      expect(body.now as number).toBeGreaterThanOrEqual(before - 5_000);
      expect(body.now as number).toBeLessThanOrEqual(after + 5_000);
    });
  });
}
