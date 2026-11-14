'use client';

/** Розділ «Сповіщення» кабінету: налаштування сповіщень (спільний блок із вікном сповіщень). */

import { useTranslations } from 'next-intl';
import { NotifSettings } from '@/components/notifications/NotificationsBody';
import s from './account.module.css';

export function AccountNotifications() {
  const t = useTranslations('account.notifications');
  return (
    <section id="notifications" aria-labelledby="notifications-h" className={s.card}>
      <h2 id="notifications-h" className={s.h2}>
        {t('title')}
      </h2>
      <p className={s.lead}>{t('lead')}</p>
      <div className={s.rows}>
        <NotifSettings compact />
      </div>
    </section>
  );
}
