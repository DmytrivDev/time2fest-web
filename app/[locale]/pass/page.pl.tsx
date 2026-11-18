import type { Metadata } from 'next';
import { JsonLd } from '@/components/prelaunch/JsonLd';
import { PassPage } from '@/components/prelaunch/PassPage';
import { localeOf, type LocaleParams } from '@/lib/prelaunch/params';
import { pageMetadata } from '@/lib/prelaunch/seo';
import { siteData } from '@/lib/prelaunch/siteData';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  return pageMetadata(await localeOf(params), 'pass');
}

export default async function Page({ params }: { params: LocaleParams }) {
  const locale = await localeOf(params);
  return (
    <>
      <JsonLd locale={locale} page="pass" />
      <PassPage site={siteData(locale)} />
    </>
  );
}
