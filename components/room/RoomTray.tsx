'use client';

/**
 * Панель кімнати перегляду на десктопі (варіант C, дошка `Desk-Room-Plus-2`, рішення власника 2026-11-05): знизу колонки
 * відео (чат праворуч не закриває), `position: fixed`. З’являється, коли в кімнаті два вікна й більше: «Кімната
 * перегляду · N з 4 вікон», мініатюри з «×» (перша — та, що зі звуком), вільні місця пунктиром, «Відкрити кімнату», «×» —
 * сховати до наступного «+». З’являється лише після «+» у цьому сеансі. Ніколи не лягає на відео й рядок кнопок під ним («Увімкнути звук», «Обрати трансляцію»,
 * кімната, вечірка): щойно підходить до них — виїжджає вниз (правка власника 2026-11-05: ховати раніше, ніж біля відео).
 * Телефон — без панелі (там підтвердження під рядком).
 */
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type CSSProperties } from 'react';
import { useBarGeometry } from '@/components/legal/CookieLayer';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { useChatColumn } from '@/components/shell/OverlayManager';
import { useLiveData } from '@/lib/api/hooks/live';
import { thumbOf } from '@/lib/live/thumb';
import { useGuestStore } from '@/stores/guest';
import { ROOM_LIMIT, useRoomStore } from '@/stores/room';
import { create } from 'zustand';
import { ROOM_HREF } from './useRoomViewport';
import s from './roomTray.module.css';

/**
 * Панель з’являється лише після «+» у цьому сеансі (правка власника 2026-11-05: кімната пам’ятає вікна з минулого разу —
 * панель не має вискакувати сама на старті); «×» — ховає до наступного «+».
 */
export const useTrayUi = create<{ open: boolean }>(() => ({ open: false }));

/** «+» додав трансляцію в кімнату — показати панель. */
export function openRoomTray(): void {
  useTrayUi.setState({ open: true });
}

/** Відступ від рядка кнопок під відео (панель ховається раніше, ніж підійде впритул). */
const GAP = 16;

/** Чи панель лягла б на рядок дій плеєра (видимий `[data-action-row]`). Тим самим ховається тостер графіка. */
export function useOverActions(el: HTMLElement | null, active: boolean): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!active || !el) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const row = [...document.querySelectorAll<HTMLElement>('[data-action-row]')].find((r) => r.offsetParent !== null);
      if (!row) return setOver(false);
      const r = row.getBoundingClientRect();
      const top = window.innerHeight - (parseFloat(getComputedStyle(el).bottom) || 0) - el.offsetHeight;
      setOver(r.bottom > top - GAP && r.top < window.innerHeight);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [el, active]);
  return over;
}

export function RoomTray() {
  const t = useTranslations('room.tray');
  const router = useRouter();
  const column = useChatColumn();
  const windows = useGuestStore((g) => g.room.windows);
  const soundSlot = useGuestStore((g) => g.room.soundSlot);
  const remove = useRoomStore((r) => r.remove);
  const open = useTrayUi((u) => u.open);
  const active = column && open && windows.length >= 2;
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const { box, overVideo } = useBarGeometry(el, true, active);
  const overActions = useOverActions(el, active);
  const liveData = useLiveData();
  if (!active) return null;

  const limit = ROOM_LIMIT.desktop;
  const full = windows.length >= limit;
  const data = liveData;
  const style = box ? ({ left: box.left, width: box.width } as CSSProperties) : undefined;
  return (
    <div
      ref={setEl}
      role="region"
      aria-label={t('label')}
      data-room-tray=""
      data-hidden={overVideo || overActions || !box ? 'true' : undefined}
      style={style}
      className={s.tray}
    >
      <span aria-hidden="true" className={s.icon}>
        <Icon name="grid4" size={18} />
      </span>
      <div className={s.text}>
        <b>{t('title')}</b>
        <span className={cn(full && s.full)}>{full ? t('full') : t('count', { count: windows.length, limit })}</span>
      </div>
      <span className={s.spacer} />
      <ul className={s.slots} aria-label={t('windows')}>
        {Array.from({ length: limit }, (_, i) => {
          const w = windows[i];
          if (!w) {
            return (
              <li key={`empty-${i}`} aria-hidden="true" className={s.empty}>
                <Icon name="plus" size={14} />
              </li>
            );
          }
          const title = data.chainsByEventId.get(w.eventId)?.sources.find((x) => x.id === w.sourceId)?.title.uk ?? '';
          const src = thumbOf({ id: w.sourceId, eventId: w.eventId });
          return (
            <li key={w.slot} className={s.slot} title={title}>
              {src ? (
                // Мініатюра YouTube: зовнішня адреса, next/image без оптимізації тут зайвий.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" loading="lazy" decoding="async" />
              ) : null}
              {w.slot === soundSlot ? (
                <span aria-hidden="true" className={s.sound}>
                  <Icon name="speaker" size={12} />
                </span>
              ) : null}
              <button type="button" aria-label={t('remove', { title })} onClick={() => remove(w.slot)} className={cn('t2f-focus', s.x)}>
                <Icon name="close" size={12} strokeWidth={2.4} />
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" data-action="open-room" onClick={() => router.push(ROOM_HREF)} className={cn('t2f-focus t2f-press', s.open)}>
        <Icon name="grid4" size={18} />
        {t('open')}
      </button>
      <button type="button" aria-label={t('hide')} onClick={() => useTrayUi.setState({ open: false })} className={cn('t2f-focus', s.close)}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
