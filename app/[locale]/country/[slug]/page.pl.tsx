import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CountryPage } from '@/components/prelaunch/CountryPage';
import { JsonLd } from '@/components/prelaunch/JsonLd';
import { isLocale } from '@/i18n/locales';
import { getData } from '@/lib/data/load';
import { pageMetadata } from '@/lib/prelaunch/seo';
import { COUNTRY_EXTRAS, isoByUrlSlug } from '@/lib/prelaunch/site';
import { describedIsos, siteData } from '@/lib/prelaunch/siteData';

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
  return { locale, iso, site, name, described: describedIsos(locale).includes(iso) };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, name, described } = await resolve(params);
  // Країна без розповіді — «лише факти»: у пошук і `sitemap` не йде (план, розділ 8).
  return pageMetadata(locale, 'country', {
    values: { country: name },
    ...(described ? {} : { titleKey: 'titleFacts', descriptionKey: 'descriptionFacts' }),
    indexable: described,
  });
}

export default async function Page({ params }: { params: Params }) {
  const { locale, iso, site, name } = await resolve(params);
  return (
    <>
      <JsonLd locale={locale} page="country" values={{ country: name }} />
      <CountryPage site={site} iso={iso} />
    </>
  );
}
