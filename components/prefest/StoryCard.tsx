'use client';

/** Превʼю картки для сторіс: 250 px, 9:16 — фон-заглушка, логотип, «Новий рік прийде до мене», твій номер пояса. */
import { useTranslations } from 'next-intl';
import { Flag } from '@/components/primitives/Flag';
import { SceneCanvas } from './SceneCanvas';
import { Bar } from '@/components/skeleton/parts';
import m from './StoryCard.module.css';

export function StoryCard({ ord, flagCode, where }: { ord: string | null; flagCode: string | null; where: string | null }) {
  const t = useTranslations('prefest.mine');
  return (
    <div className={m.wrap}>
      <div className={m.story} role="group" aria-label={t('storyAria')}>
        <SceneCanvas seed={41} bursts={4} />
        <div className={m.in}>
          {/* eslint-disable-next-line @next/next/no-img-element -- статичний експорт */}
          <img className={m.logo} src="/brand/logo.png" alt="" />
          <div>
            <div className={m.s1}>{t('storyLine1')}</div>
            <div className={m.s2}>{ord ?? <Bar w={130} h={60} />}</div>
            <div className={m.s3}>{t('storyLine3')}</div>
            <div className={m.s4}>
              {flagCode ? <Flag code={flagCode} diameter={22} decorative /> : <span className={m.noFlag} />}
              {where === null ? <Bar w={150} h={14} /> : <span>{where}</span>}
            </div>
            <div className={m.s5}>
              {t('storyInvite')} <b>{t('storySite')}</b>
            </div>
          </div>
        </div>
      </div>
      <span className={m.cap}>{t('storyCaption')}</span>
    </div>
  );
}
