'use client';

/**
 * Кабінет `/account/` за дошками `Desk-Cabinet-New2` / `Desk-Cabinet-New3` (рішення власника 2026-11-08; пароля немає —
 * вхід через Google або кодом із листа, рішення 2026-11-13). Ліворуч — один аркуш із розділами «Профіль» (аватар, нік,
 * прапор, плашка пасу, «Як ти входиш»: Google першим, зміна пошти кодом), «Налаштування», «Сповіщення», «Дані й акаунт».
 * Записи на сервер показують «Зберігаємо…» і «Не вдалося зберегти» (стани для `http`, у `sim` — затримки й відмови
 * `window.__t2f.api`). Десктоп: праворуч на місці чату — меню кабінету
 * (розділи, «Моє свято», «Вийти»); «☰ Меню» в шапці відкриває звичайне меню на тому ж місці. Телефон: чату немає, кнопка
 * розділів закріплена внизу — шторка. Гість — на вхід (з поверненням сюди).
 */
import { AccountSkeleton } from '@/components/skeleton/LiveSkeletons';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useHeaderPass, useHeaderUser, useHydrated } from '@/components/auth/session';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { Sheet } from '@/components/primitives/Sheet';
import { CLOSE_MS, useChatColumn, useOverlayOpen } from '@/components/shell/OverlayManager';
import { AccountData } from './AccountData';
import { AccountNotifications } from './AccountNotifications';
import { AccountProfile } from './AccountProfile';
import { AccountSettings } from './AccountSettings';
import { CabinetNav } from './CabinetNav';
import { useActiveSection, useChatSlot, useGuestRedirect } from './useAccountPage';
import s from './account.module.css';

export function AccountPage() {
  const t = useTranslations('account');
  const hydrated = useHydrated();
  const user = useHeaderUser();
  const hasPass = useHeaderPass();
  const chatColumn = useChatColumn();
  const overlayOpen = useOverlayOpen();
  const [sheet, setSheet] = useState(false);
  const [closing, setClosing] = useState(false);
  const signedIn = hydrated && user !== null;
  const slot = useChatSlot(chatColumn, signedIn);
  useGuestRedirect(hydrated, user);
  const active = useActiveSection(user);

  // До гідратації (і поки гостя переводимо на вхід) — скелетон кабінету, той самий, що в `account/loading.tsx` (2026-11-10).
  if (!hydrated || !user)
    return (
      <div id="content" tabIndex={-1} className="focus:outline-none" data-page="S-ACCOUNT">
        <AccountSkeleton />
      </div>
    );

  const closeSheet = () => {
    setClosing(true);
    window.setTimeout(() => {
      setSheet(false);
      setClosing(false);
    }, CLOSE_MS);
  };
  const activeLabel = t(`nav.${active}`);

  return (
    <div id="content" tabIndex={-1} className={cn(s.page, 'focus:outline-none')} data-page="S-ACCOUNT">
      <h1 className={s.h1}>{t('title')}</h1>
      <p className={s.pageLead}>{t('lead')}</p>
      <div className={s.sections}>
        <AccountProfile hasPass={hasPass} />
        <AccountSettings hasPass={hasPass} />
        <AccountNotifications />
        <AccountData />
      </div>

      {/* Десктоп: меню кабінету на місці чату; коли відкрите вікно (меню з шапки тощо) — на його місці вікно. */}
      {slot && !overlayOpen ? createPortal(<div className={s.navPanel}><CabinetNav active={active} hasPass={hasPass} /></div>, slot) : null}

      {/* Телефон і планшет: чату немає — кнопка розділів закріплена внизу, шторка з тим самим меню. */}
      {!chatColumn ? (
        <>
          <button type="button" onClick={() => setSheet(true)} aria-haspopup="dialog" className={cn('t2f-focus t2f-transition', s.bar)} data-cabinet-bar="">
            <Icon name="menu" size={20} />
            <span className={s.barLabel}>{t('barLabel')}</span>
            <b className={s.barTitle}>{activeLabel}</b>
            <Icon name="chevron-up" size={18} />
          </button>
          <Sheet open={sheet} onOpenChange={(v) => (v ? setSheet(true) : closeSheet())} closing={closing} title={t('navLabel')} boardHeader>
            <div className="px-2 pb-4">
              <CabinetNav active={active} hasPass={hasPass} onPick={closeSheet} />
            </div>
          </Sheet>
        </>
      ) : null}
    </div>
  );
}
