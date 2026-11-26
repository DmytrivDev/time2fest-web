'use client';

/**
 * Документ мовного дерева — наявна сторінка документів сайту (`components/legal/LegalDocView`, той самий вигляд: «Зміст» і
 * шторка на телефоні, бічна навігація документами й розділами, «Коротко», розділи, «Інші документи», «Нагору»). Тексти —
 * затверджені документи передстартового сайту (`content/prelaunch/legal/*.md`, розбір — `lib/prelaunch/legal.ts`);
 * у навігації — лише три документи цього сайту; внутрішні посилання — мовою сторінки; пошта — `support@time2fest.com`.
 */
import { useTranslations } from 'next-intl';
import { LegalDocView } from '@/components/legal/LegalDocView';
import legal from '@/components/legal/legal.module.css';
import { usePrefest } from '@/components/prefest/PrefestContext';
import type { LegalDoc } from '@/lib/prelaunch/legal';
import type { SiteData } from '@/lib/prelaunch/site';
import { SITE } from './SiteFooter';
import { SiteShell } from './SiteShell';

function Body({ doc, docs }: { doc: LegalDoc; docs: LegalDoc[] }) {
  const { site } = usePrefest();
  const t = useTranslations('prelaunch.legal');
  // Тексту мовою сторінки немає (іспанська, французька) — показуємо англійський і кажемо мовою сторінки, що діє він.
  const foreign = site && doc.locale !== site.locale;
  return (
    <LegalDocView
      notice={
        foreign ? (
          <p className={legal.short} lang={site.locale} data-legal-notice="">
            {t('englishNote')}
          </p>
        ) : undefined
      }
      doc={doc}
      docs={docs}
      email={SITE.email}
      hrefFor={(href) => (site && href.startsWith('/') ? site.href(href) : href)}
      wrap={(content, toTop) => (
        <>
          <div
            className={legal.main}
            data-legal={doc.id}
            lang={doc.locale === site?.locale ? undefined : doc.locale}
          >
            {content}
          </div>
          {toTop}
        </>
      )}
    />
  );
}

export function LegalPage({ site, doc, docs }: { site: SiteData; doc: LegalDoc; docs: LegalDoc[] }) {
  return (
    <SiteShell site={site} current={doc.id} page={`S-PL-LEGAL-${doc.id}`}>
      <Body doc={doc} docs={docs} />
    </SiteShell>
  );
}
