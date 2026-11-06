'use client';

/**
 * `/tv-info/` — інформаційна сторінка режиму вечірки (дошка `Phone-TV-Info`, рішення 2026-11-06): `/tv` на телефоні веде сюди.
 * Що це за режим, як увімкнути (браузер телевізора, ноутбук + HDMI, трансляція екрана), «Скопіювати посилання» і
 * «Поділитися» (іконка поруч — обидві влазять у 390 px), «Телефон — твій пульт» і «Скласти графік» (→ сторінка
 * «Мій графік», `/schedule/`). Сторінка в макеті `(live)`: шапка сайту й чат, як на «Країнах і містах» (на телефоні — плашка
 * згорнутого чату внизу, на десктопі — колонка); плеєра немає.
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PageChat } from '@/components/chat/PageChat';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { PostcardArt } from '@/components/windows/StampArt';
import { TV_SHORT_URL, TV_URL } from '@/lib/config/site';
import styles from './tv.module.css';

const FEATURES: readonly { icon: IconName; key: 'featAuto' | 'featCountdown' | 'featStamp' | 'featMine' }[] = [
  { icon: 'globe', key: 'featAuto' },
  { icon: 'clock', key: 'featCountdown' },
  { icon: 'stamp', key: 'featStamp' },
  { icon: 'calendar-check', key: 'featMine' },
];

const STEPS: readonly { icon: IconName; key: 'stepTv' | 'stepHdmi' | 'stepCast' }[] = [
  { icon: 'tv', key: 'stepTv' },
  { icon: 'monitor', key: 'stepHdmi' },
  { icon: 'broadcast', key: 'stepCast' },
];

export function TvPhoneInfo() {
  const t = useTranslations('tv.phone');
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = () => {
    void navigator.clipboard
      ?.writeText(TV_URL)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };
  const share = () => {
    void navigator.share?.({ title: t('title'), url: TV_URL }).catch(() => undefined);
  };

  return (
    <div className="flex flex-col bg-background text-body text-text" data-tv-phone="">
      <div className={styles.phone}>
        <p className={styles.phoneKicker}>
          <Icon name="tv" size={16} />
          {t('kicker')}
        </p>
        <h1 className={styles.phoneTitle}>{t('title')}</h1>
        <p className="mt-2 text-text-secondary">{t('lead')}</p>

        <div aria-hidden="true" className={styles.phoneMock}>
          <PostcardArt illustrationId="gb-postcard" fill className={styles.phoneMockArt} />
          <span className={styles.phoneMockSide}>
            <span className="text-text-muted">{t('mockUntil')}</span>
            <b className="text-highlight">{t('mockTime')}</b>
            <span className={styles.phoneMockTabs}>
              <span />
              <span />
            </span>
            <span className={styles.phoneMockCard} />
          </span>
        </div>

        <ul className="mt-2 flex list-none flex-col gap-2 p-0">
          {FEATURES.map((f) => (
            <li key={f.key} className="flex items-center gap-2.5">
              <Icon name={f.icon} size={18} className="shrink-0 text-highlight" />
              {t(f.key)}
            </li>
          ))}
        </ul>

        <h2 className="mt-6 text-headline-sm">{t('howTitle')}</h2>
        <ol className="m-0 mt-1 flex list-none flex-col gap-2.5 p-0">
          {STEPS.map((s) => (
            <li key={s.key} className={styles.phoneStep}>
              <span aria-hidden="true" className={styles.phoneStepIcon}>
                <Icon name={s.icon} size={20} />
              </span>
              <span className="min-w-0">
                <b className="block">{t(`${s.key}Title`)}</b>
                <span className="text-label-sm font-normal leading-normal text-text-secondary">
                  {t.rich(`${s.key}Text`, { url: TV_SHORT_URL, b: (c) => <b className="text-text">{c}</b> })}
                </span>
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" iconLeft={copied ? 'check' : 'link'} onClick={copy} className="min-w-0 flex-1" data-action="copy-link">
            {copied ? t('copied') : t('copy')}
          </Button>
          {canShare ? <IconButton icon="share" variant="ring" aria-label={t('share')} onClick={share} data-action="share-link" /> : null}
        </div>
        <p role="status" className="sr-only">
          {copied ? t('copied') : ''}
        </p>

        <p className={styles.phoneNote}>{t.rich('remote', { b: (c) => <b className="text-text">{c}</b> })}</p>

        <NextLink href="/schedule/" className={cn('t2f-focus t2f-transition', styles.phoneCta)} data-action="build-schedule">
          <Icon name="calendar" size={18} />
          {t('schedule')}
        </NextLink>
      </div>
      <PageChat />
    </div>
  );
}
