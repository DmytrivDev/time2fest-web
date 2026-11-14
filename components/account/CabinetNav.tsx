'use client';

/** Меню кабінету: розділи, «Моє свято» (паспорт, мій графік), «Вийти». На десктопі — на місці чату, на телефоні — у шторці. */

import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useHeaderUser } from '@/components/auth/session';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { HeaderAvatar } from '@/components/shell/Header';
import { CLOSE_MS } from '@/components/shell/OverlayManager';
import { authActions } from '@/lib/api/hooks/auth';
import { useStamps } from '@/lib/api/hooks/passport';
import { SECTIONS, type SectionId } from './accountSections';
import s from './account.module.css';

export function CabinetNav({ active, hasPass, onPick }: { active: SectionId; hasPass: boolean; onPick?: () => void }) {
  const t = useTranslations('account');
  const th = useTranslations('header');
  const user = useHeaderUser();
  const stamps = useStamps().length;
  const router = useRouter();
  if (!user) return null;
  const go = (id: SectionId) => {
    onPick?.();
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), onPick ? CLOSE_MS + 20 : 0);
  };
  return (
    <nav aria-label={t('navLabel')} className={s.nav} data-block="cabinet-nav">
      <div className={s.navWho}>
        <span className={s.navAvatar}>
          <HeaderAvatar user={user} pass={hasPass} label={th('passLabel')} />
        </span>
        <span>
          <b className={s.navName}>{user.name}</b>
          <span className={s.navSub}>{t('title')}</span>
        </span>
      </div>
      <ul className={s.navList}>
        {SECTIONS.map((x) => (
          <li key={x.id}>
            <a
              href={`#${x.id}`}
              aria-current={active === x.id ? 'location' : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(x.id);
              }}
              className={cn('t2f-focus t2f-transition', s.navItem)}
            >
              <span aria-hidden="true" className={s.navTile}>
                <Icon name={x.icon} size={18} />
              </span>
              <span className={s.navText}>{t(`nav.${x.id}`)}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className={s.navTitle}>{t('mine')}</p>
      <ul className={s.navList}>
        <li>
          <NextLink href="/passport/" className={cn('t2f-focus t2f-transition', s.navItem)}>
            <span aria-hidden="true" className={s.navTile}>
              <Icon name="passport" size={18} />
            </span>
            <span className={s.navText}>
              {t('passport')}
              <span className={s.navHint}>{stamps}</span>
            </span>
            <Icon name="chevron-right" size={16} className={s.chev} />
          </NextLink>
        </li>
        <li>
          <NextLink href="/schedule/" className={cn('t2f-focus t2f-transition', s.navItem)}>
            <span aria-hidden="true" className={s.navTile}>
              <Icon name="calendar" size={18} />
            </span>
            <span className={s.navText}>{t('schedule')}</span>
            <Icon name="chevron-right" size={16} className={s.chev} />
          </NextLink>
        </li>
      </ul>
      <button
        type="button"
        onClick={() => {
          void authActions.signOut();
          router.push('/');
        }}
        className={cn('t2f-focus t2f-transition', s.signOut)}
      >
        <Icon name="sign-out" size={18} />
        {t('signOut')}
      </button>
    </nav>
  );
}
