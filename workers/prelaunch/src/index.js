// Передстартовий сайт time2fest.com: статика з out-prelaunch віддається без цього коду (assets-only).
// Код запускається лише для шляхів run_worker_first у wrangler.json:
//   1) /media/hero/* — відео банера: Workers Static Assets на Range віддають 200 з цілим файлом, без Content-Range
//      (developers.cloudflare.com/workers/static-assets/billing-and-limitations/#range-requests); Safari без 206 відео
//      не грає. Тут — один діапазон bytes=a-b / a- / -n → 206 з Content-Range; без Range — 200 з Accept-Ranges.
//      Кеш — як у `_headers` для /media/* (доба): `_headers` на відповіді коду не діє.
//   2) /<мова?>/ambassadors/list/<будь-що> → 410 «сторінку прибрано» (рішення власника, docs/site/prelaunch-edge.md п. 1);
//      /<мова?>/ambassadors/list/ → 301 на головну мови (як `_redirects` для /ambassadors/list).
// На будь-якому хості, крім time2fest.com, додає X-Robots-Tag: noindex (технічна адреса *.workers.dev).
const MAIN_HOST = 'time2fest.com';
const LOCALES = ['uk', 'es', 'fr'];
const MEDIA_CACHE = 'public, max-age=86400';

function robots(url, headers) {
  if (url.hostname !== MAIN_HOST) headers.set('X-Robots-Tag', 'noindex');
  return headers;
}

async function media(request, env, url) {
  const asset = await env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }));
  if (asset.status !== 200) return asset;
  const headers = robots(url, new Headers(asset.headers));
  headers.set('Cache-Control', MEDIA_CACHE);
  headers.set('Accept-Ranges', 'bytes');
  headers.delete('Content-Encoding');
  const range = request.headers.get('Range');
  const m = range && range.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === '' && m[2] === '')) {
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(asset.body, { status: 200, headers });
  }
  const buf = await asset.arrayBuffer();
  const size = buf.byteLength;
  let start;
  let end;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) {
    headers.set('Content-Range', `bytes */${size}`);
    headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  const body = request.method === 'HEAD' ? null : buf.slice(start, end + 1);
  return new Response(body, { status: 206, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/media/hero/')) return media(request, env, url);
    const m = url.pathname.match(/^\/(?:(uk|es|fr|en)\/)?ambassadors\/list\/(.*)$/);
    if (!m) return env.ASSETS.fetch(request);
    const lang = m[1] && LOCALES.includes(m[1]) ? m[1] : '';
    const home = lang ? `/${lang}/` : '/';
    const headers = robots(url, new Headers({ 'Cache-Control': 'public, max-age=3600' }));
    if (m[2] === '') {
      headers.set('Location', home);
      return new Response(null, { status: 301, headers });
    }
    headers.set('Content-Type', 'text/html; charset=utf-8');
    const body =
      '<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex">' +
      '<title>410 — Time2Fest</title></head><body><p>This page has been removed. ' +
      `<a href="${home}">Time2Fest</a></p></body></html>`;
    return new Response(request.method === 'HEAD' ? null : body, { status: 410, headers });
  },
};
