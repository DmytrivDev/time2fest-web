import type { Metadata } from 'next';
import { JsonLd } from '@/components/prelaunch/JsonLd';
import { LegalPage } from '@/components/prelaunch/LegalPage';
import { LEGAL_IDS, loadLegal } from '@/lib/prelaunch/legal';
import { localeOf, type LocaleParams } from '@/lib/prelaunch/params';
import { pageMetadata } from '@/lib/prelaunch/seo';
import { siteData } from '@/lib/prelaunch/siteData';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  return pageMetadata(await localeOf(params), 'refunds');
}

export default async function Page({ params }: { params: LocaleParams }) {
  const locale = await localeOf(params);
  return (
    <>
      <JsonLd locale={locale} page="refunds" crumb={{ name: loadLegal('refunds', locale).title, path: '/refunds/' }} />
      <LegalPage
        site={siteData(locale)}
        doc={loadLegal('refunds', locale)}
        docs={LEGAL_IDS.map((id) => loadLegal(id, locale))}
      />
    </>
  );
}
