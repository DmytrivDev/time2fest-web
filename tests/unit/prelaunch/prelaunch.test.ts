// Мовне дерево (передстартовий сайт): мови, адреси, набір текстів, дані країн, документи.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import countriesJson from '@/data/countries.json';
import extrasJson from '@/data/prelaunch/countries.json';
import storiesEn from '@/data/prelaunch/content/en.json';
import storiesUk from '@/data/prelaunch/content/uk.json';
import namesEn from '@/data/prelaunch/names/en.json';
import { buildLocales, DEFAULT_LOCALE, LOCALE_STATUS, LOCALES } from '@/i18n/locales';
import { getData } from '@/lib/data/load';
import { buildPrefestModel } from '@/lib/prefest/model';
import { countryPath, localeHref, splitLocalePath } from '@/lib/prelaunch/href';
import { parseLegal } from '@/lib/prelaunch/legal';
import {
  flatKeys,
  localeMessages,
  missingKeys,
  rawMessages,
  sourceMessages,
} from '@/lib/prelaunch/messageSet.mjs';
import { COUNTRY_EXTRAS, labelFor, localizeDataset, type SiteData } from '@/lib/prelaunch/site';
import en from '@/messages/en.json';
import uk from '@/messages/uk.json';
import * as routes from '../../../scripts/prelaunch/routes.mjs';

const siteEn: SiteData = { locale: 'en', names: namesEn, stories: storiesEn };
const siteUk: SiteData = { locale: 'uk', names: null, stories: storiesUk };

describe('мови', () => {
  it('головна мова — англійська; список скрипта збірки збігається з сайтом', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(routes.LOCALES).toEqual([...LOCALES]);
    expect(routes.DEFAULT_LOCALE).toBe(DEFAULT_LOCALE);
    expect(routes.LOCALE_STATUS).toEqual(LOCALE_STATUS);
  });

  it('збірка для домену не бере мови без перекладу; демо бере всі', () => {
    expect(buildLocales({ prelaunch: false })).toEqual(['en', 'uk', 'es', 'fr']);
    expect(buildLocales({ prelaunch: true })).toEqual(
      LOCALES.filter((l) => LOCALE_STATUS[l] !== 'pending'),
    );
    expect(buildLocales({ prelaunch: true, only: 'fr,uk,xx' })).toEqual(['uk', 'fr']);
  });
});

describe('адреси', () => {
  it('на домені головна мова без префікса, решта — з ним; у демо префікс у кожної', () => {
    expect(localeHref('en', '/countries/', true)).toBe('/countries/');
    expect(localeHref('uk', '/countries/', true)).toBe('/uk/countries/');
    expect(localeHref('en', '/countries/', false)).toBe('/en/countries/');
    expect(localeHref('uk', '/', false)).toBe('/uk/');
  });

  it('мова й шлях з адреси', () => {
    expect(splitLocalePath('/uk/country/japan/', true)).toEqual({
      locale: 'uk',
      path: '/country/japan/',
    });
    expect(splitLocalePath('/country/japan/', true)).toEqual({
      locale: 'en',
      path: '/country/japan/',
    });
    expect(splitLocalePath('/en/pass/', false)).toEqual({ locale: 'en', path: '/pass/' });
    expect(splitLocalePath('/uk', true)).toEqual({ locale: 'uk', path: '/' });
  });
});

describe('дані країн поза каталогом', () => {
  const catalog = (countriesJson as { countries: { iso: string; slug: string }[] }).countries;

  it('кожна країна каталогу має англійську адресу й головне місто; адреси унікальні', () => {
    expect(Object.keys(COUNTRY_EXTRAS).sort()).toEqual(catalog.map((c) => c.iso).sort());
    const slugs = Object.values(COUNTRY_EXTRAS).map((c) => c.urlSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    const data = getData();
    for (const [iso, x] of Object.entries(COUNTRY_EXTRAS))
      expect(data.citiesById.get(x.mainCityId)?.countryIso, iso).toBe(iso);
    expect(COUNTRY_EXTRAS.JP?.urlSlug).toBe('japan');
    expect(countryPath('japan')).toBe('/country/japan/');
  });

  it('файли data/prelaunch відповідають генератору', () => {
    expect(extrasJson.version).toBe(1);
    expect(Object.keys(namesEn.countries)).toHaveLength(catalog.length);
    expect(namesEn.countries.NZ).toBe('New Zealand');
    expect(namesEn.cities['rio-de-janeiro']).toBe('Rio de Janeiro');
  });

  it('розповіді обома мовами — про ті самі країни з тими самими традиціями', () => {
    expect(Object.keys(storiesEn).sort()).toEqual(Object.keys(storiesUk).sort());
    for (const [iso, s] of Object.entries(
      storiesUk as Record<string, { traditions: { id: string }[] }>,
    ))
      expect(
        (storiesEn as Record<string, { traditions: { id: string }[] }>)[iso]?.traditions.map(
          (t) => t.id,
        ),
      ).toEqual(s.traditions.map((t) => t.id));
  });
});

describe('модель головної в мовному дереві', () => {
  const base = getData();
  const model = (site: SiteData) =>
    buildPrefestModel(localizeDataset(base, site), {
      locale: site.locale,
      href: (c) => localeHref(site.locale, countryPath(COUNTRY_EXTRAS[c.iso]!.urlSlug), true),
      mainCityId: (iso) => COUNTRY_EXTRAS[iso]?.mainCityId,
      label: labelFor(base, site),
    });

  it('картка країни — про головне місто, а не про перший пояс (Окленд, Ріо)', () => {
    const m = model(siteUk);
    expect(m.countriesByIso.get('NZ')?.main).toEqual({ zoneId: 'utc+1300', city: 'Окленд' });
    expect(m.countriesByIso.get('BR')?.main).toEqual({
      zoneId: 'utc-0300',
      city: 'Ріо-де-Жанейро',
    });
    // `/before` будує модель без налаштувань — там усе як було.
    expect(buildPrefestModel(base).countriesByIso.get('NZ')?.main).toBeUndefined();
  });

  it('описані — лише країни з розповіддю цією мовою; заглушок каталогу немає', () => {
    const m = model(siteUk);
    expect(m.described.map((c) => c.iso).sort()).toEqual(Object.keys(storiesUk).sort());
    const andorra = m.countriesByIso.get('AD');
    expect(andorra?.described).toBe(false);
    expect(andorra?.text).toBe('');
    expect(andorra?.traditions).toEqual([]);
  });

  it('англійською — назви, міста, пам’ятки й адреси без кирилиці', () => {
    const m = model(siteEn);
    expect(m.countriesByIso.get('JP')?.name).toBe('Japan');
    expect(m.countriesByIso.get('JP')?.href).toBe('/country/japan/');
    expect(m.celebrations.map((c) => c.city)).toContain('Auckland');
    expect(m.celebrations.find((c) => c.iso === 'NZ')?.mediaSlot).toBe('city:auckland');
    const visible = [
      ...m.countries.map((c) => c.name),
      ...m.celebrations.flatMap((c) => [c.city, c.place]),
      ...m.countries.flatMap((c) => c.zones.map((z) => z.city ?? '')),
    ];
    expect(visible.filter((s) => /[А-Яа-яІіЇїЄєҐґ]/.test(s))).toEqual([]);
    expect(m.label('Токіо')).toBe('Tokyo');
  });

  it('українською адреси мають префікс мови', () => {
    expect(model(siteUk).countriesByIso.get('JP')?.href).toBe('/uk/country/japan/');
  });
});

describe('тексти', () => {
  const source = sourceMessages(uk as never);

  it('правки передстартової головної перекривають prefest лише в мовному дереві', () => {
    const prefest = source.prefest as Record<string, Record<string, string>>;
    expect(prefest.schedule?.tz).toBe('за твоїм часом');
    expect(prefest.hero?.countdownLabel).toBe('До першої півночі світу');
    expect(prefest.faq?.a3).not.toMatch(/увійти|Google/);
    // Сам uk.json для `/before` не змінився.
    expect((uk as never as { prefest: { schedule: { tz: string } } }).prefest.schedule.tz).toBe(
      'за вашим часом',
    );
    expect((source.prelaunch as Record<string, unknown>).prefest).toBeUndefined();
  });

  it('українські тексти мовного дерева звертаються на «ти»', () => {
    const all = flatKeys(source)
      .filter((k) => k.startsWith('prefest.') || k.startsWith('prelaunch.'))
      .map(
        (k) =>
          k
            .split('.')
            .reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], source) as string,
      );
    expect(
      all.filter((s) => /(?<![\p{L}])(ваш|вашим|вашого|вашій|ви можете|вам)(?![\p{L}])/iu.test(s)),
    ).toEqual([]);
  });

  it('англійська має всі ключі; мова без файла показує англійську', () => {
    expect(missingKeys(rawMessages(uk as never), rawMessages(en as never))).toEqual([]);
    // Правки головної (`prelaunch.prefest`, `prelaunch.nav`) діють і англійською.
    const enSet = localeMessages('en', { uk: uk as never, en: en as never });
    expect((enSet.prefest as Record<string, Record<string, string>>).faq?.q5).toMatch(/first/i);
    expect((enSet.nav as Record<string, string>).map).toMatch(/first/i);
    const fr = localeMessages('fr', { uk: uk as never, en: en as never, fr: {} });
    expect((fr.prelaunch as Record<string, Record<string, string>>).header?.home).toBe(
      (en as never as { prelaunch: { header: { home: string } } }).prelaunch.header.home,
    );
    expect(missingKeys(source, {}).length).toBe(flatKeys(source).length);
  });

  it('кожна сторінка має заголовок і опис обома мовами', () => {
    for (const messages of [source, en as never as typeof source]) {
      const meta = (messages.prelaunch as Record<string, Record<string, Record<string, string>>>)
        .meta!;
      for (const page of [
        'home',
        'countries',
        'country',
        'pass',
        'toasts',
        'about',
        'privacy',
        'cookies',
        'terms',
        'notFound',
      ]) {
        expect(meta[page]?.title, page).toBeTruthy();
        expect(meta[page]?.description, page).toBeTruthy();
      }
    }
  });
});

describe('документи', () => {
  const dir = path.join(process.cwd(), 'content', 'prelaunch', 'legal');

  it('три документи обома мовами розбираються: назва, дата, «Коротко», розділи', () => {
    for (const id of ['privacy', 'cookies', 'terms'] as const)
      for (const locale of ['uk', 'en'] as const) {
        const doc = parseLegal(
          id,
          locale,
          fs.readFileSync(path.join(dir, `${id}.${locale}.md`), 'utf8'),
        );
        expect(doc.title, `${id}.${locale}`).toBeTruthy();
        expect(doc.updated, `${id}.${locale}`).toMatch(/2026/);
        expect(doc.short.length, `${id}.${locale}`).toBeGreaterThan(40);
        expect(doc.sections.length, `${id}.${locale}`).toBeGreaterThan(3);
        expect(new Set(doc.sections.map((s) => s.id)).size).toBe(doc.sections.length);
      }
  });

  it('списки й таблиці', () => {
    const doc = parseLegal(
      'cookies',
      'en',
      '# T\n\n- **updated:** May 1, 2026\n\n**In short.** Short text.\n\n## A {#a}\n\nPara one\nstill one.\n\n- x\n- y\n\n1. one\n2. two\n\n| H1 | H2 |\n|---|---|\n| a | b |\n',
    );
    expect(doc.updated).toBe('May 1, 2026');
    expect(doc.short).toBe('Short text.');
    expect(doc.sections[0]?.blocks).toEqual([
      { kind: 'p', text: 'Para one still one.' },
      { kind: 'ul', items: ['x', 'y'] },
      { kind: 'ol', items: ['one', 'two'] },
      { kind: 'table', head: ['H1', 'H2'], rows: [['a', 'b']] },
    ]);
  });
});

describe('список дозволених сторінок', () => {
  it('9 видів сторінок: 8 постійних і сторінка кожної країни', () => {
    const allowed = routes.allowedRoutes();
    expect(allowed).toHaveLength(8 + Object.keys(COUNTRY_EXTRAS).length);
    expect(allowed).toContain('/country/japan/');
    expect(
      allowed.filter((r: string) =>
        /login|signup|account|pay|room|tv|before|schedule/.test(r.replace(/^\/country\/.*/, '')),
      ),
    ).toEqual([]);
    expect(routes.publicPath('en', '/pass/')).toBe('/pass/');
    expect(routes.publicPath('uk', '/pass/')).toBe('/uk/pass/');
  });
});

describe('рішення власника 2026-11-18 (SEO)', () => {
  const source = sourceMessages(uk as never);
  const strings = (tree: unknown, prefix: string) =>
    flatKeys(tree as never)
      .filter((k) => k.startsWith(prefix))
      .map(
        (k) =>
          [
            k,
            k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], tree),
          ] as const,
      );

  it('рік сезону — змінна: «2027» і «2026/27» не вписано в тексти мовного дерева', () => {
    for (const messages of [uk, en])
      expect(
        strings(messages, 'prelaunch.').filter(([, v]) => /2027|2026\/27/.test(String(v))),
      ).toEqual([]);
  });

  it('заголовок мапи й два нові питання FAQ — лише в мовному дереві', () => {
    expect((source.nav as Record<string, string>).map).toMatch(/першим/);
    expect((uk as never as { nav: { map: string } }).nav.map).toBe('Мапа поясів');
    const faq = (source.prefest as Record<string, Record<string, string>>).faq!;
    expect(faq.q5).toBeTruthy();
    expect(faq.q6).toBeTruthy();
    expect(faq.a5).toContain('{when}');
    expect((source.prelaunch as Record<string, unknown>).nav).toBeUndefined();
  });
});

describe('одне правило індексації сторінки країни', () => {
  it('відкрита лише країна з власною розповіддю кожною мовою збірки', async () => {
    const { countryIndexable } = await import('@/lib/prelaunch/siteData');
    expect(countryIndexable('JP', ['en', 'uk'])).toBe(true);
    expect(countryIndexable('AD', ['en', 'uk'])).toBe(false);
    // Іспанська показує англійську розповідь, але власної ще немає — сторінка закрита.
    expect(countryIndexable('JP', ['en', 'uk', 'es'])).toBe(false);
  });
});
