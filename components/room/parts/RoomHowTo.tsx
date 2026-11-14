'use client';

/**
 * «Як працює кімната» (дошка `Desk-Room-New` v197, власник 2026-11-05): 4 картки — схема згори на темній підкладці,
 * коротка назва в один рядок, 1–2 рядки тексту. Телефон — горизонтальна стрічка.
 */
import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import s from '@/components/room/room.module.css';

function Mini({ on, dash }: { on?: number; dash?: number }) {
  return (
    <span className={s.mini} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={cn(i === on && s.miniOn, i === dash && s.miniDash)} />
      ))}
    </span>
  );
}

const ART: Record<'windows' | 'sound' | 'main' | 'stamp', ReactNode> = {
  windows: (
    <span className="flex items-end gap-4">
      <Mini />
      <span className={s.miniPhone} aria-hidden="true">
        <span />
        <span />
      </span>
    </span>
  ),
  sound: (
    <span className="flex items-center gap-3.5">
      <Mini on={1} />
      <span className={s.keys} aria-hidden="true">
        {['1', '2', '3', '4'].map((k) => (
          <span key={k} className={cn(k === '2' && s.keyOn)}>
            {k}
          </span>
        ))}
      </span>
    </span>
  ),
  main: <Mini on={0} dash={2} />,
  stamp: (
    <span className={s.stampCards} aria-hidden="true">
      {['fr', 'gb', 'ie'].map((c) => (
        <span key={c}>
          <Flag code={c} size="xs" decorative />
        </span>
      ))}
    </span>
  ),
};

const ITEMS = ['windows', 'sound', 'main', 'stamp'] as const;

export function RoomHowTo({ className }: { className?: string }) {
  const t = useTranslations('room.howto');
  const id = useId();
  return (
    <section aria-labelledby={id} data-room-howto="" className={className}>
      <h2 id={id} className="text-headline-sm text-text">
        {t('title')}
      </h2>
      {/* На телефоні — горизонтальна стрічка: фокус із клавіатури, щоб її можна було прокрутити (axe
          `scrollable-region-focusable`). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <ol className={s.howGrid} tabIndex={0} aria-labelledby={id}>
        {ITEMS.map((k, i) => (
          <li key={k} className={s.howCard}>
            <div className={s.howArt}>
              {ART[k]}
              <span className={s.howNo} aria-hidden="true">
                0{i + 1}
              </span>
            </div>
            <div className={s.howBody}>
              <h3 className={s.howTitle}>{t(`${k}.title`)}</h3>
              <p className={s.howText}>{t(`${k}.text`)}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
