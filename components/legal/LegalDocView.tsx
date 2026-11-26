'use client';

/**
 * Документ без оболонки сайту — розмітку перенесено з `LegalPage` без змін (2026-11-18): смуга «Зміст» і шторка на
 * телефоні, бічна навігація документами й розділами, заголовок, «Коротко», розділи з копіюванням посилання, «Інші
 * документи», «Нагору». `LegalPage` обгортає його оболонкою сайту свята, передстартовий сайт — своєю (`wrap`).
 *
 * Опис сторінки (з `LegalPage`):
 * Службові сторінки (S-LEGAL) за дошкою `Desk-Legal-New2`, варіант B (рішення власника 2026-11-08): без чату; ліворуч
 * закріплений сайдбар «Документи» — під поточним документом його розділи (поточний розділ — жовта риска за прокруткою),
 * праворуч текст на решту ширини: заголовок і «Оновлено …» · «Коротко» · розділи з номерами (абзаци, посилання, списки,
 * таблиці; значок посилання на розділ) · «Інші документи» · «Нагору». Телефон: сайдбару немає — під шапкою закріплена
 * смуга «Зміст · 3. Навіщо ▾», дотик відкриває шторку з тим самим списком.
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { Sheet } from '@/components/primitives/Sheet';
import { CLOSE_MS } from '@/components/shell/OverlayManager';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import type { LegalBlock, LegalDoc } from '@/lib/legal/docs';
import s from './legal.module.css';

const SAME = (href: string) => href;

/** `**жирний**` і `[текст](/шлях/)` → вузли. */
function rich(text: string, hrefFor: (href: string) => string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((p, i) => {
    const bold = /^\*\*(.+)\*\*$/.exec(p);
    if (bold) return <b key={i}>{bold[1]}</b>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
    if (link) {
      const href = link[2]!;
      const external = /^(https?:|mailto:)/.test(href);
      return external ? (
        <a
          key={i}
          href={href}
          className={cn('t2f-focus', s.link)}
          {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {})}
        >
          {link[1]}
        </a>
      ) : (
        <NextLink key={i} href={hrefFor(href)} className={cn('t2f-focus', s.link)}>
          {link[1]}
        </NextLink>
      );
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}

function Block({ b, hrefFor }: { b: LegalBlock; hrefFor: (href: string) => string }) {
  if (b.kind === 'p') return <p className={s.p}>{rich(b.text, hrefFor)}</p>;
  if (b.kind !== 'table') {
    const List = b.kind;
    return (
      <List className={cn(s.list, b.kind === 'ol' ? s.ol : s.ul)}>
        {b.items.map((it, i) => (
          <li key={i}>{rich(it, hrefFor)}</li>
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
                <td key={j}>{rich(c, hrefFor)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Документи; під поточним — його розділи (поточний розділ підсвічений). */
function SideNav({
  doc,
  docs,
  hrefFor,
  active,
  onPick,
}: {
  doc: LegalDoc;
  docs: readonly LegalDoc[];
  hrefFor: (href: string) => string;
  active: string;
  onPick?: () => void;
}) {
  const t = useTranslations('legal');
  const id = doc.id;
  const reduced = useReducedMotion();
  return (
    <nav aria-label={t('docsLabel')} className={s.side}>
      <p className={s.sideTitle}>{t('docsLabel')}</p>
      <ul className={s.docs}>
        {docs.map((d) => {
          const here = d.id === id;
          return (
            <li key={d.id}>
              <NextLink
                href={hrefFor(d.href)}
                aria-current={here ? 'page' : undefined}
                onClick={onPick}
                className={cn('t2f-focus', s.doc)}
              >
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
                            document
                              .getElementById(x.id)
                              ?.scrollIntoView({
                                behavior: reduced ? 'auto' : 'smooth',
                                block: 'start',
                              });
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

export interface LegalDocViewProps {
  doc: LegalDoc;
  /** Документи в навігації й «Інших документах». */
  docs: readonly LegalDoc[];
  /** Внутрішня адреса з тексту → адреса сайту (передстартовий сайт додає мову). */
  hrefFor?: (href: string) => string;
  /** Пошта в «Залишилися питання?». */
  email?: string;
  /** Обгортка: вміст сторінки документа й кнопка «Нагору» (сайт свята ставить між ними підвал). */
  wrap?: (content: ReactNode, toTop: ReactNode) => ReactNode;
  /** Примітка під датою (передстартовий сайт: «діє англійська версія», коли тексту мовою сторінки немає). */
  notice?: ReactNode;
}

export function LegalDocView({
  doc,
  docs,
  hrefFor = SAME,
  email = 'support@time2fest.com',
  wrap,
  notice,
}: LegalDocViewProps) {
  const t = useTranslations('legal');
  const announce = useAnnounce();
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
  const activeIndex = Math.max(
    0,
    doc.sections.findIndex((x) => x.id === active),
  );

  const copyLink = (sectionId: string) => {
    const url = `${window.location.origin}${window.location.pathname}#${sectionId}`;
    void navigator.clipboard?.writeText(url).then(
      () => announce(t('copied')),
      () => undefined,
    );
    history.replaceState(null, '', `#${sectionId}`);
  };

  const content = (
    <>
      {/* Телефон: закріплена смуга «Зміст · 3. Навіщо ▾» → шторка з документами й розділами. */}
      <button
        type="button"
        onClick={() => setSheet(true)}
        aria-haspopup="dialog"
        className={cn('t2f-focus', s.bar)}
        data-legal-bar=""
      >
        <span className={s.barLabel}>{t('toc')}</span>
        <b className={s.barNum}>{activeIndex + 1}.</b>
        <span className={s.barTitle}>{doc.sections[activeIndex]?.title}</span>
        <Icon name="chevron-down" size={16} />
      </button>
      <Sheet
        open={sheet}
        onOpenChange={(v) => (v ? setSheet(true) : closeSheet())}
        closing={closing}
        title={t('toc')}
        boardHeader
      >
        <div className="px-2 pb-4">
          <SideNav doc={doc} docs={docs} hrefFor={hrefFor} active={active} onPick={closeSheet} />
        </div>
      </Sheet>

      <div className={s.layout}>
        <aside className={s.aside}>
          <SideNav doc={doc} docs={docs} hrefFor={hrefFor} active={active} />
        </aside>
        <div className={s.body}>
          <h1 className={s.h1}>{doc.title}</h1>
          <p className={s.updated}>{t('updated', { date: doc.updated })}</p>
          {notice}

          <p className={s.short}>
            <b>{t('short')}</b> {doc.short}
          </p>

          {doc.sections.map((sec, i) => (
            <section key={sec.id} id={sec.id} aria-labelledby={`${sec.id}-h`} className={s.section}>
              <div className={s.hRow}>
                <h2 id={`${sec.id}-h`} className={s.h2}>
                  {i + 1}. {sec.title}
                </h2>
                <button
                  type="button"
                  onClick={() => copyLink(sec.id)}
                  aria-label={t('copyLink', { title: sec.title })}
                  className={cn('t2f-focus', s.anchor)}
                >
                  <Icon name="link" size={16} />
                </button>
              </div>
              {sec.blocks.map((b, j) => (
                <Block key={j} b={b} hrefFor={hrefFor} />
              ))}
            </section>
          ))}

          <section aria-labelledby="legal-other" className={s.other}>
            <h2 id="legal-other" className={s.otherTitle}>
              {t('other')}
            </h2>
            <ul className={s.cards}>
              {docs
                .filter((d) => d.id !== doc.id)
                .map((d) => (
                  <li key={d.id}>
                    <NextLink href={hrefFor(d.href)} className={cn('t2f-focus', s.card)}>
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
                  <a href={`mailto:${email}`} className={cn('t2f-focus', s.link)}>
                    {c}
                  </a>
                ),
              })}
            </p>
          </section>
        </div>
      </div>
    </>
  );
  const toTopButton = (
    <>
      {toTop ? (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className={cn('t2f-focus t2f-press', s.toTop)}
          data-action="to-top"
        >
          <Icon name="chevron-up" size={16} />
          {t('toTop')}
        </button>
      ) : null}
    </>
  );
  return (
    <>
      {wrap ? (
        wrap(content, toTopButton)
      ) : (
        <>
          {content}
          {toTopButton}
        </>
      )}
    </>
  );
}
