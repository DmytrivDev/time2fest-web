'use client';

/**
 * Частини сторінки «Тости світу» (`SupportPage`, `/support/`) для стану «до свята» без чату, вікна тосту й шва даних:
 * герой, «Тости відкриються разом зі святом», «Що таке тост» із трьома рівнями, картка пасу. Їх бере і `SupportPage`, і
 * передстартовий сайт (`components/prelaunch`) — тому окремим модулем.
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/components/primitives/cn';
import { Emoji, EmojiText } from '@/components/primitives/Emoji';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { ToastTiers, ToastBenefits } from '@/components/toast/ToastTiers';
import { getData } from '@/lib/data/load';
import { formatTimeForViewer } from '@/lib/i18n/time';
import { type ToastSeason, toastsOpenAt } from '@time2fest/rules/time';
import { useNow } from '@/lib/time/TimeProvider';
import s from './support.module.css';

/** До свята: коли тости відкриються — дата й час за часом людини. */
export function OpensAt() {
  const t = useTranslations('supportPage');
  const now = useNow({ granularity: 'minute' });
  const at = toastsOpenAt(getData());
  if (at === null) return null;
  const v = formatTimeForViewer(at, { now });
  return (
    <div className={s.opens} data-toasts-open="">
      <span aria-hidden="true" className={s.opensIcon}>
        <Icon name="clock" size={20} />
      </span>
      <div className={s.opensBody}>
        <p className={s.opensTitle}>{t('openTitle')}</p>
        <p className={s.opensWhen}>
          {t.rich('openWhen', { date: v.date ?? t('today'), time: v.time, b: (c: ReactNode) => <b className={s.opensTime}>{c}</b> })}
        </p>
        <p className={s.opensNote}>{t('openNote')}</p>
      </div>
    </div>
  );
}

/** До свята: що таке тост і три рівні — лише показ, без вибору й оплати. */
export function WhatIsToast() {
  const t = useTranslations('supportPage');
  return (
    <section aria-labelledby="support-what" className={s.box} data-toast-about="">
      <h2 id="support-what" className={s.h2}>
        {t('whatTitle')}
      </h2>
      <p className={s.sub}>{t('whatText')}</p>
      <p className={cn(s.label, s.labelGap)}>{t('tiersTitle')}</p>
      <div className={s.offerGrid}>
        <ToastTiers />
        <ToastBenefits hasPass={false} readOnly />
      </div>
    </section>
  );
}

/** Написи малюнка героя (за замовчуванням — як на сайті свята). */
export interface HeroArtText {
  badge: string;
  backNick: string;
  backText: string;
  frontNick: string;
  frontText: string;
}
const HERO_ART_UK: HeroArtText = {
  badge: 'тост',
  backNick: 'Hiro',
  backText: 'Happy New Year з Токіо!',
  frontNick: 'Олена',
  frontText: '🥂 Піднімаю келих за всіх, хто зустрічає Новий рік разом!',
};

export function Hero({ season, children, art = HERO_ART_UK }: { season: ToastSeason | null; children?: ReactNode; art?: HeroArtText }) {
  const t = useTranslations('supportPage');
  const kicker = season === 'before' ? t('kickerBefore') : season === 'after' ? t('kickerAfter') : season === 'during' ? t('kickerDuring') : null;
  const lead = season === 'before' ? t('leadBefore') : season === 'after' ? t('leadAfter') : season === 'during' ? t('leadDuring') : null;
  return (
    <header className={s.hero}>
      <div aria-hidden="true" className={s.art}>
        <span className={cn(s.artBubble, s.artBack)}>
          <span className={s.who}>
            <Flag code="JP" size="xs" decorative />
            <b>{art.backNick}</b>
            <span className="t2f-toast-badge">{art.badge}</span>
          </span>
          {art.backText}
        </span>
        <span className={cn(s.artBubble, s.artFront)}>
          <span className={s.who}>
            <Flag code="UA" size="xs" decorative />
            <b>{art.frontNick}</b>
            <span className="t2f-toast-badge">{art.badge}</span>
          </span>
          <span>
            <EmojiText text={art.frontText} />
          </span>
        </span>
        <span className={s.artGlass}>
          <Emoji char="🥂" size={48} />
        </span>
      </div>
      <div className={s.heroText}>
        {kicker ? (
          <p className={s.kicker}>
            <Icon name="glass" size={14} />
            {kicker}
          </p>
        ) : null}
        <h1 className={s.h1}>{t('title')}</h1>
        {lead ? <p className={s.lead}>{lead}</p> : null}
        {children}
      </div>
    </header>
  );
}

/** «Хочеш більше від свята?» — картка пропозиції пасу (до свята й під час нього, без пасу). */
export function PassCard({ href = '/pass/' }: { href?: string }) {
  const t = useTranslations('supportPage');
  return (
    <NextLink href={href} className={cn('t2f-focus', s.passCard)}>
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
  );
}
