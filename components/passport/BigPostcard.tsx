'use client';

/**
 * Велика листівка (рішення власника 2026-11-07, дошка `Desk-Passport-New`, кадр 3): натиск на листівку в паспорті
 * відкриває її на місці чату (телефон — шторкою): «‹ 2 з 7 ›» (і клавіші ← →), листівка на всю ширину зі смужкою
 * прапора, місто, країна й час, оцінка (лише головні святкування з трансляцією), «Поділитися штампом», «Сторінка країни».
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { stampEntry } from '@/components/live/StampBlock';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { useOverlay } from '@/components/shell/OverlayManager';
import { shareWindowSpec } from '@/components/windows/Share';
import { StampArt } from '@/components/windows/StampArt';
import { StampRate } from '@/components/windows/StampRate';
import { formatClock } from '@/lib/i18n/time';
import type { PassportStamp } from '@/lib/passport/passport';
import { ratingActions, useMyVotes } from '@/lib/api/hooks/rating';
import { FlagStrip } from './FlagStrip';
import s from './passport.module.css';

export const BIG_POSTCARD_ID = 'O-PASSPORT-STAMP';

export function BigPostcard({ rows, start }: { rows: readonly PassportStamp[]; start: number }) {
  const t = useTranslations('passport.big');
  const tStamp = useTranslations('windows.achievement');
  const tShare = useTranslations('share');
  const overlay = useOverlay();
  const myVotes = useMyVotes();
  const [index, setIndex] = useState(start);
  const total = rows.length;
  const r = rows[Math.min(index, total - 1)];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.matches?.('input, textarea')) return;
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(total - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);
  if (!r) return null;
  const entry = stampEntry(r.eventId);
  return (
    <div className={s.big} data-big-postcard={r.eventId}>
      <div className={s.bigNav}>
        <button type="button" aria-label={t('prev')} disabled={index === 0} onClick={() => setIndex(index - 1)} className={cn('t2f-focus t2f-press', s.bigArrow)}>
          <Icon name="chevron-left" size={18} />
        </button>
        <span className={s.bigPos} aria-live="polite">
          {t('position', { index: index + 1, total })}
        </span>
        <button type="button" aria-label={t('next')} disabled={index >= total - 1} onClick={() => setIndex(index + 1)} className={cn('t2f-focus t2f-press', s.bigArrow)}>
          <Icon name="chevron-right" size={18} />
        </button>
      </div>
      <div className={s.bigArt}>
        <FlagStrip code={r.flagCode} />
        <StampArt illustrationId={r.illustrationId} stampText={tStamp('stamped', { city: r.city.toLocaleUpperCase('uk') })} />
      </div>
      <p className={s.bigCity}>
        <Flag code={r.flagCode} diameter={24} decorative />
        {r.city}
      </p>
      <p className={s.bigMeta}>{t('midnight', { country: r.country, time: formatClock(r.midnightMs) })}</p>
      {r.rateable ? (
        <div className={s.bigRate}>
          <StampRate
            layout="compact"
            rows={[{ eventId: r.eventId, city: r.city }]}
            values={myVotes[r.eventId] !== undefined ? { [r.eventId]: myVotes[r.eventId] } : {}}
            onRate={(id, stars) => void ratingActions.vote(id, stars)}
          />
          <p className={s.bigRateHint}>{t('rateHint')}</p>
        </div>
      ) : null}
      {entry ? (
        <button type="button" onClick={() => overlay.open(shareWindowSpec([entry], tShare('title')))} className={cn('t2f-focus t2f-press', s.bigShare)}>
          <Icon name="share" size={18} />
          {t('share')}
        </button>
      ) : null}
      <NextLink href={r.href} className={cn('t2f-focus t2f-press', s.bigLink)}>
        {t('countryPage')}
        <Icon name="chevron-right" size={16} />
      </NextLink>
      <p className={s.bigKeys}>{t('keys')}</p>
    </div>
  );
}
