'use client';

/**
 * Вікно сповіщень O-NOTIF (дошка `Desk-Notif-New`, рішення власника 2026-11-09): десктоп — на місці чату, телефон — шторка до
 * відео. Список: «Нові · N» і «Прочитати все», нижче «Раніше» (приглушені). Кожне — значок свого кольору (з
 * прапором), назва, коротко, час, одна дія; клік — туди й «прочитано». «Налаштувати» — другий рівень того ж вікна
 * (`NotifSettings`, вона ж у кабінеті): «Усі сповіщення» і кожен тип. Порожньо — «Поки тихо».
 * Без стрибків (правка власника 2026-11-10): поки вікно відкрите, групи не перебудовуються — те, що було новим при
 * відкритті, лишається в групі «Нові» (після «Прочитати все» заголовок — просто «Нові»), а позначка «нове» (крапка)
 * лише гасне, не звільняючи місця. Розкладка не змінюється — змінюється тільки колір рядків (плавно, `t2f-transition`).
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { Switch } from '@/components/primitives/Switch';
import { useNow } from '@/lib/time/TimeProvider';
import { NOTIF_KINDS, useNotifStore, type Notif, type NotifKind } from '@/stores/notifications';
import s from './notifications.module.css';

export const KIND_ICON: Record<NotifKind, IconName> = {
  live: 'play',
  stamp: 'passport',
  reply: 'message',
  goal: 'star',
  streak: 'sparkles',
};

function useAgo() {
  const t = useTranslations('notif.ago');
  const now = useNow({ granularity: 'minute' });
  return (at: number) => {
    const min = Math.max(0, Math.round(((now || Date.now()) - at) / 60_000));
    if (min < 1) return t('now');
    if (min < 60) return t('min', { n: min });
    const h = Math.round(min / 60);
    return h < 24 ? t('hour', { n: h }) : t('day', { n: Math.round(h / 24) });
  };
}

const normPath = (p: string) => p.replace(/\/+$/, '') || '/';

function Item({ n, onGo }: { n: Notif; onGo?: (href: string) => void }) {
  const t = useTranslations('notif.items');
  const ago = useAgo();
  const markRead = useNotifStore((st) => st.markRead);
  const k = n.kind === 'goal' ? `goal.${n.params.what === 'zones' ? 'zones' : 'countries'}` : n.kind;
  return (
    <li>
      <NextLink
        href={n.href}
        onClick={() => {
          markRead(n.id);
          onGo?.(n.href);
        }}
        className={cn('t2f-focus t2f-transition', s.item, n.read ? s.read : s.unread)}
        data-notif={n.kind}
      >
        <span aria-hidden="true" className={cn(s.tile, s[n.kind])}>
          <Icon name={KIND_ICON[n.kind]} size={20} />
          {n.flag ? (
            <span className={s.tileFlag}>
              <Flag round code={n.flag} size="xs" decorative />
            </span>
          ) : null}
        </span>
        <span className={s.itemText}>
          <span className={s.itemHead}>
            <b className={s.itemTitle}>{t(`${k}.title`, n.params)}</b>
            <span className={s.ago}>{ago(n.createdAt)}</span>
          </span>
          <span className={s.itemBody}>{t(`${k}.text`, n.params)}</span>
          <span className={s.action}>{t(`${k}.action`, n.params)}</span>
        </span>
        {/* Крапка лишається на місці й гасне — ширина тексту, а з нею й висота рядка, не змінюються. */}
        <span className={cn(s.dot, n.read && s.dotOff)} aria-label={n.read ? undefined : t('unread')} aria-hidden={n.read ? true : undefined} />
      </NextLink>
    </li>
  );
}

export function NotificationsBody({ onSettings, onGo }: { onSettings: () => void; onGo?: () => void }) {
  const t = useTranslations('notif');
  const items = useNotifStore((st) => st.items);
  const markAllRead = useNotifStore((st) => st.markAllRead);
  // Нові на момент відкриття вікна — лишаються в групі «Нові», навіть прочитані (див. шапку).
  const [openedFresh] = useState(() => new Set(useNotifStore.getState().items.filter((x) => !x.read).map((x) => x.id)));
  const fresh = items.filter((x) => !x.read || openedFresh.has(x.id));
  const earlier = items.filter((x) => x.read && !openedFresh.has(x.id));
  const unread = fresh.filter((x) => !x.read).length;
  const configureRef = useRef<HTMLButtonElement>(null);

  // Клік по сповіщенню (власник 2026-11-10): вікно лишається відкритим, доки не відкриється нова сторінка, — без
  // проблиску чату між закриттям і переходом. Посилання на цю ж сторінку — закриваємо одразу.
  const pathname = usePathname();
  const leaving = useRef<string | null>(null);
  const onGoRef = useRef(onGo);
  useEffect(() => {
    onGoRef.current = onGo;
  });
  useEffect(() => {
    if (leaving.current === null || pathname === leaving.current) return;
    leaving.current = null;
    onGoRef.current?.();
  }, [pathname]);
  const go = (href: string) => {
    if (!onGo) return;
    let target = href;
    try {
      target = new URL(href, window.location.href).pathname;
    } catch {
      // відносне посилання без бази — як є
    }
    if (normPath(target) === normPath(pathname ?? '')) onGo();
    else leaving.current = pathname;
  };

  return (
    <div className={s.body} data-block="notif-list">
      {/* Верхній рядок: «Налаштувати» ліворуч, «Прочитати все» праворуч (коли є нові). */}
      <div className={s.top}>
        <button ref={configureRef} type="button" onClick={onSettings} className={cn('t2f-focus t2f-transition', s.configure)}>
          <Icon name="filter" size={16} />
          {t('configure')}
        </button>
        {unread ? (
          <button
            type="button"
            onClick={() => {
              markAllRead();
              // Кнопка зникає — фокус не губиться, а переходить на сусідню.
              configureRef.current?.focus();
            }}
            className={cn('t2f-focus', s.markAll)}
          >
            {t('markAll')}
          </button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <div className={s.empty}>
          <span className={s.emptyIcon}>
            <Icon name="bell" size={32} />
          </span>
          <b className={s.emptyTitle}>{t('emptyTitle')}</b>
          <p className={s.emptyText}>{t('emptyText')}</p>
        </div>
      ) : (
        <>
          {fresh.length ? (
            <section aria-labelledby="notif-new">
              <div className={s.groupHead}>
                <h3 id="notif-new" className={s.groupTitle}>
                  {t('fresh', { count: unread })}
                </h3>
              </div>
              <ul className={s.list}>
                {fresh.map((n) => (
                  <Item key={n.id} n={n} onGo={go} />
                ))}
              </ul>
            </section>
          ) : null}
          {earlier.length ? (
            <section aria-labelledby="notif-earlier">
              <h3 id="notif-earlier" className={cn(s.groupTitle, s.groupGap)}>
                {t('earlier')}
              </h3>
              <ul className={s.list}>
                {earlier.map((n) => (
                  <Item key={n.id} n={n} onGo={go} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Налаштування сповіщень — у вікні O-NOTIF і в кабінеті. */
export function NotifSettings({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('notif.settings');
  const enabled = useNotifStore((st) => st.enabled);
  const kinds = useNotifStore((st) => st.kinds);
  const setEnabled = useNotifStore((st) => st.setEnabled);
  const setKind = useNotifStore((st) => st.setKind);
  return (
    <div className={cn(s.settings, compact && s.settingsCompact)} data-block="notif-settings">
      <div className={s.master}>
        <Switch label={<span className={s.setTitle}>{t('all')}</span>} checked={enabled} onCheckedChange={setEnabled} className={s.switch} />
        <p className={s.setHint}>{t('allHint')}</p>
      </div>
      <ul className={s.list}>
        {NOTIF_KINDS.map((k) => (
          <li key={k} className={s.setRow}>
            <span aria-hidden="true" className={cn(s.tile, s.tileSm, s[k])}>
              <Icon name={KIND_ICON[k]} size={18} />
            </span>
            <span className={s.setText}>
              <Switch label={<span className={s.setTitle}>{t(`${k}.title`)}</span>} checked={enabled && kinds[k]} disabled={!enabled} onCheckedChange={(v) => setKind(k, v)} className={s.switch} />
              <span className={s.setHint}>{t(`${k}.hint`)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
