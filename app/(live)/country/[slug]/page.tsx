import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CountryLive } from '@/components/live/CountryLive';
import { getData } from '@/lib/data/load';

/**
 * Сторінка країни, пульт (S-COUNTRY, US2): склад — `components/live/CountryLive.tsx` (ІНВ 4.3).
 * Статичні сторінки для всіх країн з `countries.json`; невідомий slug — 404 (`dynamicParams = false`).
 * Перехід сюди з головної («Лишитися тут ›») — клієнтський у межах `(live)`: плеєр макета не перемонтовується (SC-003).
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return getData().countries.map((c) => ({ slug: c.slug }));
}

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const country = getData().countriesBySlug.get(slug);
  return country ? { title: `${country.name.uk} — Новий рік наживо` } : {};
}

export default async function CountryPage({ params }: Params) {
  const { slug } = await params;
  const country = getData().countriesBySlug.get(slug);
  if (!country) notFound();
  return <CountryLive iso={country.iso} />;
}
