'use client';

/**
 * Сповіщення поза `(live)` (службові сторінки, вхід, 404) — у тому самому бічному вікні, що й меню (`SideDialog`): десктоп —
 * точно на місці колонки чату, телефон — шторка. Список ↔ «Налаштування» з «‹ Назад».
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { SideDialog } from '@/components/shell/Menu';
import { NotificationsBody, NotifSettings } from './NotificationsBody';

export function NotifDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('notif');
  const [view, setView] = useState<'list' | 'settings'>('list');
  const change = (v: boolean) => {
    if (!v) setView('list');
    onOpenChange(v);
  };
  return (
    <SideDialog
      open={open}
      onOpenChange={change}
      title={view === 'list' ? t('title') : t('settingsTitle')}
      onBack={view === 'settings' ? () => setView('list') : undefined}
    >
      {view === 'list' ? <NotificationsBody onSettings={() => setView('settings')} onGo={() => change(false)} /> : <NotifSettings />}
    </SideDialog>
  );
}
