'use client';

/**
 * O-TRANSLATE-GATE — «Переклад повідомлень» без пасу (правка власника 2026-11-10): «Перекласти» в меню повідомлення
 * в людини без Новорічного пасу відкриває це вікно на місці чату (десктоп — у колонці чату, телефон — шторкою вікон
 * чату), замість старої плашки «Потрібен пас» унизу сторінки. Зверху вниз: що це (повідомлення іншими мовами —
 * українською, «Оригінал» поруч) · приклад у золотій картці: оригінал повідомлення, яке хотіли перекласти (або
 * привітання Hiro), і його переклад так, як він виглядає в чаті · «Оформити пас · $5» (коралова, той самий потік
 * покупки, що скрізь) і «Що дає пас». Закриття — × у шапці вікна.
 */
import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { cannedTranslation, messageLang } from '@/lib/chat/translate';
import type { ChatMessage } from '@/lib/data/types';
import { formatUsd, PASS_PRICE } from '@/lib/offers/format';
import s from './translateGate.module.css';

export const TRANSLATE_GATE_WINDOW_ID = 'O-TRANSLATE-GATE';

/** Приклад за замовчуванням — привітання Hiro зі сценарію чату. */
const FALLBACK = { nick: 'Hiro', flagCode: 'JP', lang: 'ja', original: '明けましておめでとうございます！' } as const;

/** Приклад для вікна: повідомлення, яке хотіли перекласти (якщо для нього є готовий переклад), інакше — Hiro. */
export function translateExample(message?: Pick<ChatMessage, 'text' | 'author'> & { lang?: string }) {
  const lang = message ? messageLang(message) : null;
  const translated = message?.text ? cannedTranslation(message.text) : undefined;
  if (message?.author && message.text && lang && translated) {
    return { nick: message.author.nick, flagCode: message.author.flagCode, lang, original: message.text, translated };
  }
  return { ...FALLBACK, translated: cannedTranslation(FALLBACK.original) ?? 'З Новим роком!' };
}

export interface TranslateGateProps {
  message?: ChatMessage;
  onGetPass?: () => void;
  onPassInfo?: () => void;
  className?: string;
}

export function TranslateGate({ message, onGetPass, onPassInfo, className }: TranslateGateProps) {
  const t = useTranslations('chat.translateGate');
  const tr = useTranslations('chat.translate');
  const ex = translateExample(message);
  const who = (
    <span className={s.who}>
      <Flag code={ex.flagCode} size="xs" decorative />
      <span className={s.nick}>{ex.nick}</span>
    </span>
  );
  return (
    <div data-window={TRANSLATE_GATE_WINDOW_ID} className={cn(s.root, className)}>
      <div className={cn('t2f-chat-log', s.body)}>
        <p className={s.badge}>
          <Icon name="ticket" size={14} strokeWidth={2.2} />
          {t('badge')}
        </p>
        <p className={s.lead}>{t('lead')}</p>
        <figure className={s.card} data-row="example">
          <figcaption className={s.caption}>{t('example')}</figcaption>
          <div className={s.msg} data-kind="original">
            <span className={s.tag}>{t('exampleOriginal')}</span>
            {who}
            <p className={s.text} lang={ex.lang}>
              {ex.original}
            </p>
          </div>
          <span aria-hidden="true" className={s.arrow}>
            <Icon name="translate" size={16} />
            <Icon name="arrow-down" size={14} />
          </span>
          <div className={s.msg} data-kind="translated">
            <span className={s.tag}>{t('exampleTranslated')}</span>
            {who}
            <p className={s.text}>{ex.translated}</p>
            <p className="t2f-msg-tr">
              <Icon name="translate" size={12} className="shrink-0" />
              <span>{tr('from', { lang: tr(`langs.${ex.lang}` as never) })}</span>
              <span aria-hidden="true">·</span>
              <span className={s.original}>{tr('original')}</span>
            </p>
          </div>
        </figure>
        <p className={s.auto}>{t('auto')}</p>
      </div>
      <div className={s.actions} data-row="actions">
        <Button variant="coral" className={s.btn} data-action="get-pass" onClick={() => onGetPass?.()}>
          {t('getPass', { price: formatUsd(PASS_PRICE) })}
        </Button>
        <Button variant="secondary" iconLeft="help" className={s.btn} data-action="pass-info" onClick={() => onPassInfo?.()}>
          {t('more')}
        </Button>
      </div>
    </div>
  );
}
