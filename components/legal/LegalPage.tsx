'use client';

/**
 * Службові сторінки (S-LEGAL) за дошкою `Desk-Legal-New2`, варіант B (рішення власника 2026-11-08): без чату; ліворуч
 * закріплений сайдбар «Документи» — під поточним документом його розділи (поточний розділ — жовта риска за прокруткою),
 * праворуч текст на решту ширини: заголовок і «Оновлено …» · «Коротко» · розділи з номерами (абзаци, посилання, списки,
 * таблиці; значок посилання на розділ) · «Інші документи» · «Нагору». Телефон: сайдбару немає — під шапкою закріплена
 * смуга «Зміст · 3. Навіщо ▾», дотик відкриває шторку з тим самим списком.
 */
import { NotifDialog } from '@/components/notifications/NotifDialog';
import { useState } from 'react';
import { SkipLinks } from '@/components/primitives/a11y/SkipLinks';
import { cn } from '@/components/primitives/cn';
import { useHeaderPass, useHeaderUser } from '@/components/auth/session';
import { Footer } from '@/components/shell/Footer';
import { Header } from '@/components/shell/Header';
import { Menu } from '@/components/shell/Menu';
import { LEGAL_DOCS, legalDoc, type LegalDocId } from '@/lib/legal/docs';
import { LegalDocView } from './LegalDocView';
import s from './legal.module.css';

export function LegalPage({ id }: { id: LegalDocId }) {
  const doc = legalDoc(id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const user = useHeaderUser();
  const hasPass = useHeaderPass();

  return (
    <div className="flex min-h-dvh flex-col bg-background text-text">
      <SkipLinks targets={['content']} />
      <Header
        user={user}
        hasPass={hasPass}
        onMenuClick={() => setMenuOpen(true)}
        menuOpen={menuOpen}
        onNotificationsClick={() => setNotifOpen((v) => !v)}
      />
      <Menu open={menuOpen} onOpenChange={setMenuOpen} />
      <NotifDialog open={notifOpen} onOpenChange={setNotifOpen} />
      <LegalDocView
        doc={doc}
        docs={LEGAL_DOCS}
        wrap={(content, toTop) => (
          <>
            <main
              id="content"
              tabIndex={-1}
              className={cn(s.main, 'focus:outline-none')}
              data-page="S-LEGAL"
              data-legal={id}
            >
              {content}
            </main>
            <Footer />
            {toTop}
          </>
        )}
      />
    </div>
  );
}
