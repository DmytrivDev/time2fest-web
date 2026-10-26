import { notFound } from 'next/navigation';
import { CountryPlaceholder } from '@/components/live/CountryPlaceholder';
import { getData } from '@/lib/data/load';

/**
 * Сторінка країни — тимчасова заглушка (US2 збудує S-COUNTRY). Потрібна вже в US1: «Лишитися тут ›» веде сюди
 * з головної клієнтським переходом у межах `(live)`, тож плеєр макета не перемонтовується (SC-003).
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return getData().countries.map((c) => ({ slug: c.slug }));
}

export default async function CountryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const country = getData().countriesBySlug.get(slug);
  if (!country) notFound();
  return <CountryPlaceholder iso={country.iso} />;
}
