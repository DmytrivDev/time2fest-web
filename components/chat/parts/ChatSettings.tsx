'use client';

/**
 * «Налаштування чату» — меню «⋯» у шапці чату (рішення власника 2026-10-30, дошки `O-CHAT-MENU · Налаштування чату на
 * місці стрічки`, v110). Стоїть на місці стрічки: кімнати вгорі й поле введення лишаються.
 * Перемикачі (усі — з пасом): тихий режим, перекладати повідомлення, сповіщати про відповіді, показувати мій шлях.
 * Без пасу перемикачі затемнені зі значком пасу; дотик розгортає під рядком плашку «Щоб увімкнути …, потрібен Новорічний пас»
 * з «Оформити пас» і «Дізнатись більше» (правка власника 2026-10-30: не вікно, а акордеон на місці); унизу — картка пасу.
 * Далі «Мій нік і прапор» (олівець → O-NICK) і «Правила чату».
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useId, useState, type Ref } from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { Reveal } from '@/components/primitives/Reveal';
import type { PassGateFeature } from '@/components/pass/PassGate';
import { formatUsd } from '@/lib/offers/format';
import { useSitePrices } from '@/lib/api/hooks/site';
import { effectivePref, useChatPrefs, type ChatPrefKey } from '@/stores/chatPrefs';
import s from './chatSettings.module.css';

export interface ChatSettingsProps {
  hasPass: boolean;
  /** Скільки привітань сховав тихий режим у цій кімнаті. */
  quietHidden: number;
  nick: string | null;
  flagCode: string | null;
  countryName?: string;
  onEditNick: () => void;
  onRules: () => void;
  onGetPass: () => void;
  /** Більше не відкривається з рядків (там плашка-акордеон); лишено для сумісності викликів. */
  onPassGate?: (feature: PassGateFeature) => void;
  titleRef?: Ref<HTMLHeadingElement>;
  id?: string;
}

const ROWS: { key: ChatPrefKey; icon: IconName; gate: PassGateFeature }[] = [
  { key: 'quiet', icon: 'filter', gate: 'quiet-mode' },
  { key: 'translate', icon: 'translate', gate: 'translate' },
  { key: 'notifyReplies', icon: 'bell', gate: 'notify-replies' },
  { key: 'showRoute', icon: 'route', gate: 'show-route' },
];

function PassBadge({ label }: { label: string }) {
  return (
    <span className={s.passBadge} role="img" aria-label={label}>
      <Icon name="ticket" size={12} strokeWidth={2.4} />
    </span>
  );
}

export function ChatSettings({
  hasPass,
  quietHidden,
  nick,
  flagCode,
  countryName,
  onEditNick,
  onRules,
  onGetPass,
  titleRef,
  id,
}: ChatSettingsProps) {
  const passPrice = useSitePrices().pass;
  const t = useTranslations('chat.settings');
  const chat = useTranslations('chat');
  const uid = useId();
  const prefs = useChatPrefs();
  const cardId = `${uid}-pass`;
  // Без пасу: яка плашка «потрібен пас» розгорнута під рядком (одна за раз).
  const [lockOpen, setLockOpen] = useState<ChatPrefKey | null>(null);

  const sub = (key: ChatPrefKey, on: boolean) => {
    if (key === 'quiet') return on && quietHidden > 0 ? t('quietHidden', { count: quietHidden }) : t('quietSub');
    if (key === 'translate') return t('translateSub', { lang: t('siteLang') });
    if (key === 'notifyReplies') return t('notifySub');
    return on || !hasPass ? t('routeSub') : t('routeSubOff');
  };
  const title = (key: ChatPrefKey) =>
    key === 'quiet' ? t('quiet') : key === 'translate' ? t('translate') : key === 'notifyReplies' ? t('notify') : t('route');

  return (
    <section id={id} aria-labelledby={`${uid}-t`} className={cn('t2f-chat-log', s.panel)} data-chat-settings={hasPass ? 'pass' : 'no-pass'}>
      <div className={s.head}>
        <h2 id={`${uid}-t`} ref={titleRef} tabIndex={-1} className={s.title}>
          {t('title')}
        </h2>
        {hasPass ? <span className={s.note}>{t('allRooms')}</span> : null}
      </div>
      <ul className={s.rows}>
        {ROWS.map(({ key, icon, gate }) => {
          const on = effectivePref(prefs, key, hasPass);
          const hi = key === 'quiet' && on && quietHidden > 0;
          return (
            // Відкрита плашка без пасу — одне ціле з рядком: спільна рамка, рядок підсвічено (правка власника 2026-10-30).
            <li key={key} className={s.group} data-open={!hasPass && lockOpen === key ? 'true' : undefined}>
              <button
                type="button"
                {...(hasPass
                  ? { role: 'switch', 'aria-checked': on }
                  : { 'aria-expanded': lockOpen === key, 'aria-controls': `${uid}-lock-${key}`, 'aria-describedby': cardId })}
                data-pref={key}
                className={cn('t2f-focus', s.row, !hasPass && s.locked, on && s.on)}
                onClick={() => (hasPass ? prefs.set(key, !on) : setLockOpen((v) => (v === key ? null : key)))}
              >
                <span aria-hidden="true" className={s.icon}>
                  <Icon name={icon} size={20} />
                </span>
                <span className={s.text}>
                  <span className={s.rowTitle}>
                    {title(key)}
                    {hasPass ? null : <PassBadge label={t('passBadge')} />}
                  </span>
                  <span className={cn(s.rowSub, hi && s.rowSubHi)}>{sub(key, on)}</span>
                </span>
                <span aria-hidden="true" className={s.switch}>
                  <span className={s.knob} />
                </span>
              </button>
              {hasPass ? null : (
                <Reveal open={lockOpen === key} id={`${uid}-lock-${key}`}>
                  <div className={s.lock} data-row="pass-lock" data-gate={gate}>
                    <p className={s.cardText}>{t(`lock.${key}`)}</p>
                    <div className={s.lockActions}>
                      <button type="button" onClick={onGetPass} className={cn('t2f-focus t2f-transition', s.cardBtn, s.lockBtn)}>
                        {t('getPass', { price: formatUsd(passPrice) })}
                      </button>
                      <NextLink href="/pass/" className={cn('t2f-focus', s.cardLink)}>
                        {t('more')}
                        <Icon name="arrow-right" size={14} strokeWidth={2} />
                      </NextLink>
                    </div>
                  </div>
                </Reveal>
              )}
            </li>
          );
        })}
      </ul>
      <hr aria-hidden="true" className={s.divider} />
      <div className={s.nickRow} data-row="nick">
        <span className={s.text}>
          <span className={s.caption}>{t('nick')}</span>
          {nick ? (
            <span className={s.nick}>
              {flagCode ? <Flag code={flagCode} size="xs" name={countryName} /> : null}
              <span className={s.nickText}>{nick}</span>
            </span>
          ) : (
            <span className={s.rowSub}>{t('noNick')}</span>
          )}
        </span>
        <button type="button" aria-label={t('nickEdit')} onClick={onEditNick} className={cn('t2f-focus t2f-transition', s.pencil)}>
          <Icon name="pencil" size={18} />
        </button>
      </div>
      <button type="button" onClick={onRules} className={cn('t2f-focus t2f-transition', s.rules)} data-row="rules">
        <span aria-hidden="true" className={s.icon}>
          <Icon name="info" size={20} />
        </span>
        <span className="flex-1">{chat('rules')}</span>
        <Icon name="chevron-right" size={18} className="text-text-muted" />
      </button>
      {hasPass ? null : (
        // Ліворуч значок і «Функції Новорічного пасу», праворуч «Дізнатись більше →» (правка власника 2026-10-30);
        // у вузькій колонці посилання переходить другим рядком (2026-11-10).
        <p id={cardId} className={s.legend} data-row="pass-legend">
          <span className={s.legendText}>
            <PassBadge label={t('passBadge')} />
            <span>{t('legend')}</span>
          </span>
          <NextLink href="/pass/" className={cn('t2f-focus', s.legendLink)}>
            {t('more')}
            <Icon name="arrow-right" size={14} strokeWidth={2} />
          </NextLink>
        </p>
      )}
    </section>
  );
}
