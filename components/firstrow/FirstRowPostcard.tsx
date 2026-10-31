'use client';

/**
 * «Перший ряд» після півночі — листівка (дошка `Desk-FR-After-C`, рішення власника 2026-10-31). Замінює стіну й
 * бігучий рядок: «З Новим 2027 роком!», усі місця одразу (без прокрутки), під ними — привітання по одному.
 * - Опівночі місця загоряються по черзі (`useLitCount`), потім привітання йдуть по колу, `POSTCARD_STEP_MS` на кожне:
 *   спершу своє, далі за номером місця; без привітання — у колі пропускається.
 * - Показник — самі фішки: чиє привітання на екрані, та залита жовтим і має смужку до наступного; доти не потрібні.
 *   Наступне привітання — по `animationend` смужки, тож пауза (`animation-play-state`) зупиняє і смужку, і зміну.
 * - Натиск на фішку — її привітання + пауза до дії поза листівкою (на десктопі ще й поки курсор тут);
 *   повторний натиск на активну — картка учасника (своя — вибір емоції). ← → — між людьми.
 * - Під привітанням — «прапор Ім’я · Країна ›» (картка учасника) або, для свого, «Моя емоція».
 * - «Зменшити рух» — без автопоказу й смужки.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { emojiSymbol } from '@/components/live/SeatPill';
import { useLitCount, type WallPhase } from '@/components/live/FirstRowWall';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { usePause } from '@/components/primitives/Marquee';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import type { FirstRowSeat, Ms, SeatParticipant } from '@/lib/data/types';
import { canonicalEmotion } from '@/lib/firstrow/emotions';
import fr from './firstRow.module.css';

/** Скільки показуємо одне привітання. */
export const POSTCARD_STEP_MS = 6_000;

type Taken = Extract<FirstRowSeat, { state: 'taken' }>;

/** Порядок листівки: своє місце першим, далі за номером. */
export function postcardOrder(seats: readonly FirstRowSeat[]): Taken[] {
  return seats
    .filter((s): s is Taken => s.state === 'taken')
    .sort((a, b) => Number(!!b.participant.isMine) - Number(!!a.participant.isMine) || a.number - b.number);
}

/** Наступне місце з привітанням після `current` (по колу); якщо привітань немає — `current`. */
export function nextWithGreeting(order: readonly Taken[], current: number): number {
  const i = order.findIndex((s) => s.number === current);
  for (let k = 1; k <= order.length; k++) {
    const s = order[(i + k) % order.length]!;
    if (s.participant.greeting.trim()) return s.number;
  }
  return current;
}

/** Рік, що настає опівночі події: північ 1 січня за місцевим часом лежить між UTC−12 і UTC+14. */
export function newYearOf(midnightMs: Ms): number {
  return new Date(midnightMs + 14 * 3_600_000).getUTCFullYear();
}

export interface FirstRowPostcardProps {
  city: string;
  midnightMs: Ms;
  seats: readonly FirstRowSeat[];
  phase: WallPhase;
  lightingFrom?: Ms;
  /** Десктоп: рядок «ПЕРШИЙ РЯД · ЛОНДОН» (заголовок модуля). На телефоні назва — у заголовку картки, що згортається. */
  kicker?: ReactNode;
  compact?: boolean;
  countryName?(flagCode: string): string | undefined;
  onOpenParticipant?(participant: SeatParticipant): void;
  onOpenEmoji?(): void;
  /** «Поділитися листівкою» — з учасником, чиє привітання піде на листівку (своє, якщо ти в ряду). */
  onShare?(featured: SeatParticipant | undefined): void;
}

export function FirstRowPostcard({
  city,
  midnightMs,
  seats,
  phase,
  lightingFrom,
  kicker,
  compact = false,
  countryName,
  onOpenParticipant,
  onOpenEmoji,
  onShare,
}: FirstRowPostcardProps) {
  const t = useTranslations('firstRow');
  const tp = useTranslations('firstRow.postcard');
  const names = useTranslations('windows.emoji.names');
  const calm = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const { paused, hold, handlers } = usePause(root);
  const order = useMemo(() => postcardOrder(seats), [seats]);
  const lit = useLitCount(phase, order.length, lightingFrom, calm);
  const allLit = lit >= order.length;
  const first = order.find((s) => s.participant.greeting.trim()) ?? order[0];
  const [picked, setPicked] = useState<number | null>(null);
  // Людина сама обрала — зчитувач озвучує привітання; автопоказ — мовчки (WCAG 2.2.2 / 4.1.3).
  const [chosen, setChosen] = useState(false);
  const activeSeat = order.find((s) => s.number === picked) ?? first;
  if (!activeSeat) return null;
  const active = activeSeat.participant;
  const greeting = active.greeting.trim();
  const year = newYearOf(midnightMs);
  const rotating = allLit && !calm && order.filter((s) => s.participant.greeting.trim()).length > 1;

  const advance = () => setPicked(nextWithGreeting(order, activeSeat.number));
  const select = (s: Taken) => {
    if (s.number === activeSeat.number) {
      if (s.participant.isMine) onOpenEmoji?.();
      else onOpenParticipant?.(s.participant);
      return;
    }
    setPicked(s.number);
    setChosen(true);
    hold();
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = order.findIndex((s) => s.number === activeSeat.number);
    const next = order[(i + (e.key === 'ArrowRight' ? 1 : -1) + order.length) % order.length]!;
    e.preventDefault();
    setPicked(next.number);
    setChosen(true);
    hold();
    group.current?.querySelector<HTMLElement>(`[data-seat="${next.number}"]`)?.focus();
  };

  const pills = order.map((s, i) => {
    const on = s.number === activeSeat.number;
    const p = s.participant;
    const emotion = names(canonicalEmotion(p.emojiId) as never);
    const country = countryName?.(p.flagCode);
    const label = country ? t('seatLabelFull', { n: s.number, name: p.name, country, emotion }) : t('seatLabelShort', { n: s.number, name: p.name, emotion });
    return (
      <button
        key={s.number}
        type="button"
        data-seat={s.number}
        data-mine={p.isMine ? 'true' : undefined}
        data-lit={i < lit || undefined}
        aria-pressed={on}
        aria-label={on ? tp('pillActive', { label }) : tp('pillShow', { label })}
        onClick={() => select(s)}
        onKeyDown={onKey}
        className={cn('t2f-focus t2f-transition', fr.pcPill, on && fr.pcPillOn, p.isMine && fr.pcPillMine, i >= lit && fr.pcPillDark)}
      >
        <Flag round code={p.flagCode} size="pill" decorative />
        <span className="whitespace-nowrap">{p.name}</span>
        <span aria-hidden="true" className={fr.pcEmoji}>
          {emojiSymbol(p.emojiId)}
        </span>
        {p.isMine ? <span className={fr.pcYou}>{t('you')}</span> : null}
        {on && rotating ? (
          <span aria-hidden="true" className={fr.pcBar}>
            <span
              key={s.number}
              className={fr.pcBarFill}
              data-paused={paused || undefined}
              style={{ animationDuration: `${POSTCARD_STEP_MS}ms` }}
              onAnimationEnd={advance}
            />
          </span>
        ) : null}
      </button>
    );
  });

  const country = countryName?.(active.flagCode);
  const who = active.isMine ? (
    <div className={fr.pcMine}>
      <span className={fr.pcWho}>
        <Flag round code={active.flagCode} size="xs" decorative />
        {tp('mine', { n: activeSeat.number })}
      </span>
      <Button variant="secondary" compact data-action="emotion" onClick={onOpenEmoji} className={fr.mineBtn}>
        {t('myEmotion')}
        <span aria-hidden="true" className={fr.emoji}>
          {emojiSymbol(active.emojiId)}
        </span>
      </Button>
    </div>
  ) : (
    <button
      type="button"
      data-action="author"
      onClick={() => onOpenParticipant?.(active)}
      aria-label={tp('authorOpen', { name: active.name, country: country ?? '' })}
      className={cn('t2f-focus t2f-transition', fr.pcAuthor)}
    >
      <Flag round code={active.flagCode} size="xs" decorative />
      <span className={fr.pcAuthorName}>{country ? `${active.name} · ${country}` : active.name}</span>
      <Icon name="chevron-right" size={14} />
    </button>
  );

  return (
    <div ref={root} data-postcard="" data-first-row-wall="" data-phase={phase} data-active={activeSeat.number} className={cn(fr.postcard, compact && fr.postcardCompact)} {...handlers}>
      <div className={fr.pcTitle}>
        {kicker}
        <p className={fr.pcBig}>{tp('title', { year })} <span aria-hidden="true">🎆</span></p>
      </div>
      <div ref={group} role="group" aria-label={tp('group', { city })} className={fr.pcPills}>
        {pills}
      </div>
      <div className={fr.pcQuote} aria-live={chosen ? 'polite' : 'off'} data-row="greeting">
        <div key={activeSeat.number} className={fr.pcQuoteIn}>
          {greeting ? (
            <p className={fr.pcText}>«{greeting}»</p>
          ) : (
            <p className={fr.pcNone}>
              <span aria-hidden="true" className={fr.pcNoneEmoji}>
                {emojiSymbol(active.emojiId)}
              </span>
              {tp('noGreeting')}
            </p>
          )}
          {who}
        </div>
      </div>
      <div className={fr.pcFoot}>
        {!compact ? <span className={fr.pcHint}>{tp('hint')}</span> : null}
        {onShare ? (
          <Button
            variant="tonal"
            compact={!compact}
            iconLeft="share"
            data-action="share-postcard"
            onClick={() => onShare(order.find((s) => s.participant.isMine)?.participant ?? active)}
            className={compact ? 'w-full' : undefined}
          >
            {tp('share')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
