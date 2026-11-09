'use client';

/**
 * Службові сторінки (S-LEGAL) за дошкою `Desk-Legal-New2`, варіант B (рішення власника 2026-11-08): без чату; ліворуч
 * закріплений сайдбар «Документи» — під поточним документом його розділи (поточний розділ — жовта риска за прокруткою),
 * праворуч текст на решту ширини: заголовок і «Оновлено …» · «Коротко» · розділи з номерами (абзаци, посилання, списки,
 * таблиці; значок посилання на розділ) · «Інші документи» · «Нагору». Телефон: сайдбару немає — під шапкою закріплена
 * смуга «Зміст · 3. Навіщо ▾», дотик відкриває шторку з тим самим списком.
 */
import { NotifDialog } from '@/components/notifications/NotifDialog';
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { SkipLinks } from '@/components/primitives/a11y/SkipLinks';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { Sheet } from '@/components/primitives/Sheet';
import { useHeaderPass, useHeaderUser } from '@/components/auth/session';
import { Footer } from '@/components/shell/Footer';
import { CLOSE_MS } from '@/components/shell/OverlayManager';
import { Header } from '@/components/shell/Header';
import { Menu } from '@/components/shell/Menu';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
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

/** Документи; під поточним — його розділи (поточний розділ підсвічений). */
function SideNav({ id, active, onPick }: { id: LegalDocId; active: string; onPick?: () => void }) {
  const t = useTranslations('legal');
  const doc = legalDoc(id);
  const reduced = useReducedMotion();
  return (
    <nav aria-label={t('docsLabel')} className={s.side}>
      <p className={s.sideTitle}>{t('docsLabel')}</p>
      <ul className={s.docs}>
        {LEGAL_DOCS.map((d) => {
          const here = d.id === id;
          return (
            <li key={d.id}>
              <NextLink href={d.href} aria-current={here ? 'page' : undefined} onClick={onPick} className={cn('t2f-focus', s.doc)}>
                <Icon name="text-short" size={16} />
                {d.tab}
              </NextLink>
              {here ? (
                <ol aria-label={t('toc')} className={s.secs}>
                  {doc.sections.map((x, i) => (
                    <li key={x.id}>
                      <a
                        href={`#${x.id}`}
                        aria-current={active === x.id ? 'location' : undefined}
                        onClick={(e) => {
                          // Плавна прокрутка до розділу (власник 2026-11-08); «Зменшити рух» — без анімації.
                          e.preventDefault();
                          onPick?.();
                          const go = () => {
                            document.getElementById(x.id)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
                            history.replaceState(null, '', `#${x.id}`);
                          };
                          // Зі шторки — після того, як вона закриється.
                          if (onPick) setTimeout(go, 220);
                          else go();
                        }}
                        className={cn('t2f-focus', s.sec)}
                      >
                        <b>{i + 1}.</b>
                        <span>{x.title}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function LegalPage({ id }: { id: LegalDocId }) {
  const t = useTranslations('legal');
  const announce = useAnnounce();
  const doc = legalDoc(id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const user = useHeaderUser();
  const hasPass = useHeaderPass();
  const [toTop, setToTop] = useState(false);
  const [active, setActive] = useState(doc.sections[0]?.id ?? '');
  const [sheet, setSheet] = useState(false);
  // Шторка закривається плавно, як і відкривається (власник 2026-11-08): спершу їде вниз `CLOSE_MS`, потім зникає.
  const [closing, setClosing] = useState(false);
  const closeSheet = () => {
    if (!sheet || closing) return;
    setClosing(true);
    window.setTimeout(() => {
      setSheet(false);
      setClosing(false);
    }, CLOSE_MS);
  };
  useEffect(() => {
    // Поточний розділ — останній, чий заголовок уже дійшов до верхньої третини екрана.
    const on = () => {
      setToTop(window.scrollY > window.innerHeight);
      let cur = doc.sections[0]?.id ?? '';
      for (const x of doc.sections) {
        const el = document.getElementById(x.id);
        if (el && el.getBoundingClientRect().top <= window.innerHeight / 3) cur = x.id;
      }
      setActive(cur);
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [doc]);
  const activeIndex = Math.max(0, doc.sections.findIndex((x) => x.id === active));

  const copyLink = (sectionId: string) => {
    const url = `${window.location.origin}${window.location.pathname}#${sectionId}`;
    void navigator.clipboard?.writeText(url).then(() => announce(t('copied')), () => undefined);
    history.replaceState(null, '', `#${sectionId}`);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background text-text">
      <SkipLinks targets={['content']} />
      <Header user={user} hasPass={hasPass} onMenuClick={() => setMenuOpen(true)} menuOpen={menuOpen} onNotificationsClick={() => setNotifOpen((v) => !v)} />
      <Menu open={menuOpen} onOpenChange={setMenuOpen} />
      <NotifDialog open={notifOpen} onOpenChange={setNotifOpen} />
      <main id="content" tabIndex={-1} className={cn(s.main, 'focus:outline-none')} data-page="S-LEGAL" data-legal={id}>
        {/* Телефон: закріплена смуга «Зміст · 3. Навіщо ▾» → шторка з документами й розділами. */}
        <button type="button" onClick={() => setSheet(true)} aria-haspopup="dialog" className={cn('t2f-focus', s.bar)} data-legal-bar="">
          <span className={s.barLabel}>{t('toc')}</span>
          <b className={s.barNum}>{activeIndex + 1}.</b>
          <span className={s.barTitle}>{doc.sections[activeIndex]?.title}</span>
          <Icon name="chevron-down" size={16} />
        </button>
        <Sheet open={sheet} onOpenChange={(v) => (v ? setSheet(true) : closeSheet())} closing={closing} title={t('toc')} boardHeader>
          <div className="px-2 pb-4">
            <SideNav id={id} active={active} onPick={closeSheet} />
          </div>
        </Sheet>

        <div className={s.layout}>
          <aside className={s.aside}>
            <SideNav id={id} active={active} />
          </aside>
          <div className={s.body}>
        <h1 className={s.h1}>{doc.title}</h1>
        <p className={s.updated}>{t('updated', { date: doc.updated })}</p>

        <p className={s.short}>
          <b>{t('short')}</b> {doc.short}
        </p>

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
          </div>
        </div>
      </main>
      <Footer />
      {toTop ? (
        <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className={cn('t2f-focus t2f-press', s.toTop)} data-action="to-top">
          <Icon name="chevron-up" size={16} />
          {t('toTop')}
        </button>
      ) : null}
    </div>
  );
}
