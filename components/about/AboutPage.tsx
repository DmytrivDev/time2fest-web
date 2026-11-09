'use client';

/**
 * Сторінка «Про нас» `/about/` (рішення власника 2026-11-09): поки проста — що таке Time2Fest, примітка, що розповідь
 * про команду й історію з’явиться згодом, і посилання «Написати нам». Оболонка така сама, як у службових сторінок
 * (шапка, меню, сповіщення, футер); сайдбару документів немає. Пошта — та сама, що у футері.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useHeaderPass, useHeaderUser } from '@/components/auth/session';
import { NotifDialog } from '@/components/notifications/NotifDialog';
import { SkipLinks } from '@/components/primitives/a11y/SkipLinks';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { Footer, SUPPORT_EMAIL } from '@/components/shell/Footer';
import { Header } from '@/components/shell/Header';
import { Menu } from '@/components/shell/Menu';
import s from './about.module.css';

export function AboutPage() {
  const t = useTranslations('aboutPage');
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
        current="about"
        onMenuClick={() => setMenuOpen(true)}
        menuOpen={menuOpen}
        onNotificationsClick={() => setNotifOpen((v) => !v)}
      />
      <Menu open={menuOpen} onOpenChange={setMenuOpen} />
      <NotifDialog open={notifOpen} onOpenChange={setNotifOpen} />
      <main id="content" tabIndex={-1} className={cn(s.main, 'focus:outline-none')} data-page="S-ABOUT">
        <h1 className={s.h1}>{t('title')}</h1>
        <p className={s.lead}>{t('lead')}</p>
        <p className={s.soon}>{t('soon')}</p>
        <a href={`mailto:${SUPPORT_EMAIL}`} className={cn('t2f-focus', s.mail)}>
          <Icon name="mail" size={16} />
          {t('write')}
        </a>
      </main>
      <Footer />
    </div>
  );
}
