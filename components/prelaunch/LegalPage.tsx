'use client';

/** Документ мовного дерева (конфіденційність, cookies, умови): заголовок, «Коротко», розділи. Текст приходить з сервера готовим. */
import type { ReactNode } from 'react';
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { usePrefest } from '@/components/prefest/PrefestContext';
import { cn } from '@/components/primitives/cn';
import p from '@/components/prefest/prefest.module.css';
import { DEFAULT_LOCALE } from '@/i18n/locales';
import { PAGES } from '@/lib/prelaunch/href';
import type { LegalDoc, LegalId } from '@/lib/prelaunch/legal';
import type { SiteData } from '@/lib/prelaunch/site';
import { SiteShell } from './SiteShell';
import s from './site.module.css';

const TABS: readonly LegalId[] = ['terms', 'privacy', 'cookies'];

/** Розмітка в рядку: `**жирний**`, `[текст](адреса)`; внутрішні адреси отримують мову сторінки. */
function inline(text: string, href: (path: string) => string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={key++}>{inline(m[1], href)}</strong>);
    else {
      const url = m[3]!;
      out.push(
        url.startsWith('/') ? (
          <NextLink key={key++} href={href(url)}>
            {m[2]}
          </NextLink>
        ) : (
          <a
            key={key++}
            href={url}
            {...(url.startsWith('http') ? { rel: 'noopener noreferrer', target: '_blank' } : {})}
          >
            {m[2]}
          </a>
        ),
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Body({ doc }: { doc: LegalDoc }) {
  const t = useTranslations('prelaunch.legal');
  const { site } = usePrefest();
  if (!site) return null;
  const rich = (text: string) => inline(text, site.href);
  return (
    <article lang={doc.locale === site.locale ? undefined : doc.locale}>
      <div className={cn(p.wrap, s.head)}>
        <h1 className={s.h1}>{doc.title}</h1>
        {doc.updated ? <p className={s.note}>{t('updated', { date: doc.updated })}</p> : null}
        {/* Переклад не є чинною версією (план, розділ 7). */}
        {site.locale !== DEFAULT_LOCALE && site.locale !== 'uk' ? (
          <p className={s.note}>{t('prevails')}</p>
        ) : null}
        <nav aria-label={t('other')}>
          <ul className={s.docTabs}>
            {TABS.map((id) => (
              <li key={id}>
                <NextLink
                  href={site.href(PAGES[id])}
                  aria-current={id === doc.id ? 'page' : undefined}
                >
                  {t(id)}
                </NextLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className={p.wrap}>
        <div className={s.prose}>
          {doc.short ? (
            <div className={s.short}>
              <strong>{t('short')}</strong>
              <p>{rich(doc.short)}</p>
            </div>
          ) : null}
          {doc.sections.map((sec) => (
            <section key={sec.id} id={sec.id} aria-labelledby={`${sec.id}-h`}>
              <h2 id={`${sec.id}-h`}>{sec.title}</h2>
              {sec.blocks.map((b, i) => {
                if (b.kind === 'p') return <p key={i}>{rich(b.text)}</p>;
                if (b.kind === 'table')
                  return (
                    <div className={s.tableWrap} key={i}>
                      <table className={s.table}>
                        <thead>
                          <tr>
                            {b.head.map((c) => (
                              <th scope="col" key={c}>
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {b.rows.map((row, r) => (
                            <tr key={r}>
                              {row.map((c, n) => (
                                <td key={n}>{rich(c)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                const List = b.kind;
                return (
                  <List key={i}>
                    {b.items.map((item, n) => (
                      <li key={n}>{rich(item)}</li>
                    ))}
                  </List>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </article>
  );
}

export function LegalPage({ site, doc }: { site: SiteData; doc: LegalDoc }) {
  return (
    <SiteShell site={site} current={doc.id} page={`S-PL-LEGAL-${doc.id}`}>
      <Body doc={doc} />
    </SiteShell>
  );
}
