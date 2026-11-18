'use client';

/** «Що таке Time2Fest»: заглушка ролика (висота = висота чотирьох плиток) і чотири плитки можливостей. */
import { useTranslations } from 'next-intl';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import { usePrefest } from './PrefestContext';
import { SceneCanvas } from './SceneCanvas';
import w from './WhatIs.module.css';
import s from './prefest.module.css';

/** Іконка «Живі трансляції» з дизайну: екран із трикутником відтворення. */
function ScreenPlay() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="13" rx="2" />
      <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" />
    </svg>
  );
}

const FEATURES: { key: 'f1' | 'f2' | 'f3' | 'f4'; icon: IconName | null }[] = [
  { key: 'f1', icon: null },
  { key: 'f2', icon: 'chat' },
  { key: 'f3', icon: 'stamp' },
  { key: 'f4', icon: 'glass' },
];

export function WhatIs() {
  const t = useTranslations('prefest.what');
  const { toast, site } = usePrefest();
  const video = site?.media['video:what'];
  return (
    <section className={cn(s.sec, s.wrap)} id="what" aria-labelledby="what-h">
      <h2 className={s.h2} id="what-h">
        {t('title')}
      </h2>
      <div className={w.what}>
        {video ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption -- ролик без мовлення; субтитри додасть задача C разом із файлом
          <video
            className={w.video}
            src={video.src}
            poster={video.poster}
            controls
            preload="none"
            aria-label={t('videoTitle')}
          />
        ) : (
          <button
            type="button"
            className={w.video}
            aria-label={t('videoAria')}
            onClick={() => toast(t('videoSoon'))}
          >
            <SceneCanvas seed={77} bursts={5} warm />
            <span className={w.play} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 4.5v15l13-7.5z" />
              </svg>
            </span>
            <span className={w.vcap}>
              <b>{t('videoTitle')}</b>
              <span>{t('videoLength')}</span>
            </span>
            {/* Ролика ще немає (рішення власника 2026-11-18: блок лишається з тимчасовою заглушкою). */}
            {site ? <span hidden data-media-placeholder="video:what" /> : null}
          </button>
        )}
        <div className={w.feats}>
          {FEATURES.map((f) => (
            <div className={w.feat} key={f.key}>
              <span className={w.ic}>
                {f.icon ? <Icon name={f.icon} size={20} /> : <ScreenPlay />}
              </span>
              <b>{t(`${f.key}Title`)}</b>
              <span>{t(`${f.key}Text`)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
