'use client';

/**
 * «Правила чату» на місці стрічки (дошки `O-CHAT-RULES`, v115; правка власника 2026-10-30): як налаштування чату —
 * кімнати вгорі й поле введення лишаються, «⋯» підсвічена. Шапка: «‹» (назад до налаштувань, чи до чату, якщо відкрито
 * не з них) і назва поруч, праворуч «діють у всіх кімнатах». Вступ у жовтуватій рамці й п’ять правил рядками: значок 36,
 * назва, пояснення — тексти вступу й правил на одній вертикалі. Унизу «Зрозуміло» (до чату) і «Повні правила сайту».
 */
import { useTranslations } from 'next-intl';
import type { RefObject } from 'react';
import { cn } from '@/components/primitives/cn';
import { Icon, type IconName } from '@/components/primitives/Icon';
import s from './chatRules.module.css';

const RULES: { key: 'kind' | 'length' | 'links' | 'slow' | 'report'; icon: IconName }[] = [
  { key: 'kind', icon: 'party' },
  { key: 'length', icon: 'text-short' },
  { key: 'links', icon: 'link-off' },
  { key: 'slow', icon: 'clock' },
  { key: 'report', icon: 'flag' },
];

export interface ChatRulesProps {
  id: string;
  titleRef: RefObject<HTMLHeadingElement | null>;
  /** «‹»: назад до налаштувань (`fromSettings`) чи до чату. */
  onBack: () => void;
  fromSettings: boolean;
  /** «Зрозуміло» — до чату. */
  onDone: () => void;
}

export function ChatRules({ id, titleRef, onBack, fromSettings, onDone }: ChatRulesProps) {
  const t = useTranslations('chat.rulesPanel');
  const chat = useTranslations('chat');
  return (
    <section id={id} aria-labelledby={`${id}-t`} className={cn('t2f-chat-log', s.panel)} data-chat-rules="">
      <div className={s.head}>
        <button
          type="button"
          aria-label={fromSettings ? t('back') : t('backChat')}
          onClick={onBack}
          className={cn('t2f-focus t2f-transition', s.back)}
        >
          <Icon name="chevron-left" size={20} />
        </button>
        <h2 id={`${id}-t`} ref={titleRef} tabIndex={-1} className={s.title}>
          {chat('rules')}
        </h2>
        <span className={s.note}>{t('allRooms')}</span>
      </div>
      <p className={s.intro}>
        <span aria-hidden="true" className={s.dot}>
          <Icon name="shield-check" size={18} />
        </span>
        <span>{t('intro')}</span>
      </p>
      <ul className={s.list}>
        {RULES.map(({ key, icon }) => (
          <li key={key} className={s.rule} data-rule={key}>
            <span aria-hidden="true" className={s.dot}>
              <Icon name={icon} size={18} />
            </span>
            <span className={s.text}>
              <span className={s.ruleTitle}>{t(`${key}Title`)}</span>
              <span className={s.ruleText}>{t(`${key}Text`)}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className={s.foot}>
        <button type="button" onClick={onDone} className={cn('t2f-focus t2f-transition', s.done)}>
          {t('done')}
        </button>
        <a href="/rules/" target="_blank" rel="noopener" className={cn('t2f-focus', s.full)}>
          {t('full')}
        </a>
      </div>
    </section>
  );
}
