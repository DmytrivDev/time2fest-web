import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PrefestPage } from '@/components/prefest/PrefestPage';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('prefest.meta');
  return {
    title: t('title'),
    description: t('description'),
    // Прототип на демо (рішення власника 2026-11-17): не індексувати; головною стане під час розгортання на основний домен.
    robots: { index: false, follow: false },
  };
}

/** Головна «до свята» — поки окрема адреса `/before` (група без плеєра й чату); у навігацію сайту не додається. */
export default function Page() {
  return <PrefestPage />;
}
