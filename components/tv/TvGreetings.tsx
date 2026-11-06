'use client';

/**
 * Привітання «Першого ряду» опівночі на ТВ (дошка `TV-Party-New` «6 · Північ», рішення 2026-11-06): одне велике
 * привітання учасника ряду, змінюється кожні 15 с (картка перегортається вгору, позаду видно наступні; «зменшити рух» —
 * без перегортання). Списку учасників немає. Черга — за спільним годинником, тож усі екрани показують те саме.
 */
import { useTranslations } from 'next-intl';
import { useChatLookup } from '@/components/chat/useChatLookup';
import { emojiSymbol } from '@/components/live/SeatPill';
import { Flag } from '@/components/primitives/Flag';
import type { FirstRowSeat, Ms } from '@/lib/data/types';
import styles from './tv.module.css';

/** Скільки показуємо одне привітання. */
export const GREETING_MS = 15_000;
/** Крапки черги — лише коли привітань небагато. */
const MAX_DOTS = 12;

export interface TvGreetingsProps {
  seats: readonly FirstRowSeat[];
  /** «UTC+0 · Лондон, Лісабон». */
  row: string;
  now: Ms;
}

export function TvGreetings({ seats, row, now }: TvGreetingsProps) {
  const t = useTranslations('tv');
  const lookup = useChatLookup();
  const list = seats.filter((s): s is Extract<FirstRowSeat, { state: 'taken' }> => s.state === 'taken' && !!s.participant.greeting);
  if (!list.length) return null;
  const tick = Math.floor(now / GREETING_MS);
  const i = tick % list.length;
  const p = list[i]!.participant;
  const country = lookup.countryName?.(p.flagCode);
  const left = Math.max(1, Math.ceil((GREETING_MS - (now % GREETING_MS)) / 1000));

  return (
    <section aria-label={t('greetLabel')} data-tv-greetings="" className={styles.greet}>
      {list.length > 1 ? (
        <>
          <span aria-hidden="true" className={styles.greetBack2} />
          <span aria-hidden="true" className={styles.greetBack1} />
        </>
      ) : null}
      <div key={tick} className={styles.greetCard} data-tv-greeting={i + 1}>
        <p className={styles.greetKicker}>{t('greetKicker', { row })}</p>
        <p className={styles.greetText}>
          «{p.greeting}» <span aria-hidden="true">{emojiSymbol(p.emojiId)}</span>
        </p>
        <p className={styles.greetWho}>
          <Flag code={p.flagCode} size="md" round decorative />
          {p.name}
          {country ? <span className="font-medium text-text-secondary">· {country}</span> : null}
        </p>
        {list.length > 1 ? (
          <>
            {list.length <= MAX_DOTS ? (
              <span aria-hidden="true" className={styles.greetDots}>
                {list.map((s, k) => (
                  <span key={s.number} data-on={k === i ? '' : undefined} />
                ))}
              </span>
            ) : null}
            <p className={styles.greetCount}>{t('greetCount', { n: i + 1, total: list.length, sec: left })}</p>
          </>
        ) : null}
      </div>
    </section>
  );
}
