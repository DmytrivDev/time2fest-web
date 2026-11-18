import type { Metadata } from 'next';
import { JsonLd } from '@/components/prelaunch/JsonLd';
import { ToastsPage } from '@/components/prelaunch/ToastsPage';
import { localeOf, type LocaleParams } from '@/lib/prelaunch/params';
import { pageMetadata } from '@/lib/prelaunch/seo';
import { siteData } from '@/lib/prelaunch/siteData';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  return pageMetadata(await localeOf(params), 'toasts');
}

export default async function Page({ params }: { params: LocaleParams }) {
  const locale = await localeOf(params);
  return (
    <>
      <JsonLd locale={locale} page="toasts" />
      <ToastsPage site={siteData(locale)} />
    </>
  );
}
