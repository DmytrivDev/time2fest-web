import type { Metadata } from 'next';
import { JsonLd } from '@/components/prelaunch/JsonLd';
import { LegalPage } from '@/components/prelaunch/LegalPage';
import { loadLegal } from '@/lib/prelaunch/legal';
import { localeOf, type LocaleParams } from '@/lib/prelaunch/params';
import { pageMetadata } from '@/lib/prelaunch/seo';
import { siteData } from '@/lib/prelaunch/siteData';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  return pageMetadata(await localeOf(params), 'terms');
}

export default async function Page({ params }: { params: LocaleParams }) {
  const locale = await localeOf(params);
  return (
    <>
      <JsonLd locale={locale} page="terms" />
      <LegalPage site={siteData(locale)} doc={loadLegal('terms', locale)} />
    </>
  );
}
