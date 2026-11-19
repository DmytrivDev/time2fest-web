'use client';

/** Превʼю картки для сторіс: 250 px, 9:16 — фон-заглушка, логотип, «Новий рік прийде до мене», твій номер пояса. */
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { SceneCanvas } from './SceneCanvas';
import { Bar } from '@/components/skeleton/parts';
import m from './StoryCard.module.css';

export function StoryCard({
  ord,
  flagCode,
  where,
  action,
}: {
  ord: string | null;
  flagCode: string | null;
  where: string | null;
  /**
   * Передстартовий сайт (рішення власника 2026-11-19): кнопка «Поділитися карткою» під карткою на всю її ширину замість
   * підпису «Картка для сторіс · 1080×1920»; картка ширша й угорі колонки.
   */
  action?: ReactNode;
}) {
  const t = useTranslations('prefest.mine');
  return (
    <div className={cn(m.wrap, action ? m.wrapTop : undefined)}>
      <div className={cn(m.story, action ? m.storyWide : undefined)} role="group" aria-label={t('storyAria')}>
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
      {action ? <div className={m.action}>{action}</div> : <span className={m.cap}>{t('storyCaption')}</span>}
    </div>
  );
}
