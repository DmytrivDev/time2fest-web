'use client';

/**
 * `/tv-info/` — інформаційна сторінка режиму вечірки: телефон — дошка `Phone-TV-Info`, десктоп — `Desk-TV-Info` (рішення 2026-11-06).
 * `/tv` на телефоні веде сюди; на ТВ сюди веде «Про режим» у шапці екрана вечірки.
 * Той самий порядок на обох: що це → що вміє → як увімкнути → «Телефон — твій пульт» і «Скласти графік» (→ `/schedule/`).
 * Десктоп: людина вже за комп’ютером — головна дія «Увімкнути режим вечірки» (`/tv`), поруч «Скопіювати посилання» і
 * «Поділитися» (іконка); праворуч — мініатюра екрана вечірки; кроки в ряд, у кроці «Ноутбук + HDMI» — «Відкрити тут ›».
 * Телефон: режиму вечірки тут немає — лише посилання для телевізора. Сторінка в макеті `(live)`: шапка сайту й чат
 * (телефон — плашка згорнутого чату внизу, десктоп — колонка); плеєра немає.
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

/**
 * Мініатюра екрана вечірки (як на дошках): ліворуч відео й смуга карток таймлайну, праворуч колонка — «до півночі 00:22:15»,
 * «Зараз: Лондон · Вебкамера», вкладки, область вмісту, кнопки керування. Картинка, не живий екран (`aria-hidden`).
 */
function TvMock() {
  const t = useTranslations('tv.phone');
  return (
    <div aria-hidden="true" className={styles.phoneMock}>
      <span className={styles.mockVideo}>
        <PostcardArt illustrationId="gb-postcard" fill className="block size-full" />
      </span>
      <span className={styles.mockStrip}>
        <span data-on="" />
        <span />
        <span />
        <span />
      </span>
      <span className={styles.phoneMockSide}>
        <span className="text-text-muted">{t('mockUntil')}</span>
        <b className="text-highlight">{t('mockTime')}</b>
        <span className={styles.mockNow}>{t('mockNow')}</span>
        <span className={styles.phoneMockTabs}>
          <span />
          <span />
        </span>
        <span className={styles.phoneMockCard} />
        <span className={styles.mockControls}>
          <span />
          <span />
          <span />
        </span>
      </span>
    </div>
  );
}

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
        <section className={styles.infoHero} aria-labelledby="tv-info-title">
          <div className={styles.infoHeroText}>
            <p className={styles.phoneKicker}>
              <Icon name="tv" size={16} />
              {t('kicker')}
            </p>
            <h1 id="tv-info-title" className={styles.phoneTitle}>
              {t('title')}
            </h1>
            <p className={styles.infoLead}>{t('lead')}</p>
            <div className={styles.infoActions}>
              {/* Десктоп: режим вечірки відкривається тут же (на телефоні його немає — кнопку сховано). */}
              <Button asChild variant="coral" className={styles.infoOpen}>
                <NextLink href="/tv/" data-action="open-tv">
                  <Icon name="tv" size={18} />
                  {t('open')}
                </NextLink>
              </Button>
              {/* «Скопіювати» й «Поділитися» — одна група: на вузькій колонці переносяться разом на другий рядок. */}
              <span className={styles.infoShareGroup}>
                <Button variant="secondary" iconLeft={copied ? 'check' : 'link'} onClick={copy} className={styles.infoCopy} data-action="copy-link">
                  {copied ? t('copied') : t('copy')}
                </Button>
                {canShare ? <IconButton icon="share" variant="ring" aria-label={t('share')} onClick={share} data-action="share-link" /> : null}
              </span>
            </div>
            <p className={styles.infoOpenNote}>{t('openNote')}</p>
            <p role="status" className="sr-only">
              {copied ? t('copied') : ''}
            </p>
          </div>

          <TvMock />
        </section>

        <ul className={styles.infoFeatures}>
          {FEATURES.map((f) => (
            <li key={f.key}>
              <span aria-hidden="true" className={styles.infoFeatureIcon}>
                <Icon name={f.icon} size={18} />
              </span>
              {t(f.key)}
            </li>
          ))}
        </ul>

        <h2 className={styles.infoH2}>{t('howTitle')}</h2>
        <ol className={styles.infoSteps}>
          {STEPS.map((s) => (
            <li key={s.key} className={styles.phoneStep}>
              <span aria-hidden="true" className={styles.phoneStepIcon}>
                <Icon name={s.icon} size={20} />
              </span>
              <span className="flex min-w-0 flex-col">
                <b className="block">{t(`${s.key}Title`)}</b>
                <span className={styles.infoStepText}>{t.rich(`${s.key}Text`, { url: TV_SHORT_URL, b: (c) => <b className="text-text">{c}</b> })}</span>
                {s.key === 'stepHdmi' ? (
                  <NextLink href="/tv/" className={cn('t2f-focus t2f-transition', styles.infoOpenHere)} data-action="open-tv-here">
                    <Icon name="tv" size={16} />
                    {t('openHere')}
                  </NextLink>
                ) : null}
              </span>
            </li>
          ))}
        </ol>

        <div className={styles.infoRemote}>
          <span aria-hidden="true" className={styles.infoRemoteIcon}>
            <Icon name="calendar-check" size={22} />
          </span>
          <p className={styles.phoneNote}>{t.rich('remote', { b: (c) => <b className="text-text">{c}</b> })}</p>
          <NextLink href="/schedule/" className={cn('t2f-focus t2f-transition', styles.phoneCta)} data-action="build-schedule">
            <Icon name="calendar" size={18} />
            {t('schedule')}
          </NextLink>
        </div>
      </div>
      <PageChat />
    </div>
  );
}
