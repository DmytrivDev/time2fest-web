'use client';

/**
 * Північ на сцені відліку (власник 2026-11-11): коли трансляції немає або людина обрала «Відлік».
 * - великий відлік до півночі на самій сцені (а не лише в підписі плеєра);
 * - останні 12 с — по секунді великою цифрою й удар курантів щосекунди (12 ударів);
 * - опівночі — «З Новим роком!», салют і конфеті зі звуком (40 с); далі на місці відліку — рік, що настав («2027»);
 * - кнопка «На весь екран» для сцени.
 * Звук — лише коли людина ввімкнула його кнопкою звуку (або вже вмикала в цьому сеансі).
 */
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import type { Ms } from '@/lib/data/types';
import { playChime, preloadSceneSounds, startFireworksSound, stopFireworksSound, useSceneSound } from '@/lib/scene/sceneAudio';
import { FIREWORKS_MS } from './Fireworks';
import fx from './scene.module.css';

/** Скільки секунд б'ють куранти перед північчю. */
export const CHIME_SECONDS = 12;

export type MidnightPhase =
  | { kind: 'idle' }
  | { kind: 'count'; left: number }
  | { kind: 'final'; sec: number }
  | { kind: 'celebrate'; since: number }
  | { kind: 'after' };

export function midnightPhase(midnightMs: Ms, now: number): MidnightPhase {
  if (now <= 0) return { kind: 'idle' };
  const left = midnightMs - now;
  if (left > CHIME_SECONDS * 1_000) return { kind: 'count', left };
  if (left > 0) return { kind: 'final', sec: Math.ceil(left / 1_000) };
  if (now - midnightMs < FIREWORKS_MS) return { kind: 'celebrate', since: now - midnightMs };
  return { kind: 'after' };
}

/** «00:21:52» — як таймер у підписі плеєра. */
export function hms(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1_000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(total / 3_600))}:${p(Math.floor((total % 3_600) / 60))}:${p(total % 60)}`;
}

/** Куранти щосекунди в останні 12 с; у «зменшеному русі» без салюту на екрані — записаний салют лише звуком. */
export function useMidnightSound(midnightMs: Ms, phase: MidnightPhase) {
  const reduced = useReducedMotion();
  const soundOn = useSceneSound();
  const last = useRef('');
  const near = phase.kind === 'final' || (phase.kind === 'count' && phase.left < 60_000);
  // Записи — заздалегідь, за хвилину до півночі (удари мають іти рівно щосекунди).
  useEffect(() => {
    if (soundOn && near) preloadSceneSounds();
  }, [soundOn, near]);
  const sec = phase.kind === 'final' ? phase.sec : 0;
  const celebrate = phase.kind === 'celebrate';
  const since = phase.kind === 'celebrate' ? phase.since : 0;
  const sinceRef = useRef(0);
  useEffect(() => {
    sinceRef.current = since;
  });
  useEffect(() => {
    if (!sec) return;
    const key = `${midnightMs}:${sec}`;
    if (last.current === key) return;
    last.current = key;
    playChime(sec === 1);
  }, [midnightMs, sec]);
  // Салют звуком (без картинки) триває весь салют — до `FIREWORKS_MS`. Раніше звук гасло, щойно спливали перші 2 с
  // (`celebrating` ставало false): на телефоні зі «зменшеним рухом» (iPhone) салют звучав ≈3 с, а не 40 (2026-11-16).
  useEffect(() => {
    if (!celebrate || !reduced) return;
    const key = `${midnightMs}:boom`;
    if (last.current !== key) {
      last.current = key;
      startFireworksSound(sinceRef.current / 1_000);
    }
    return () => stopFireworksSound();
  }, [midnightMs, celebrate, reduced]);
}

/** Після півночі на місці великого відліку — рік, що настав (рішення власника 2026-11-14): той самий підпис і кегль. */
export function SceneYear({ year }: { year: number }) {
  const t = useTranslations('player.scene');
  return (
    <div className="flex flex-col" data-scene-year={year}>
      <span className="text-label-sm uppercase tracking-wide text-text-secondary">{t('yearLabel')}</span>
      <span className={cn('font-extrabold leading-none tabular-nums text-highlight', fx.glow)} style={{ fontSize: 'max(1.75rem, 7.5cqw)' }}>
        {year}
      </span>
    </div>
  );
}

/** Великий відлік до півночі на сцені. */
export function SceneCountdown({ left }: { left: number }) {
  const t = useTranslations('player.scene');
  return (
    <div className="flex flex-col" data-scene-countdown="">
      <span className="text-label-sm uppercase tracking-wide text-text-secondary">{t('countdownLabel')}</span>
      <span className={cn('font-extrabold leading-none tabular-nums text-highlight', fx.glow)} style={{ fontSize: 'max(1.75rem, 7.5cqw)' }}>
        {hms(left)}
      </span>
    </div>
  );
}

/** Останні 12 с і «З Новим роком!» — по центру сцени. */
export function SceneMidnightCenter({ phase, place, year }: { phase: MidnightPhase; place: string; year: number }) {
  const t = useTranslations('player.scene');
  const reduced = useReducedMotion();
  if (phase.kind === 'final') {
    return (
      <div className="flex flex-col items-center gap-1 text-center" data-scene-final={phase.sec} aria-live="off">
        <span className="text-label-sm uppercase tracking-wide text-text">{t('finalLead')}</span>
        <span key={phase.sec} className={cn('font-extrabold leading-none tabular-nums text-highlight', fx.glow, !reduced && fx.tick)} style={{ fontSize: 'max(4.5rem, 22cqw)' }}>
          {phase.sec}
        </span>
        <span className="text-caption text-text-secondary @lg:text-body">{place}</span>
      </div>
    );
  }
  if (phase.kind === 'celebrate') {
    return (
      <div className="flex flex-col items-center gap-1 px-4 text-center @lg:gap-3" data-scene-celebrate="" role="status">
        <span className={cn('font-extrabold leading-tight text-highlight', fx.glow, !reduced && fx.greet)} style={{ fontSize: 'max(1.75rem, 8cqw)' }}>
          {t('happyNewYear')}
        </span>
        <span className="text-body-strong text-text @lg:text-headline-sm">{t('celebrateLine', { place, year })}</span>
      </div>
    );
  }
  return null;
}

/**
 * «На весь екран» для сцени: Fullscreen API; де його немає (iPhone) або браузер відмовив — сцена розгортається на все
 * вікно (`fixed`), вихід — тією ж кнопкою або Esc.
 */
export function useSceneFullscreen(target: RefObject<HTMLElement | null>) {
  const [native, setNative] = useState(false);
  const [pseudo, setPseudo] = useState(false);
  useEffect(() => {
    const on = () => setNative(document.fullscreenElement !== null && document.fullscreenElement === target.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, [target]);
  useEffect(() => {
    if (!pseudo) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPseudo(false);
    document.addEventListener('keydown', key);
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.documentElement.style.overflow = overflow;
    };
  }, [pseudo]);
  const toggle = () => {
    if (pseudo) return setPseudo(false);
    if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
    const el = target.current;
    if (!el || !document.fullscreenEnabled || !el.requestFullscreen) return setPseudo(true);
    // Деякі вбудовані браузери не відповідають на запит зовсім — тоді теж розгортаємо у вікні.
    const fallback = setTimeout(() => !document.fullscreenElement && setPseudo(true), 700);
    el.requestFullscreen().then(
      () => clearTimeout(fallback),
      () => {
        clearTimeout(fallback);
        setPseudo(true);
      },
    );
  };
  return { full: native || pseudo, pseudo, toggle };
}

export function SceneFullscreenButton({ full, onToggle }: { full: boolean; onToggle: () => void }) {
  const t = useTranslations('player.scene');
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={full ? t('exitFullscreen') : t('fullscreen')}
      aria-pressed={full}
      data-scene-fullscreen=""
      className="t2f-focus t2f-transition absolute right-2 top-2 z-10 inline-flex size-10 items-center justify-center rounded-full border border-border bg-background/70 text-text hover:bg-background @lg:right-4 @lg:top-4"
    >
      <Icon name={full ? 'close' : 'expand'} size={18} />
    </button>
  );
}
