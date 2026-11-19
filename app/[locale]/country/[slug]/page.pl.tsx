import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CountryPage } from '@/components/prelaunch/CountryPage';
import { JsonLd } from '@/components/prelaunch/JsonLd';
import { isLocale } from '@/i18n/locales';
import { getData } from '@/lib/data/load';
import { countryMetadata } from '@/lib/prelaunch/seo';
import { COUNTRY_EXTRAS, inCountryOf, isoByUrlSlug } from '@/lib/prelaunch/site';
import { countryIndexable, describedIsos, siteData } from '@/lib/prelaunch/siteData';

type Params = Promise<{ locale: string; slug: string }>;

/** Сторінка є для кожної з 246 країн і територій; адреса — англійська, однакова для всіх мов (`urlSlug`). */
export function generateStaticParams() {
  return Object.values(COUNTRY_EXTRAS).map((c) => ({ slug: c.urlSlug }));
}
export const dynamicParams = false;

async function resolve(params: Params) {
  const { locale, slug } = await params;
  const iso = isoByUrlSlug(slug);
  if (!isLocale(locale) || !iso) notFound();
  const site = siteData(locale);
  const name = site.names?.countries[iso] ?? getData().countriesByIso.get(iso)?.name.uk ?? iso;
  return {
    locale,
    iso,
    slug,
    site,
    name,
    described: describedIsos(locale).includes(iso),
    indexable: countryIndexable(iso),
  };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, iso, name, slug, described, indexable, site } = await resolve(params);
  // Країна без розповіді кожною мовою — «лише факти»: `noindex`, без `hreflang`, не в `sitemap` (`countryIndexable`).
  return countryMetadata(
    locale,
    iso,
    name,
    slug,
    described,
    indexable,
    inCountryOf(site, iso),
    site.stories[iso]?.meta,
  );
}

export default async function Page({ params }: { params: Params }) {
  const { locale, iso, site, name, slug } = await resolve(params);
  return (
    <>
      <JsonLd locale={locale} page="country" crumb={{ name, path: `/country/${slug}/` }} />
      <CountryPage site={site} iso={iso} />
    </>
  );
}
