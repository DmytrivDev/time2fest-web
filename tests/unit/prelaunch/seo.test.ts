import { describe, expect, it } from 'vitest';
import extrasJson from '@/data/prelaunch/countries.json';
import seoMeta from '@/content/prelaunch/seo-meta.json';
import * as files from '../../../scripts/prelaunch/seo-files.mjs';
import * as routes from '../../../scripts/prelaunch/routes.mjs';

const ALL = ['en', 'uk', 'es', 'fr'];
const extras = (extrasJson as { countries: Record<string, { urlSlug: string }> }).countries;

describe('метадані сторінок', () => {
  it('canonical і hreflang — повні адреси домену з кінцевою рискою, англійська без префікса', async () => {
    const { absoluteUrl, alternatesFor } = await import('@/lib/prelaunch/seo');
    expect(absoluteUrl('en', '/country/japan/')).toBe('https://time2fest.com/country/japan/');
    expect(absoluteUrl('uk', '/')).toBe('https://time2fest.com/uk/');
    const alts = alternatesFor('/pass/');
    expect(alts['x-default']).toBe('https://time2fest.com/pass/');
    expect(alts.uk).toBe('https://time2fest.com/uk/pass/');
  });

  it('title країни з роком — до 65 знаків шаблоном, не обрізанням', async () => {
    const { countryTitle } = await import('@/lib/prelaunch/seo');
    const feast: Record<string, string> = { uk: 'Новий рік', en: 'New Year', es: 'Año Nuevo', fr: 'Nouvel An' };
    const country = (seoMeta as unknown as { country: Record<string, Record<string, { title: string }>> }).country;
    for (const [iso, byLocale] of Object.entries(country))
      for (const [l, { title }] of Object.entries(byLocale)) {
        const full = `${feast[l]} 2027${title.slice(feast[l]!.length)}`;
        const t = countryTitle(full, l);
        expect([...t].length, `${iso} ${l}: ${t}`).toBeLessThanOrEqual(65);
        expect(t.endsWith(' | Time2Fest'), `${iso} ${l}: ${t}`).toBe(true);
        expect(t.startsWith(`${feast[l]} 2027`)).toBe(true);
      }
    expect(countryTitle('Новий рік 2027 у Великій Британії: як святкують, традиції | Time2Fest', 'uk')).toBe(
      'Новий рік 2027 у Великій Британії: традиції | Time2Fest',
    );
  });

  it('збірка тестів — не для домену: усе noindex', async () => {
    const { INDEX_BUILD, pageMetadata } = await import('@/lib/prelaunch/seo');
    expect(INDEX_BUILD).toBe(false);
    void pageMetadata;
  });
});

describe('метатексти сторінок країн — унікальні кожною мовою', () => {
  it('title і description 246 країн × 4 мови без повторів; «у країні» є для кожної', async () => {
    const { countryTitle } = await import('@/lib/prelaunch/seo');
    const inCountry = (await import('@/content/prelaunch/in-country.json')).default as unknown as Record<
      string,
      Record<string, string>
    >;
    const msgs: Record<string, { prelaunch: { meta: { country: Record<string, string> } } }> = {
      uk: (await import('@/messages/uk.json')).default as never,
      en: (await import('@/messages/en.json')).default as never,
      es: (await import('@/messages/es.json')).default as never,
      fr: (await import('@/messages/fr.json')).default as never,
    };
    const fill = (tpl: string, v: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');
    const isos = Object.keys(extras);
    expect(isos).toHaveLength(246);
    for (const l of ALL) {
      const m = msgs[l]!.prelaunch.meta.country;
      const titles = new Set<string>();
      const descriptions = new Set<string>();
      for (const iso of isos) {
        const form = inCountry[l]?.[iso];
        expect(form, `${l} ${iso}`).toBeTruthy();
        const v = { year: '2027', inCountry: form!, country: iso };
        titles.add(countryTitle(fill(m.titleFactsIn!, v), l));
        descriptions.add(fill(m.descriptionFactsIn!, v));
      }
      expect(titles.size, `${l}: title`).toBe(246);
      expect(descriptions.size, `${l}: description`).toBe(246);
    }
  });
});

describe('sitemap і robots', () => {
  it('sitemap: країни закриті перемикачем — 8 сторінок × 4 мови; відкриті — 84 × 4 (8 + 76 описаних країн)', () => {
    expect(files.openRoutes(ALL)).toEqual(routes.STATIC_ROUTES);
    expect(files.sitemapXml(ALL).count).toBe(32);
    expect(files.sitemapXml(ALL).text).not.toContain('/country/');
    const open = files.openRoutes(ALL, true);
    expect(open).toHaveLength(84);
    for (const r of routes.STATIC_ROUTES) expect(open).toContain(r);
    const { count, text } = files.sitemapXml(ALL, true);
    expect(count).toBe(336);
    expect(text).toContain('<loc>https://time2fest.com/uk/country/japan/</loc>');
    expect(text).not.toContain('/country/andorra/');
    expect(text.match(/hreflang="x-default"/g)).toHaveLength(336);
    expect(text).not.toMatch(/lastmod|priority|changefreq/);
  });

  it('robots.txt: домен — Allow і Sitemap; перегляд — Disallow', () => {
    expect(files.robotsTxt(true)).toBe(
      'User-agent: *\nAllow: /\n\nSitemap: https://time2fest.com/sitemap.xml\n',
    );
    expect(files.robotsTxt(false)).toContain('Disallow: /');
  });

  it('_headers для домену — без X-Robots-Tag, решта на місці', () => {
    const src = '/*\n  X-Robots-Tag: noindex, nofollow\n  Referrer-Policy: strict-origin-when-cross-origin\n';
    expect(files.headersForIndex(src)).toBe('/*\n  Referrer-Policy: strict-origin-when-cross-origin\n');
    // Файл із CRLF (Windows): рядок шляху не зливається з наступним.
    expect(files.headersForIndex(src.replace(/\n/g, '\r\n'))).toBe(
      '/*\r\n  Referrer-Policy: strict-origin-when-cross-origin\r\n',
    );
  });
});

describe('_redirects', () => {
  const { text, count, dynamic } = files.redirectsFile();
  const rules = text
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(' '));
  const known = new Set([
    ...routes.STATIC_ROUTES,
    ...Object.values(extras).map((c) => `/country/${c.urlSlug}/`),
  ]);

  it('у межах лімітів Cloudflare Pages, лише 301, без повторів', () => {
    expect(count).toBeLessThanOrEqual(2000);
    expect(dynamic).toBeLessThanOrEqual(100);
    for (const r of rules) expect(r[2]).toBe('301');
    const from = rules.map((r) => r[0]);
    expect(new Set(from).size).toBe(from.length);
  });

  it('кожна ціль — наявна сторінка (або /sitemap.xml, або :splat)', () => {
    for (const [, to] of rules) {
      if (to === '/sitemap.xml' || to!.includes(':splat')) continue;
      const bare = to!.replace(/^\/(uk|es|fr)(?=\/)/, '');
      expect(known.has(bare), to).toBe(true);
    }
  });

  it('старі адреси з SEO-звіту, розділ 7', () => {
    const map = new Map(rules.map((r) => [r[0], r[1]]));
    expect(map.get('/country')).toBe('/countries/');
    expect(map.get('/uk/country/uae')).toBe('/uk/country/united-arab-emirates/');
    expect(map.get('/en/country/columbia')).toBe('/country/colombia/');
    expect(map.get('/es/agreement')).toBe('/es/terms/');
    // І з кінцевою рискою: правило краю «без риски → з рискою» спрацьовує раніше за `_redirects`.
    expect(map.get('/es/agreement/')).toBe('/es/terms/');
    expect(map.get('/fr/contact/')).toBe('/fr/');
    expect(map.get('/login/')).toBe('/');
    expect(map.get('/fr/login')).toBe('/fr/');
    expect(map.get('/api/sitemap.xml')).toBe('/sitemap.xml');
    expect(map.get('/country/kosovo')).toBe('/countries/');
    expect(map.get('/country/t%C3%BCrkiye')).toBe('/country/turkey/');
    // Слаг не змінився — правила немає (Pages сам додасть кінцеву риску).
    expect(map.has('/country/japan')).toBe(false);
    // `/en/*` — останнім, після точних правил `/en/…`.
    expect(rules.at(-1)).toEqual(['/en/*', '/:splat', '301']);
    // Workers рахує динамічними всі правила після першого з `*` — тож жодного точного правила після нього.
    const firstDynamic = rules.findIndex(([from]) => String(from).includes('*'));
    expect(rules.slice(firstDynamic).every(([from]) => String(from).includes('*'))).toBe(true);
  });
});
