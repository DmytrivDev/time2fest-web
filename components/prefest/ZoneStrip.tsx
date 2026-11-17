'use client';

/**
 * Стрічка 38 поясів: раніше за тебе — колір «майбутнього» поясу, твій — виділений і вищий, далі — колір межі;
 * над нею орієнтири (місто й північ там), під нею позначка «Ти · Країна».
 */
import { useTranslations } from 'next-intl';
import { landmarkDimmed, segmentCenterPct } from '@/lib/prefest/mine';
import { cn } from '@/components/primitives/cn';
import { Bar } from '@/components/skeleton/parts';
import m from './ZoneStrip.module.css';

export interface StripLandmark {
  city: string;
  index: number;
  /** Час півночі там; `null` — ще невідомий (до гідратації). */
  time: string | null;
  /** Зникає на планшеті-портреті й телефоні. */
  optional?: boolean;
}

export function ZoneStrip({
  total,
  index,
  countryName,
  landmarks,
}: {
  total: number;
  /** Індекс пояса відвідувача; `null` — ще не обрано. */
  index: number | null;
  countryName: string | null;
  landmarks: StripLandmark[];
}) {
  const t = useTranslations('prefest.mine');
  return (
    <div
      className={m.tline}
      role="img"
      aria-label={index === null ? undefined : t('stripAria', { n: index + 1 })}
      aria-hidden={index === null ? true : undefined}
    >
      <div className={m.segs}>
        {Array.from({ length: total }, (_, k) => (
          <i key={k} className={cn(index !== null && k < index && m.b, index === k && m.me)} />
        ))}
      </div>
      {landmarks.map((l) => (
        <span
          key={l.city}
          className={cn(m.mk, l.optional && m.opt)}
          style={{ left: `${segmentCenterPct(l.index, total)}%`, opacity: index !== null && landmarkDimmed(l.index, index) ? 0.25 : 1 }}
        >
          {l.city}
          <br />
          {l.time ?? (
            <span className={m.mkBar}>
              <Bar w={34} h={12} />
            </span>
          )}
        </span>
      ))}
      {index !== null && countryName ? (
        <span className={m.you} style={{ left: `${segmentCenterPct(index, total)}%` }}>
          {t('you', { country: countryName })}
        </span>
      ) : (
        <span className={m.youSk}>
          <Bar w={120} h={16} />
        </span>
      )}
    </div>
  );
}
