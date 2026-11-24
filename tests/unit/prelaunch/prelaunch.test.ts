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
import esJson from '@/messages/es.json';
import frJson from '@/messages/fr.json';
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
    expect(m.described.map((c) => c.iso).sort()).toEqual(
      Object.keys(storiesUk)
        // Ключі `ISO@пояс` — тексти інших поясів, не окремі країни.
        .filter((k) => !k.includes('@'))
        .sort(),
    );
    const andorra = m.countriesByIso.get('UM'); // країна без набору (AD, потім EH отримали набори)
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
    expect(
      missingKeys(rawMessages(uk as never), rawMessages(en as never)).filter(
        (k) => !k.startsWith('prelaunch.overrides.'),
      ),
    ).toEqual([]);
    // Правки головної (`prelaunch.prefest`, `prelaunch.nav`) діють і англійською.
    const enSet = localeMessages('en', { uk: uk as never, en: en as never });
    expect((enSet.prefest as Record<string, Record<string, string>>).faq?.q5).toMatch(/first/i);
    // Заголовок мапи — наявний «Мапа поясів» (рішення власника 2026-11-18: без «хто зустрічає першим»).
    expect((enSet.nav as Record<string, string>).map).not.toMatch(/first/i);
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
  it('8 видів сторінок: 7 постійних і сторінка кожної країни', () => {
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
    expect((source.nav as Record<string, string>).map).toBe('Мапа поясів');
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
    expect(countryIndexable('JP', ['en', 'uk'], true)).toBe(true);
    expect(countryIndexable('UM', ['en', 'uk'], true)).toBe(false);
    // Перемикач: з 2026-11-21 відкрито (опубліковані набори); `false` закриває всі країни.
    expect(countryIndexable('JP', ['en', 'uk'])).toBe(true);
    expect(countryIndexable('JP', ['en', 'uk'], false)).toBe(false);
    // Тексти задачі C — власні розповіді всіма чотирма мовами: описана країна відкрита й в іспанській збірці.
    expect(countryIndexable('JP', ['en', 'uk', 'es', 'fr'], true)).toBe(true);
    expect(countryIndexable('UM', ['en', 'uk', 'es', 'fr'], true)).toBe(false);
  });
});

describe('відлік сцени понад добу', () => {
  it('«29:23:59:59» без літери; менше доби — як і досі', async () => {
    const { sceneCountdownParts } = await import('@/components/player/SceneMidnight');
    const day = 86_400_000;
    expect(sceneCountdownParts(29 * day + 23 * 3_600_000 + 59 * 60_000 + 59_000, true).text).toBe(
      '29:23:59:59',
    );
    expect(sceneCountdownParts(5 * 60_000, true).text).toBe('00:05:00');
    // Сайт свята (без `days`) — без змін: години понад добу.
    expect(sceneCountdownParts(2 * day, false).text).toBe('48:00:00');
  });

  it('усі відліки — один формат: мапа й список країн з днями у збірці передстартового сайту', async () => {
    const { formatCountdown, COUNTDOWN_DAYS } = await import('@/lib/i18n/time');
    const day = 86_400_000;
    // Збірка сайту свята (тести) — години, як і досі.
    expect(COUNTDOWN_DAYS).toBe(false);
    expect(formatCountdown(43 * day + 2 * 3_600_000 + 35 * 60_000 + 36_000)).toBe('1034:35:36');
    expect(formatCountdown(43 * day + 2 * 3_600_000 + 35 * 60_000 + 36_000, true)).toBe(
      '43:02:35:36',
    );
    expect(formatCountdown(22 * 60_000 + 15_000, true)).toBe('00:22:15');
    expect(formatCountdown(day, true)).toBe('1:00:00:00');
  });
});

describe('тексти до гідратації — «за UTC»', () => {
  it('підписи часу відвідувача стають UTC; решта тексту без змін', async () => {
    const { utcWording } = await import('@/lib/prelaunch/utcWording');
    const m = {
      a: { b: 'північ о {time} за твоїм часом', c: 'Час — за вашим часом.' },
      d: 'без часу',
    };
    expect(utcWording(m, 'uk')).toEqual({
      a: { b: 'північ о {time} за UTC', c: 'Час — за UTC.' },
      d: 'без часу',
    });
    expect(utcWording({ x: 'at {when} your time' }, 'en')).toEqual({ x: 'at {when} UTC' });
    expect(utcWording({ x: 'medianoche a tu hora' }, 'es')).toEqual({ x: 'medianoche en UTC' });
    expect(utcWording({ x: 'minuit à ton heure' }, 'fr')).toEqual({ x: 'minuit en UTC' });
  });
});

describe('метатексти сторінок', () => {
  it('бренд відпадає, якщо title довший за 65 знаків', async () => {
    const { fitTitle } = await import('@/lib/prelaunch/seo');
    expect(fitTitle('Новий рік 2027 у Японії: як святкують, традиції | Time2Fest')).toBe(
      'Новий рік 2027 у Японії: як святкують, традиції | Time2Fest',
    );
    expect(fitTitle('Новий рік 2027 у Великій Британії: як святкують, традиції | Time2Fest')).toBe(
      'Новий рік 2027 у Великій Британії: як святкують, традиції',
    );
    // Сторінка країни — стеля 70: бренд лишається.
    expect(
      fitTitle('Новий рік 2027 у Великій Британії: як святкують, традиції | Time2Fest', 70),
    ).toBe('Новий рік 2027 у Великій Британії: як святкують, традиції | Time2Fest');
  });
});

describe('сторінка країни: є сцена / немає сцени', () => {
  it('власна сцена — лише в країн із намальованою листівкою; решта — без сцени', async () => {
    const { hasPostcardScene } = await import('@/components/stamp/StampArt');
    expect(hasPostcardScene('fr-postcard')).toBe(true);
    expect(hasPostcardScene('AU-postcard')).toBe(true);
    expect(hasPostcardScene('ph-postcard')).toBe(false);
    expect(hasPostcardScene('postcard-template')).toBe(false);
  });
});

describe('очікувані трансляції для «Де дивитися»', () => {
  it('у даних лише країна, пояс і тип — без посилань і каналів', async () => {
    const expected = (await import('@/content/prelaunch/expected-streams.json')).default as {
      kinds: Record<string, string[]>;
    };
    const entries = Object.entries(expected.kinds);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, kinds] of entries) {
      expect(key).toMatch(/^[A-Z]{2}:utc[+-]\d{4}$/);
      for (const kind of kinds) expect(['celebration', 'tv', 'webcam', 'address']).toContain(kind);
    }
    // Звернення — лише в останню годину перед північчю: Франції (18:00–20:45) немає.
    expect(expected.kinds['FR:utc+0100']).not.toContain('address');
    expect(expected.kinds['UA:utc+0200']).toContain('address');
    expect(JSON.stringify(expected)).not.toMatch(/https?:/);
  });
});

describe('список країн: перша група — «Перший», не «Зараз»', () => {
  it('правка є всіма чотирма мовами', () => {
    const files = { uk: uk as never, en: en as never, es: esJson as never, fr: frJson as never };
    const now = (l: 'uk' | 'en' | 'es' | 'fr') =>
      (localeMessages(l, files) as { liveMap: { list: { now: string } } }).liveMap.list.now;
    expect(now('uk')).toBe('Перший');
    expect(now('en')).toBe('First');
    expect(now('es')).toBe('Primero');
    expect(now('fr')).toBe('Premier');
  });
});

describe('дужки в адресах посилань документів', () => {
  it('кодуються, текст і решта рядка — без змін', async () => {
    const { encodeLinkParens } = await import('@/lib/prelaunch/legal');
    expect(
      encodeLinkParens(
        '| [Commons](https://x.org/File:Dubai_2015_(15971984728).jpg) | [CC](https://c.org/) |',
      ),
    ).toBe(
      '| [Commons](https://x.org/File:Dubai_2015_%2815971984728%29.jpg) | [CC](https://c.org/) |',
    );
    expect(encodeLinkParens('Без посилань (і дужки лишаються).')).toBe(
      'Без посилань (і дужки лишаються).',
    );
  });
});
