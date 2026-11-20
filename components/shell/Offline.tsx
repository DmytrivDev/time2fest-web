'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { StatusMessage } from '@/components/primitives/StatusMessage';
import { useSiteState } from '@/lib/api/hooks/site';
import { useOnline } from '@/lib/tv/useTvEnv';

/** Чи є мережа (`navigator.onLine` + події `online`/`offline`); на сервері й до гідратації — `true`. */
export { useOnline };

export interface OfflineNoticeProps {
  /** Керований режим (історії, тести); без нього береться `useOnline()`. */
  offline?: boolean;
  className?: string;
}

/**
 * C24 `OfflineNotice` (Phone-Offline). Одне повідомлення «Немає з’єднання · Відлік іде далі. Відео й чат повернуться самі»
 * в потоці сторінки (нічого не накладається на відео; остання картинка лишається у плеєрі). `role="status"` — ввічлива область:
 * без alert і без фокусу. Контейнер-оболонка стоїть у DOM завжди (порожня область), тож зчитувач оголошує саме появу тексту.
 * Зникає сам, коли мережа повернулась. Відлік не зупиняється: компонент його не чіпає.
 */
export function OfflineNotice({ offline, className }: OfflineNoticeProps) {
  const t = useTranslations('states');
  const online = useOnline();
  const { state } = useSiteState();
  const isOffline = offline ?? !online;
  // Червона кнопка (SPEC-08): той самий смуговий блок, текст `backendDown`; без мережі лишається `offline`.
  const outage = !isOffline && state?.outage === 'technical';
  const show = isOffline || outage;
  return (
    <div
      role="status"
      aria-live="polite"
      data-offline-notice={show ? 'on' : 'off'}
      className={cn(show && 'px-4 pt-3', className)}
    >
      {show ? (
        <StatusMessage kind={isOffline ? 'offline' : 'info'} className="mx-auto max-w-content-max">
          {isOffline ? t('offline') : t('backendDown')}
        </StatusMessage>
      ) : null}
    </div>
  );
}

export interface BackendDownProps {
  className?: string;
}

/**
 * C24 `BackendDown`: сервер недоступний — розклад показуємо зі статичної копії (її віддає сама сторінка),
 * а функції акаунта (вхід, пас, профіль) неактивні, і причина сказана текстом, а не лише сірим кольором.
 * Неактивні елементи ставлять `aria-disabled` та `aria-describedby={BACKEND_DOWN_ID}`.
 */
export const BACKEND_DOWN_ID = 'backend-down-note';

export function BackendDown({ className }: BackendDownProps) {
  const t = useTranslations('states');
  return (
    <div className={cn('px-4 pt-3', className)} data-backend-down="">
      <StatusMessage kind="info" className="mx-auto max-w-content-max">
        <span id={BACKEND_DOWN_ID}>{t('backendDown')}</span>
      </StatusMessage>
    </div>
  );
}
