'use client';

/**
 * «Мій графік» (`/schedule/`): окрема сторінка графіка (власник 2026-11-06). Поки порожня — заголовок і пояснення;
 * зміст (обрані півночі за поясами, нагадування) — за дошками, коли дійдемо до цього екрана. Сюди ведуть пункт меню
 * «Мій графік» і «Скласти графік» на сторінці режиму вечірки. Чат — як на інших сторінках без плеєра.
 */
import { useTranslations } from 'next-intl';
import { PageChat } from '@/components/chat/PageChat';

export function SchedulePage() {
  const t = useTranslations('schedulePage');
  return (
    <div className="flex flex-col gap-2 px-4 py-6 md:px-0" data-schedule-page="">
      <h1 className="text-headline-lg text-text">{t('title')}</h1>
      <p className="text-body text-text-secondary">{t('soon')}</p>
      <PageChat />
    </div>
  );
}
