'use client';

/**
 * C7. FirstRowWall — стіна «Першого ряду»: місця учасників (SeatPill) + одна картка «+ N вільні місця».
 * Область називається «Перший ряд · <місто>: лишилось 2 з 10, гортай вбік» (карусель Embla з автогортанням по колу,
 * пауза на наведенні й фокусі, кнопка «Пауза»). Фази: `idle`, `lighting` (місця загоряються жовтим по черзі 1…10,
 * по 2 на секунду — не частіше 3 блимань на секунду), `lit` («З Новим роком, перший ряд!»). `restrained` — без руху й
 * без привітання; «зменшити рух» — місця просто з’являються (фаза `lighting` одразу стає `lit`).
 * Дані: `FirstRowSeat[]` (див. `seedToSeats` для `firstRowSeed` з `data/chat-script.json`) і фаза з `firstRowView().wall`.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Carousel } from '@/components/primitives/Carousel';
import { Icon } from '@/components/primitives/Icon';
import fr from '@/components/firstrow/firstRow.module.css';
import { cn } from '@/components/primitives/cn';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import type { FirstRowSeat, FirstRowSeedEntry, Ms } from '@/lib/data/types';
import { SEATS, WALL_LIGHTING_MS } from '@/lib/engine/config';
import { useNow } from '@/lib/time/TimeProvider';
import { emojiSymbol, SeatPill } from './SeatPill';

export type WallPhase = 'idle' | 'lighting' | 'lit';
/** `row` — один ряд зі стрілками (десктоп, `Main`) · `wrap` — два ряди, гортаються вбік (телефон) · `grid` — 2 колонки (ТВ). */
export type WallLayout = 'row' | 'wrap' | 'grid';

export interface FirstRowWallProps {
  /** Назва міста в називному відмінку («Лондон»). */
  city: string;
  /** Місця події (зайняті показуємо іменами; вільні й утримані — лише в лічильнику). */
  seats: readonly FirstRowSeat[];
  /** Вільних місць (без утриманих); з `firstRowView().freeCount`. */
  freeCount: number;
  phase: WallPhase;
  /** З якого моменту йде загоряння (`firstRowView().wall.lightingFrom`); без нього починаємо з першого місця. */
  lightingFrom?: Ms;
  /** Стриманий режим: без руху й без привітання. */
  restrained?: boolean;
  /** Розкладка: ряд зі стрілками (за замовчуванням), два ряди (телефон) чи сітка 2 колонки (ТВ). */
  layout?: WallLayout;
  /** Пігулка «+ N вільні» — кнопка «зайняти місце». */
  onTakeFree?: () => void;
  /** Бігучий рядок «З Новим роком, перший ряд! · імена» після півночі (модуль на сторінці). */
  ticker?: boolean;
  /** Назва країни за кодом прапора — для доступної назви місця. */
  countryName?: (flagCode: string) => string | undefined;
  /** Дотик до свого місця (O-EMOJI). */
  onOpenEmoji?: () => void;
  className?: string;
}

/** Крок загоряння: усі місця за `WALL_LIGHTING_MS`. */
export const LIGHTING_STEP_MS = WALL_LIGHTING_MS / SEATS;

/**
 * Скільки місць уже горить. `idle` → 0; `lit` → усі; `lighting` → від 1 і далі кожні `LIGHTING_STEP_MS`.
 * Під «зменшити рух» загоряння пропускається.
 */
export function useLitCount(phase: WallPhase, total: number, lightingFrom: Ms | undefined, reduced: boolean): number {
  const now = useNow();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (phase !== 'lighting' || reduced) return;
    // Якщо сторінку відкрито посеред загоряння — продовжуємо з потрібного місця.
    const elapsed = lightingFrom !== undefined && now > 0 ? Math.max(0, now - lightingFrom) : 0;
    const start = Math.min(total, Math.floor(elapsed / LIGHTING_STEP_MS) + 1);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- запуск таймера загоряння при вході у фазу
    setCount(start);
    const id = window.setInterval(() => {
      setCount((c) => {
        if (c >= total) {
          window.clearInterval(id);
          return c;
        }
        return c + 1;
      });
    }, LIGHTING_STEP_MS);
    return () => window.clearInterval(id);
    // `now` навмисно не в залежностях: стартову позицію рахуємо один раз на вхід у фазу.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reduced, total, lightingFrom]);

  if (phase === 'idle') return 0;
  if (phase === 'lit' || reduced) return total;
  return count;
}

/** `firstRowSeed` з `chat-script.json` → місця події (для імітатора, історій і тестів). */
export function seedToSeats(entry: FirstRowSeedEntry, now: Ms): FirstRowSeat[] {
  return entry.seats.map((s): FirstRowSeat => {
    if (s.state === 'taken') {
      return {
        eventId: entry.eventId,
        number: s.number,
        state: 'taken',
        takenAt: now + (s.takenAtOffsetSec ?? 0) * 1000,
        participant: {
          holderId: `seed-${s.number}`,
          name: s.name ?? '',
          flagCode: s.flagCode ?? 'UN',
          greeting: s.greeting ?? '',
          emojiId: s.emojiId ?? 'sparkles',
        },
      };
    }
    if (s.state === 'held') {
      return { eventId: entry.eventId, number: s.number, state: 'held', until: now + (s.heldUntilOffsetSec ?? 0) * 1000, holderId: `seed-${s.number}` };
    }
    return { eventId: entry.eventId, number: s.number, state: 'free' };
  });
}

export function FirstRowWall({
  city,
  seats,
  freeCount,
  phase,
  lightingFrom,
  restrained = false,
  layout = 'row',
  countryName,
  onOpenEmoji,
  onTakeFree,
  ticker = false,
  className,
}: FirstRowWallProps) {
  const t = useTranslations('firstRow');
  const calm = useReducedMotion();
  const taken = useMemo(
    () => seats.filter((s): s is Extract<FirstRowSeat, { state: 'taken' }> => s.state === 'taken').sort((a, b) => a.number - b.number),
    [seats],
  );
  const effectivePhase: WallPhase = restrained ? 'idle' : phase;
  const lit = useLitCount(effectivePhase, taken.length, lightingFrom, calm);
  const allLit = effectivePhase === 'lit' && !restrained;
  const full = taken.length === SEATS;

  const pills = taken.map((s, i) => {
    const isLit = i < lit;
    return (
      <SeatPill
        key={s.number}
        seat={s.number}
        participant={s.participant}
        countryName={countryName?.(s.participant.flagCode)}
        state={isLit ? 'lit' : 'idle'}
        fresh={!calm && effectivePhase === 'lighting' && isLit && i === lit - 1}
        onOpenEmoji={s.participant.isMine ? onOpenEmoji : undefined}
      />
    );
  });

  const freeText = taken.length === 0 && freeCount === SEATS ? t('allFree') : t('freeShort', { count: freeCount });
  const freeCard =
    freeCount > 0 && effectivePhase === 'idle' ? (
      onTakeFree ? (
        <button
          key="free"
          type="button"
          data-slot="free"
          aria-label={t('freeTakeLabel', { count: freeCount })}
          onClick={onTakeFree}
          className={cn('t2f-focus t2f-transition', fr.free)}
        >
          <Icon name="plus" size={14} strokeWidth={2.2} />
          {freeText}
        </button>
      ) : (
        <div key="free" data-slot="free" className={fr.free}>
          <Icon name="plus" size={14} strokeWidth={2.2} />
          {freeText}
        </div>
      )
    ) : null;

  const wallLabel = effectivePhase === 'idle' ? t('wall', { city, free: freeCount, total: SEATS }) : t('wallLighting', { city });
  const gridLabel = t('wallRow', { city, taken: taken.length, total: SEATS });
  const items = [...pills, ...(freeCard ? [freeCard] : [])];

  let body;
  if (layout === 'grid') {
    body = (
      <section aria-label={gridLabel}>
        <ul className="grid grid-cols-2 gap-1.5">
          {pills.map((p, i) => (
            <li key={taken[i]!.number} className="flex *:w-full">
              {p}
            </li>
          ))}
          {freeCard ? <li className="col-span-2 flex *:w-full">{freeCard}</li> : null}
        </ul>
      </section>
    );
  } else if (layout === 'wrap') {
    // Телефон (`Phone-Home-Live`): два ряди — стовпчики по два місця; по колу, гортання свайпом.
    const columns: ReactNode[][] = [];
    items.forEach((it, i) => {
      if (i % 2 === 0) columns.push([it]);
      else columns[columns.length - 1]!.push(it);
    });
    body = (
      <Carousel label={wallLabel} arrows="none" loop prevLabel={t('prevSeats')} nextLabel={t('nextSeats')}>
        {columns.map((col, i) => (
          <div key={i} className="flex flex-col items-start gap-2">
            {col}
          </div>
        ))}
      </Carousel>
    );
  } else {
    body = (
      <Carousel label={wallLabel} arrows="sides" loop fade prevLabel={t('prevSeats')} nextLabel={t('nextSeats')}>
        {items}
      </Carousel>
    );
  }

  return (
    <div
      data-wall={restrained ? 'restrained' : effectivePhase}
      data-first-row-wall=""
      data-phase={effectivePhase}
      data-layout={layout}
      className={cn('flex flex-col gap-1.5', className)}
    >
      {body}
      {allLit ? (
        ticker ? (
          <>
            <div aria-hidden="true" className={fr.ticker} data-row="ticker">
              <span>{t('wallLit')}</span>
              {taken.map((s) => (
                <span key={s.number} className="contents">
                  <span className={fr.tickerSep}>·</span>
                  <span className={fr.tickerName}>
                    {s.participant.name} {emojiSymbol(s.participant.emojiId)}
                  </span>
                </span>
              ))}
            </div>
            <p role="status" className="sr-only" data-row="lit">
              {full ? `${t('wallAllLit', { count: taken.length })}. ` : ''}
              {t('wallLit')}
            </p>
          </>
        ) : (
          <div role="status" className="text-center text-label-sm text-highlight" data-row="lit">
            {full ? <span className="me-2 text-text-muted">{t('wallAllLit', { count: taken.length })}</span> : null}
            {t('wallLit')}
          </div>
        )
      ) : null}
    </div>
  );
}
