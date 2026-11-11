'use client';

/**
 * C20. CountdownScene — сцена відліку на місці відео (EXPERIENCE «Плеєр», стани `countdown-scene` і `expected`).
 * Стоїть У СЛОТІ плеєра (`<PlayerSlot fallback={<CountdownScene … />} />`), ніколи поверх відео.
 * Ілюстрація-листівка країни, назва, «Північ о 04:00 за вашим часом», місцевий час, 3 традиції (від ширини ≥ 32rem).
 * Варіант `expected`: «Трансляція почнеться сама, щойно з’явиться». Варіант `mode` — людина сама обрала режим «Відлік» на
 * сторінці країни (точна північ без затримки відео; рішення 2026-11-05). Варіант `waiting` — людина обрала трансляцію, що ще не
 * почалась (2026-11-11): «Очікуйте трансляцію» з її назвою й відліком до початку; відео стартує саме.
 * Власник 2026-11-11: без трансляції відлік до півночі — і на самій сцені (великий), останні 12 с — куранти, опівночі — салют,
 * конфеті й «З Новим роком!»; сцену можна розгорнути на весь екран (`SceneMidnight`).
 */
import { useTranslations } from 'next-intl';
import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/components/primitives/cn';
import home from '@/components/live/home.module.css';
import { useTabletLandscape, useTabletPortrait } from '@/components/shell/OverlayManager';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { PostcardArt } from '@/components/windows/StampArt';
import type { Country, Ms } from '@/lib/data/types';
import { formatClock } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { Fireworks } from './Fireworks';
import { midnightPhase, SceneCountdown, SceneFullscreenButton, SceneMidnightCenter, useMidnightSound, useSceneFullscreen } from './SceneMidnight';

export type CountdownSceneVariant = 'no-stream' | 'expected' | 'mode' | 'waiting';

export interface CountdownSceneProps {
  country: Pick<Country, 'name' | 'flagCode' | 'illustrationId' | 'howTo'>;
  /** Місто або місце («Нуук», «Ейфелева вежа»). Заголовок — «Країна · місто». */
  cityName: string;
  /** Північ події, мс epoch UTC. */
  midnightMs: Ms;
  /** Зсув пояса країни від UTC, хв — для «місцевого часу». */
  offsetMinutes: number;
  /** `no-stream` — трансляції немає зовсім · `expected` — очікується, почнеться сама · `mode` — обрано режим «Відлік». */
  variant?: CountdownSceneVariant;
  /** `waiting`: назва трансляції («Париж · салют над Ейфелевою вежею») і її початок, мс. */
  waitingFor?: { title: string; startsAt: Ms };
  className?: string;
}

export function CountdownScene({ country, cityName, midnightMs, offsetMinutes, variant = 'no-stream', waitingFor, className }: CountdownSceneProps) {
  if (variant === 'waiting' && waitingFor) return <WaitingScene country={country} waitingFor={waitingFor} className={className} />;
  return <Scene country={country} cityName={cityName} midnightMs={midnightMs} offsetMinutes={offsetMinutes} variant={variant} className={className} />;
}

/** «Очікуйте трансляцію»: листівка країни, мітка «Очікується», назва трансляції, початок і відлік до нього. */
export function WaitingScene({
  country,
  waitingFor,
  compact = false,
  className,
}: {
  country: Pick<Country, 'name' | 'flagCode' | 'illustrationId'>;
  waitingFor: { title: string; startsAt: Ms };
  /** Мале вікно кімнати: без підзаголовка, дрібніший кегль. */
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations('player.scene');
  const titleId = useId();
  const now = useNow();
  const left = Math.max(0, Math.ceil((waitingFor.startsAt - now) / 1_000));
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  return (
    <section
      aria-labelledby={titleId}
      data-scene="waiting"
      className={cn('@container relative size-full min-h-player-min-height overflow-hidden bg-surface-raised', className)}
    >
      <PostcardArt illustrationId={country.illustrationId} fill className="absolute inset-0 size-full" />
      {/* Вузький кадр (телефон, вікно кімнати) — лише мітка, назва, початок і відлік; підзаголовок і примітка — від @lg. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/70 p-3 text-center @lg:gap-3 @lg:p-8">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-highlight/60 bg-background/70 px-3 py-1 text-label-badge text-highlight">
          <Icon name="clock" size={14} />
          {t('waitingBadge')}
        </span>
        {compact ? null : <p className="hidden text-body text-text-secondary @lg:block">{t('waitingLead')}</p>}
        <h2 id={titleId} className={cn('flex items-center gap-2 text-text', compact ? 'text-body-strong' : 'text-body-strong @lg:text-headline-lg')}>
          <span className="shrink-0">
            <Flag code={country.flagCode} size="sm" decorative />
          </span>
          <span className="line-clamp-2">{waitingFor.title}</span>
        </h2>
        <p className="text-caption text-text @lg:text-body">
          {t.rich('waitingStarts', {
            time: (chunks) => (
              <time dateTime={new Date(waitingFor.startsAt).toISOString()} className="font-bold tabular-nums text-highlight">
                {chunks}
              </time>
            ),
            value: formatClock(waitingFor.startsAt),
          })}
        </p>
        <p className="text-body-strong tabular-nums text-text @lg:text-headline-lg" aria-hidden="true" data-waiting-left="">
          {now > 0 ? `${mm}:${ss}` : '–:––'}
        </p>
        {compact ? null : <p className="hidden text-caption text-text-secondary @lg:block">{t('waitingNote')}</p>}
      </div>
    </section>
  );
}

function Scene({ country, cityName, midnightMs, offsetMinutes, variant = 'no-stream', className }: CountdownSceneProps) {
  const t = useTranslations('player.scene');
  const titleId = useId();
  // Планшет: назва міста — цілим словом (на 1024 рвалась «Фернанду-ді- / Норонья», 2026-11-10). Поза планшетом —
  // один текстовий вузол, як і досі (телефон і десктоп піксель у піксель).
  const tabletPortrait = useTabletPortrait();
  const tabletLandscape = useTabletLandscape();
  const tablet = tabletPortrait || tabletLandscape;
  const title = `${country.name.uk} · ${cityName}`;
  const now = useNow({ granularity: 'second' });
  const sectionRef = useRef<HTMLElement | null>(null);
  const fs = useSceneFullscreen(sectionRef);
  const reduced = useReducedMotion();
  const phase = midnightPhase(midnightMs, now);
  useMidnightSound(midnightMs, phase);
  const center = phase.kind === 'final' || phase.kind === 'celebrate';
  const year = new Date(midnightMs + offsetMinutes * 60_000).getUTCFullYear();
  // До гідратації «зараз» невідоме (0): місцевий час не показуємо як справжній.
  const local = now > 0 ? formatClock(now + offsetMinutes * 60_000, { timeZone: 'UTC' }) : '––:––';
  const traditions = country.howTo.traditions.slice(0, 3);

  const scene = (
    <section
      ref={sectionRef}
      aria-labelledby={titleId}
      data-scene={variant}
      data-midnight-phase={phase.kind}
      className={cn('@container relative size-full min-h-player-min-height overflow-hidden bg-surface-raised', className, fs.pseudo && 'fixed! inset-0 z-50 h-dvh! w-screen!')}
    >
      <PostcardArt illustrationId={country.illustrationId} fill className="absolute inset-0 size-full" />
      {phase.kind === 'celebrate' && !reduced ? (
        <Fireworks elapsedMs={phase.since} className="pointer-events-none absolute inset-0 size-full" />
      ) : null}
      {center ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/45">
          <SceneMidnightCenter phase={phase} place={title} year={year} />
          <h2 id={titleId} className="sr-only">
            {title}
          </h2>
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col gap-2 bg-linear-to-t from-background/95 via-background/50 to-transparent p-4 @lg:bg-linear-to-r @lg:from-background/80 @lg:via-background/30 @lg:to-transparent @lg:p-8">
          <p className="hidden text-label-sm text-text-secondary @lg:block">{variant === 'mode' ? t('modeCaption') : t('caption')}</p>
          <div className="flex min-h-0 flex-1 items-center">{phase.kind === 'count' ? <SceneCountdown left={phase.left} /> : null}</div>
          <div className="flex items-center gap-3 @lg:gap-5">
            <span className="@lg:hidden">
              <Flag code={country.flagCode} size="md" decorative />
            </span>
            <span className="hidden @lg:block">
              <Flag code={country.flagCode} size="lg" decorative />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="text-headline-sm text-text @lg:text-headline-lg">
                {tablet ? (
                  <>
                    {country.name.uk} · <span className={home.sceneCity}>{cityName}</span>
                  </>
                ) : (
                  title
                )}
              </h2>
              {variant === 'expected' ? (
                <p className="text-caption text-text @lg:text-body">{t('expected')}</p>
              ) : (
                <p className="text-caption text-text @lg:text-body">
                  {t.rich('midnightAt', {
                    time: (chunks) => (
                      <time dateTime={new Date(midnightMs).toISOString()} className="font-bold tabular-nums text-highlight">
                        {chunks}
                      </time>
                    ),
                    value: formatClock(midnightMs),
                  })}
                </p>
              )}
              {variant === 'expected' ? (
                <p className="text-caption text-text-secondary">{t('expectedNote', { time: local })}</p>
              ) : (
                <>
                  <p className="hidden text-caption text-text-secondary @lg:block">{t('localTime', { time: local })}</p>
                  <p className="text-caption text-text-secondary @lg:hidden">{variant === 'mode' ? t('modeNote') : t('noStreamNote')}</p>
                </>
              )}
            </div>
          </div>
          {traditions.length > 0 ? (
            <div className="mt-2 hidden flex-col gap-2 @lg:flex">
              <h3 className="text-body-strong text-text">{t('howTo')}</h3>
              <ul className="flex gap-2.5">
                {traditions.map((tr) => (
                  <li key={tr.id} className="min-w-0 flex-1 rounded-md border border-border bg-background/70 px-3.5 py-3">
                    <p className="text-label-sm text-text">{tr.title}</p>
                    <p className="mt-0.5 text-caption text-text-secondary">{tr.text}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
      <SceneFullscreenButton full={fs.full} onToggle={fs.toggle} />
    </section>
  );
  // Розгорнута у вікні сцена — у порталі на `body`: слот плеєра обрізає `fixed`.
  return fs.pseudo && typeof document !== 'undefined' ? createPortal(scene, document.body) : scene;
}
