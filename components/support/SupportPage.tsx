'use client';

/**
 * «Підтримати» (`/support/`) за дошкою `Desk-Support-New`, варіант A (рішення власника 2026-11-07, концепція
 * `support-concept-2026-11-07.md`). Сторінка з чатом «Світ» праворуч, вигляд — як оформлення пасу:
 * - героїчний блок: два золоті тости й 🥂 ліворуч, «Скажи тост на весь світ» праворуч;
 * - блок чайових (як під штампом, без «×»): «Підтримати $N» відкриває вікно «Чайові» — тост пишуть, поки оплачують;
 * - «Тости світу» — останні золоті тости з чату «Світ» (свої теж), «N тостів за свято · M країн» — соціальний доказ;
 * - «Хочеш більше від свята?» — Новорічний пас; «Питання й відповіді».
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { PageChat } from '@/components/chat/PageChat';
import { Faq } from '@/components/live/Faq';
import { cn } from '@/components/primitives/cn';
import { Emoji, EmojiText } from '@/components/primitives/Emoji';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { useOpenTipsWindow } from '@/components/tips/TipsWindow';
import { Tips } from '@/components/windows/Tips';
import chatScript from '@/data/chat-script.json';
import { useChatFeed } from '@/lib/chat-sim/store';
import { getData } from '@/lib/data/load';
import type { ChatMessage, ChatScriptFile } from '@/lib/data/types';
import { formatDurationShort } from '@/lib/i18n/time';
import { useNow, useTimeReady } from '@/lib/time/TimeProvider';
import { worldToasts } from '@/lib/tips/worldToasts';
import s from './support.module.css';

const FEED = 5;

function Bubble({ m, ago, fresh }: { m: ChatMessage; ago?: string; fresh?: boolean }) {
  const t = useTranslations('offers');
  return (
    <div className={cn(s.bubble, fresh && s.bubbleFresh)}>
      <span className={s.who}>
        {m.author?.flagCode ? <Flag round code={m.author.flagCode} size="xs" decorative /> : null}
        <b className={s.nick}>{m.author?.nick}</b>
        <span className="t2f-toast-badge">{t('toastBadge')}</span>
        {ago ? <span className={s.ago}>{ago}</span> : null}
      </span>
      <span className={s.text}>
        <EmojiText text={m.text ?? ''} />
      </span>
    </div>
  );
}

function WorldToasts() {
  const t = useTranslations('supportPage');
  const ready = useTimeReady();
  const now = useNow();
  const minute = Math.floor(now / 1000) * 1000;
  const own = useChatFeed((f) => f.rooms.world);
  // До готовності часу (сервер, перший кадр) — порожньо, щоб розмітка збігалась.
  const all = useMemo(() => {
    if (!ready) return [];
    const mine = (own ?? []).filter((m) => m.toast && m.author?.isMine && m.createdAt <= minute);
    return [...worldToasts(chatScript as ChatScriptFile, getData(), minute), ...mine].sort((a, b) => b.createdAt - a.createdAt);
  }, [own, minute, ready]);
  const countries = new Set(all.map((m) => m.author?.flagCode).filter(Boolean));
  const [open, setOpen] = useState(false);
  const restId = useId();
  const ago = (m: ChatMessage) => t('ago', { time: formatDurationShort(Math.max(60_000, now - m.createdAt)) });
  const flags = [...countries].slice(0, 8) as string[];
  return (
    <section aria-labelledby="support-toasts" className={s.box} data-world-toasts="">
      <div className={s.boxHead}>
        <h2 id="support-toasts" className={s.h2}>
          {t('toastsTitle')}
        </h2>
        <span className={s.spacer} />
        {all.length ? (
          <>
            <span aria-hidden="true" className={s.flags}>
              {flags.map((f) => (
                <Flag key={f} round code={f} diameter={18} decorative />
              ))}
            </span>
            <span className={s.meta}>{t('toastsMeta', { count: all.length, countries: countries.size })}</span>
          </>
        ) : null}
      </div>
      <p className={s.sub}>{t('toastsSub')}</p>
      {all.length ? (
        <>
          <ul className={s.feed}>
            {all.slice(0, FEED).map((m, i) => (
              <li key={m.id}>
                <Bubble m={m} fresh={i === 0} ago={ago(m)} />
              </li>
            ))}
          </ul>
          {/* «Переглянути всі» — решта тостів плавно розгортається (власник 2026-11-07: замість «Усі тости — у чаті»). */}
          {all.length > FEED ? (
            <>
              <div id={restId} className={s.rest} data-open={open || undefined} inert={!open}>
                <ul className={s.feed}>
                  {all.slice(FEED).map((m) => (
                    <li key={m.id}>
                      <Bubble m={m} ago={ago(m)} />
                    </li>
                  ))}
                </ul>
              </div>
              <button type="button" aria-expanded={open} aria-controls={restId} onClick={() => setOpen((v) => !v)} className={cn('t2f-focus', s.more)} data-action="toasts-all">
                {open ? t('toastsLess') : t('toastsAll', { count: all.length })}
                <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
              </button>
            </>
          ) : null}
        </>
      ) : (
        <p className={s.empty}>{t('toastsEmpty')}</p>
      )}
    </section>
  );
}

export function SupportPage() {
  const t = useTranslations('supportPage');
  const openTips = useOpenTipsWindow();
  const faq = (['subscription', 'pass', 'refund', 'noToast'] as const).map((k) => ({ id: k, question: t(`faq.${k}Q`), answer: t(`faq.${k}A`) }));
  return (
    <div id="content" tabIndex={-1} className={cn(s.page, 'focus:outline-none')} data-page="S-SUPPORT">
      <NextLink href="/" className={cn('t2f-focus', s.back)}>
        <Icon name="chevron-left" size={14} />
        {t('back')}
      </NextLink>

      <header className={s.hero}>
        <div aria-hidden="true" className={s.art}>
          <span className={cn(s.artBubble, s.artBack)}>
            <span className={s.who}>
              <Flag round code="JP" size="xs" decorative />
              <b>Hiro</b>
              <span className="t2f-toast-badge">тост</span>
            </span>
            Happy New Year з Токіо!
          </span>
          <span className={cn(s.artBubble, s.artFront)}>
            <span className={s.who}>
              <Flag round code="UA" size="xs" decorative />
              <b>Олена</b>
              <span className="t2f-toast-badge">тост</span>
            </span>
            🥂 Піднімаю келих за всіх, хто зустрічає Новий рік разом!
          </span>
          <span className={s.artGlass}>
            <Emoji char="🥂" size={48} />
          </span>
        </div>
        <div className={s.heroText}>
          <p className={s.kicker}>
            <Icon name="heart" size={14} />
            {t('kicker')}
          </p>
          <h1 className={s.h1}>{t('title')}</h1>
          <p className={s.lead}>{t('lead')}</p>
        </div>
      </header>

      <Tips onSupport={(amount) => openTips({ amount })} className={s.tips} />

      <WorldToasts />

      <NextLink href="/pass/" className={cn('t2f-focus', s.passCard)}>
        <span aria-hidden="true" className={s.passIcon}>
          <Icon name="ticket" size={18} />
        </span>
        <span className={s.passText}>
          <b>{t('passTitle')}</b>
          <span>{t('passText')}</span>
        </span>
        <span className={s.passLink}>
          {t('passLink')}
          <Icon name="chevron-right" size={14} />
        </span>
      </NextLink>

      <Faq items={faq} columns={2} className={s.faq} />
      <PageChat />
    </div>
  );
}
