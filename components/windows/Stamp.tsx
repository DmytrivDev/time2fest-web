'use client';

/**
 * C14. Stamp (AchievementCard) — ачівка «Новий штамп у паспорті» (EXPERIENCE «Вікна», data-model 1.10).
 * Вікно типу `inflow`: сторінка кладе його в `InFlowSlot` одразу після плеєра через `OverlayManager`
 * (`open({ kind: 'inflow', coral: true, content: <Stamp /> })`); сам компонент слот не створює.
 *
 * Стани: `stamping` (удар штемпеля ≈ 0,6 с + конфеті — лише у `lively`), `expanded`, `collapsed` (рядок з мініатюрою),
 * `multi` («Сідней · Мельбурн»), `first-row` (подвійна жовта рамка), `save-failed`.
 * Правила: з’являється сам, не зникає сам, фокус не забирає; коралова кнопка «Поділитися» лише в розгорнутому
 * стані (реєструється в `lib/overlay/coral` — кнопка звуку стає нейтральною); alt штампа = текст штампа.
 * «Поділитися» (O-SHARE, US6) і «Мій паспорт» поки інертні: просто викликають передані обробники.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { useRegisterCoral } from '@/lib/overlay/coral';
import { StampArt } from './StampArt';
import './StampMotion.css';

export interface StampEntry {
  eventId?: string;
  /** Назва міста в називному відмінку («Сідней»). */
  city: string;
  /** Назва країни в називному відмінку («Австралія»). */
  countryName: string;
  flagCode: string;
  illustrationId: string;
  /** Номер місця в «Першому ряді», якщо гість там сидів. */
  firstRowSeat?: number;
}

export type StampMode = 'expanded' | 'collapsed';
export type StampSaveState = 'saved' | 'pending' | 'failed';

export interface StampProps {
  /** Одна або кілька подій цього моменту (кілька → «Сідней · Мельбурн»). */
  stamps: StampEntry[];
  mode?: StampMode;
  defaultMode?: StampMode;
  onModeChange?: (mode: StampMode) => void;
  /** Зіграти «удар» штемпеля й конфеті (лише у `lively`; під «зменшити рух» штемпель одразу на місці). */
  stamping?: boolean;
  /** Гість з акаунтом? Для гостя без входу показуємо «Збережено на цьому пристрої · Увійди…». */
  signedIn?: boolean;
  saveState?: StampSaveState;
  onShare?: () => void;
  onPassport?: () => void;
  onSignIn?: () => void;
  onRetrySave?: () => void;
  /** Якщо задано, «×» закриває вікно (сторінка повертає фокус на заголовок блоку плеєра); інакше «×» згортає. */
  onClose?: () => void;
  className?: string;
}

const CONFETTI_TONES = ['var(--color-highlight)', 'var(--color-primary)', 'var(--color-text)'] as const;
const CONFETTI = Array.from({ length: 16 }, (_, i) => ({
  left: `${(i * 37 + 6) % 94}%`,
  drift: `${((i * 13) % 5 - 2) * 14}px`,
  spin: `${240 + i * 31}deg`,
  delay: `${(i % 6) * 110}ms`,
  tone: CONFETTI_TONES[i % CONFETTI_TONES.length],
}));

/** Тривалість «удару» + конфеті, після якої `data-stamping` знімається. */
const STAMPING_MS = 2600;

export function Stamp({
  stamps,
  mode,
  defaultMode = 'expanded',
  onModeChange,
  stamping = false,
  signedIn = false,
  saveState = 'saved',
  onShare,
  onPassport,
  onSignIn,
  onRetrySave,
  onClose,
  className,
}: StampProps) {
  const t = useTranslations('windows.achievement');
  const common = useTranslations('common');
  const titleId = useId();

  const [innerMode, setInnerMode] = useState<StampMode>(defaultMode);
  const current = mode ?? innerMode;
  const setMode = (next: StampMode) => {
    setInnerMode(next);
    onModeChange?.(next);
  };

  const [playing, setPlaying] = useState(stamping);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- синхронізація з пропом `stamping` і таймер завершення
    setPlaying(stamping);
    if (!stamping) return;
    const id = window.setTimeout(() => setPlaying(false), STAMPING_MS);
    return () => window.clearTimeout(id);
  }, [stamping]);

  useRegisterCoral(current === 'expanded');

  const first = stamps[0];
  if (!first) return null;

  const cities = stamps.map((s) => s.city);
  const placesShort = cities.length === 2 ? t('multi', { first: cities[0]!, second: cities[1]! }) : cities.join(' · ');
  const place = stamps.length === 1 ? `${first.city}, ${first.countryName}` : placesShort;
  const stampText = t('stamped', { city: placesShort.toLocaleUpperCase('uk') });
  const frStamp = stamps.find((s) => s.firstRowSeat !== undefined);
  const multi = stamps.length > 1;
  const failed = saveState === 'failed';

  if (current === 'collapsed') {
    return (
      <section
        aria-label={common('stamp')}
        data-stamp="collapsed"
        data-first-row={frStamp ? 'true' : undefined}
        className={cn(
          'flex items-center gap-2 rounded-lg border bg-surface-raised py-1 pe-1 ps-2',
          frStamp ? 'border-highlight' : 'border-border',
          className,
        )}
      >
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setMode('expanded')}
          className="t2f-focus t2f-transition flex min-h-touch-min min-w-0 flex-1 items-center gap-3 rounded-md text-start hover:bg-border"
        >
          <StampArt illustrationId={first.illustrationId} stampText={stampText} thumbnail className="block h-10 w-14 shrink-0" />
          <span className="min-w-0 truncate text-label-sm text-text">
            {common('stamp')}
            <span className="sr-only">. {t('expand')}</span>
          </span>
        </button>
        <Button variant="secondary" compact iconLeft="share" onClick={onShare}>
          {t('share')}
        </Button>
      </section>
    );
  }

  const content: ReactNode = (
    <>
      <p className="pe-9 text-label-sm text-highlight">{t('heading')}</p>
      <div data-stamping={playing ? 'true' : 'false'} className="relative overflow-hidden rounded-md">
        <StampArt illustrationId={first.illustrationId} stampText={stampText} stamping={playing} />
        <span aria-hidden="true" className="t2f-stamp-spark" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-0">
          {CONFETTI.map((c, i) => (
            <span
              key={i}
              className="t2f-confetti"
              style={{ '--left': c.left, '--drift': c.drift, '--spin': c.spin, '--delay': c.delay, '--tone': c.tone } as CSSProperties}
            />
          ))}
        </span>
      </div>
      <div className="flex items-start gap-2">
        <span className="mt-1.5 flex shrink-0 gap-1">
          {stamps.map((s) => (
            <Flag key={s.flagCode + (s.eventId ?? s.city)} code={s.flagCode} size="sm" name={s.countryName} />
          ))}
        </span>
        <h2 id={titleId} className="text-headline-sm text-text">
          {t('title', { place })}
        </h2>
      </div>
      {frStamp ? (
        <p className="flex items-center gap-2 text-label-sm text-highlight" data-row="first-row">
          <Icon name="ticket" size={16} />
          {t('firstRow', { city: frStamp.city })}
        </p>
      ) : null}
      {failed ? (
        <div className="flex flex-wrap items-center gap-x-3 text-caption text-text-secondary" data-row="save-failed">
          <span className="flex-1">{t('saveFailed')}</span>
          <Button variant="ghost" compact onClick={onRetrySave}>
            {t('retry')}
          </Button>
        </div>
      ) : (
        <>
          <p className="flex items-center gap-1.5 text-caption text-highlight" data-row="in-passport">
            <Icon name="check" size={16} />
            {t('inPassport')}
          </p>
          {!signedIn ? (
            <p className="text-caption text-text-secondary" data-row="saved-local">
              {t.rich('savedLocal', {
                signIn: (chunks) => (
                  <button
                    type="button"
                    onClick={onSignIn}
                    className="t2f-focus -my-3 inline-flex min-h-touch-min items-center rounded-sm text-body-strong text-text underline underline-offset-2"
                  >
                    {chunks}
                  </button>
                ),
              })}
            </p>
          ) : null}
        </>
      )}
      <div className="flex gap-2">
        <Button variant="coral" size="lg" iconLeft="share" className="min-w-0 flex-3" onClick={onShare}>
          {t('share')}
        </Button>
        <Button variant="secondary" size="lg" iconLeft="passport" className="min-w-0 flex-2" onClick={onPassport}>
          {t('passport')}
        </Button>
      </div>
    </>
  );

  return (
    <section
      aria-labelledby={titleId}
      data-stamp={multi ? 'multi' : 'expanded'}
      data-first-row={frStamp ? 'true' : undefined}
      data-save-state={saveState}
      className={cn(
        'relative flex flex-col gap-3 rounded-lg border border-highlight bg-surface-raised',
        // Подвійна жовта рамка «Першого ряду»: друга тонка рамка всередині з проміжком.
        frStamp ? 'p-1' : 'p-4',
        className,
      )}
    >
      {frStamp ? (
        <div className="flex flex-col gap-3 rounded-md border border-highlight p-3" data-frame="inner">
          {content}
        </div>
      ) : (
        content
      )}
      <IconButton
        icon="close"
        variant="plain"
        iconSize={18}
        aria-label={common('close')}
        className="absolute right-0.5 top-0.5 text-text-muted"
        onClick={onClose ?? (() => setMode('collapsed'))}
      />
    </section>
  );
}

/** Назва з інвентаря компонентів (C14). */
export const AchievementCard = Stamp;
