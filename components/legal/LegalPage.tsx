'use client';

/**
 * Службові сторінки (S-LEGAL) за дошкою `Desk-Legal-New`, варіант B — на всю ширину вмісту (рішення власника
 * 2026-11-07, концепція `legal-concept-2026-11-07.md`). Без чату й лівої колонки: шапка, документ, футер.
 * Перемикач документів · заголовок і «Оновлено …» · «Коротко» · «Зміст» (десктоп — дві колонки, телефон — згорнутий) ·
 * розділи з номерами (абзаци, посилання, списки, таблиці; значок посилання на розділ) · «Інші документи» · «Нагору».
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { Accordion } from '@/components/primitives/Accordion';
import { SkipLinks } from '@/components/primitives/a11y/SkipLinks';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { Footer } from '@/components/shell/Footer';
import { Header } from '@/components/shell/Header';
import { Menu } from '@/components/shell/Menu';
import { LEGAL_DOCS, legalDoc, type LegalBlock, type LegalDocId } from '@/lib/legal/docs';
import s from './legal.module.css';

/** `**жирний**` і `[текст](/шлях/)` → вузли. */
function rich(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((p, i) => {
    const bold = /^\*\*(.+)\*\*$/.exec(p);
    if (bold) return <b key={i}>{bold[1]}</b>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
    if (link) {
      const href = link[2]!;
      const external = /^(https?:|mailto:)/.test(href);
      return external ? (
        <a key={i} href={href} className={cn('t2f-focus', s.link)} {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {})}>
          {link[1]}
        </a>
      ) : (
        <NextLink key={i} href={href} className={cn('t2f-focus', s.link)}>
          {link[1]}
        </NextLink>
      );
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}

function Block({ b }: { b: LegalBlock }) {
  if (b.kind === 'p') return <p className={s.p}>{rich(b.text)}</p>;
  if (b.kind !== 'table') {
    const List = b.kind;
    return (
      <List className={cn(s.list, b.kind === 'ol' ? s.ol : s.ul)}>
        {b.items.map((it, i) => (
          <li key={i}>{rich(it)}</li>
        ))}
      </List>
    );
  }
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            {b.head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{rich(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Toc({ sections }: { sections: { id: string; title: string }[] }) {
  return (
    <ol className={s.toc}>
      {sections.map((x, i) => (
        <li key={x.id}>
          <a href={`#${x.id}`} className={cn('t2f-focus', s.tocLink)}>
            <b>{i + 1}.</b>
            <span>{x.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

export function LegalPage({ id }: { id: LegalDocId }) {
  const t = useTranslations('legal');
  const announce = useAnnounce();
  const doc = legalDoc(id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toTop, setToTop] = useState(false);
  useEffect(() => {
    const on = () => setToTop(window.scrollY > window.innerHeight);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  const copyLink = (sectionId: string) => {
    const url = `${window.location.origin}${window.location.pathname}#${sectionId}`;
    void navigator.clipboard?.writeText(url).then(() => announce(t('copied')), () => undefined);
    history.replaceState(null, '', `#${sectionId}`);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background text-text">
      <SkipLinks targets={['content']} />
      <Header onMenuClick={() => setMenuOpen(true)} menuOpen={menuOpen} />
      <Menu open={menuOpen} onOpenChange={setMenuOpen} />
      <main id="content" tabIndex={-1} className={cn(s.main, 'focus:outline-none')} data-page="S-LEGAL" data-legal={id}>
        <nav aria-label={t('docsLabel')} className={s.tabs}>
          {LEGAL_DOCS.map((d) => (
            <NextLink key={d.id} href={d.href} aria-current={d.id === id ? 'page' : undefined} className={cn('t2f-focus', s.tab)}>
              {d.tab}
            </NextLink>
          ))}
        </nav>

        <h1 className={s.h1}>{doc.title}</h1>
        <p className={s.updated}>{t('updated', { date: doc.updated })}</p>

        <p className={s.short}>
          <b>{t('short')}</b> {doc.short}
        </p>

        <nav aria-label={t('toc')} className={s.tocBox}>
          <div className={s.tocDesk}>
            <p className={s.tocTitle}>{t('toc')}</p>
            <Toc sections={doc.sections} />
          </div>
          <div className={s.tocPhone}>
            <Accordion items={[{ value: 'toc', title: <span className={s.tocTitle}>{t('toc')}</span>, content: <Toc sections={doc.sections} /> }]} />
          </div>
        </nav>

        {doc.sections.map((sec, i) => (
          <section key={sec.id} id={sec.id} aria-labelledby={`${sec.id}-h`} className={s.section}>
            <div className={s.hRow}>
              <h2 id={`${sec.id}-h`} className={s.h2}>
                {i + 1}. {sec.title}
              </h2>
              <button type="button" onClick={() => copyLink(sec.id)} aria-label={t('copyLink', { title: sec.title })} className={cn('t2f-focus', s.anchor)}>
                <Icon name="link" size={16} />
              </button>
            </div>
            {sec.blocks.map((b, j) => (
              <Block key={j} b={b} />
            ))}
          </section>
        ))}

        <section aria-labelledby="legal-other" className={s.other}>
          <h2 id="legal-other" className={s.otherTitle}>
            {t('other')}
          </h2>
          <ul className={s.cards}>
            {LEGAL_DOCS.filter((d) => d.id !== id).map((d) => (
              <li key={d.id}>
                <NextLink href={d.href} className={cn('t2f-focus', s.card)}>
                  <Icon name="text-short" size={16} />
                  <span>
                    <b>{d.tab}</b>
                    <span>{d.about}</span>
                  </span>
                </NextLink>
              </li>
            ))}
          </ul>
          <p className={s.ask}>
            {t.rich('ask', {
              link: (c) => (
                <a href="mailto:support@time2fest.com" className={cn('t2f-focus', s.link)}>
                  {c}
                </a>
              ),
            })}
          </p>
        </section>
      </main>
      <Footer className="mt-0" />
      {toTop ? (
        <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className={cn('t2f-focus t2f-press', s.toTop)} data-action="to-top">
          <Icon name="chevron-up" size={16} />
          {t('toTop')}
        </button>
      ) : null}
    </div>
  );
}
