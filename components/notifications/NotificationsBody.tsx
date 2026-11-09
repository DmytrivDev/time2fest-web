'use client';

/**
 * Вікно сповіщень O-NOTIF (дошка `Desk-Notif-New`, рішення власника 2026-11-09): десктоп — на місці чату, телефон — шторка до
 * відео. Список: «Нові · N» і «Позначити все прочитаним», нижче «Раніше» (приглушені). Кожне — значок свого кольору (з
 * прапором), назва, коротко, час, одна дія; клік — туди й «прочитано». «Налаштувати» — другий рівень того ж вікна
 * (`NotifSettings`, вона ж у кабінеті): «Усі сповіщення» і кожен тип. Порожньо — «Поки тихо».
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
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
  seat: 'seat',
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

function Item({ n, onGo }: { n: Notif; onGo?: () => void }) {
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
          onGo?.();
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
        {n.read ? null : <span className={s.dot} aria-label={t('unread')} />}
      </NextLink>
    </li>
  );
}

export function NotificationsBody({ onSettings, onGo }: { onSettings: () => void; onGo?: () => void }) {
  const t = useTranslations('notif');
  const items = useNotifStore((st) => st.items);
  const markAllRead = useNotifStore((st) => st.markAllRead);
  const fresh = items.filter((x) => !x.read);
  const earlier = items.filter((x) => x.read);

  return (
    <div className={s.body} data-block="notif-list">
      {/* Верхній рядок: «Налаштувати» ліворуч, «Позначити все прочитаним» праворуч (коли є нові). */}
      <div className={s.top}>
        <button type="button" onClick={onSettings} className={cn('t2f-focus t2f-transition', s.configure)}>
          <Icon name="filter" size={16} />
          {t('configure')}
        </button>
        {fresh.length ? (
          <button type="button" onClick={markAllRead} className={cn('t2f-focus', s.markAll)}>
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
                  {t('fresh', { count: fresh.length })}
                </h3>
              </div>
              <ul className={s.list}>
                {fresh.map((n) => (
                  <Item key={n.id} n={n} onGo={onGo} />
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
                  <Item key={n.id} n={n} onGo={onGo} />
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
