// @ts-check
// Підставний Cloudflare API для перевірки тримача імені (F1): прив’язки Custom Domain і записи DNS зони.
// Жодної мережі; кожен запит записується.

/**
 * @param {{
 *   bindings?: object[],
 *   records?: object[],
 *   bindingsStatus?: number,
 *   recordsStatus?: number,
 * }} [o]
 */
export function fakeCloudflare(o = {}) {
  /** @type {{ method: string, url: string }[]} */
  const calls = [];
  /** @param {number} status @param {object[]} result */
  const reply = (status, result) =>
    status === 200
      ? Response.json({ success: true, result })
      : Response.json({ success: false, errors: [{ code: 9109, message: 'Unauthorized to access requested resource' }] }, { status });
  const fetch = /** @type {typeof globalThis.fetch} */ (
    async (url, init) => {
      const u = String(url);
      calls.push({ method: init?.method ?? 'GET', url: u });
      if (u.includes('/workers/domains')) return reply(o.bindingsStatus ?? 200, o.bindings ?? []);
      if (u.includes('/dns_records')) return reply(o.recordsStatus ?? 200, o.records ?? []);
      return new Response('not found', { status: 404 });
    }
  );
  return { fetch, calls };
}
