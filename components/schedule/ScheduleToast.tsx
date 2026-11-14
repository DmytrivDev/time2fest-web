'use client';

/**
 * Тостер графіка (рішення власника 2026-11-06, дошки `Desk-Schedule-New` / `Phone-Schedule-New`): та сама плашка, що
 * «Вікно прибрано» в кімнаті — значок календаря, «Додано в графік — Бразилія», «Повернути», смужка відліку 6 с.
 * Десктоп: `fixed`, 16 px від низу, ширина колонки відео (без відео — колонки сторінки); як панель кімнати, ховається, щойно
 * підходить до відео (8 px) чи рядка кнопок під ним (16 px). Телефон: над згорнутим чатом.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useState, type CSSProperties } from 'react';
import { useBarGeometry } from '@/components/legal/CookieLayer';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { useOverActions } from '@/components/room/RoomTray';
import { useChatColumn } from '@/components/shell/OverlayManager';
import { profileActions } from '@/lib/api/hooks/auth';
import { hideScheduleToast, SCHEDULE_TOAST_MS, useScheduleToast } from './toastStore';
import s from './schedule.module.css';

export function ScheduleToast() {
  const t = useTranslations('schedulePage.toast');
  const toast = useScheduleToast((x) => x.toast);
  const column = useChatColumn();
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const active = !!toast;
  const { box, overVideo } = useBarGeometry(el, column, active);
  const overActions = useOverActions(el, active);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(hideScheduleToast, SCHEDULE_TOAST_MS);
    return () => window.clearTimeout(id);
  }, [toast]);

  if (!toast) return null;
  const style = column && box ? ({ left: box.left, width: box.width } as CSSProperties) : undefined;
  return (
    <div
      ref={setEl}
      key={toast.id}
      role="status"
      aria-live="polite"
      data-schedule-toast=""
      data-hidden={overVideo || overActions || (column && !box) ? 'true' : undefined}
      style={style}
      className={cn(s.toast, !column && s.toastPhone)}
    >
      <span aria-hidden="true" className={s.toastIcon}>
        <Icon name={toast.failed ? 'alert' : 'calendar-check'} size={18} />
      </span>
      <span className={s.toastText}>{toast.text}</span>
      {toast.failed ? null : (
        <button
          type="button"
          data-action="schedule-undo"
          onClick={() => {
            void profileActions.setSchedule(toast.prev);
            hideScheduleToast();
          }}
          className={cn('t2f-focus t2f-press', s.toastUndo)}
        >
          <Icon name="undo" size={16} />
          {t('undo')}
        </button>
      )}
      <span aria-hidden="true" className={s.toastBar} />
    </div>
  );
}
