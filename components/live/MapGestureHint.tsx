'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type RefObject } from 'react';
import m from './zoneMap.module.css';

const SEEN_KEY = 't2f:mapGestureHint:v1';
const STEP_MS = 2400;
const FADE_MS = 250;

/**
 * Телефон: підказка жестів поверх мапи (рішення власника 2026-11-03, дошка `Phone-Map-Legend`, варіант 1). Один раз —
 * коли мапа вперше видна на екрані: «масштаб» (пальці сходяться й розходяться), потім «рух» (два пальці вбік), ~2,4 с
 * кожен крок, далі згасає. Дотик будь-де — сховати. Без IntersectionObserver чи сховища — не показуємо.
 */
export function MapGestureHint({ boxRef }: { boxRef: RefObject<HTMLElement | null> }) {
  const t = useTranslations('liveMap.gesture');
  // 0 — немає, 1 — масштаб, 2 — рух, 3 — згасає.
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let seen = true;
    try {
      seen = window.localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      seen = true;
    }
    if (seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((en) => en.isIntersecting && en.intersectionRatio >= 0.6)) return;
        io.disconnect();
        try {
          window.localStorage.setItem(SEEN_KEY, '1');
        } catch {
          /* без сховища — покажемо й наступного разу */
        }
        setStep(1);
      },
      { threshold: [0.6] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [boxRef]);

  useEffect(() => {
    if (!step) return;
    const id = window.setTimeout(() => setStep((s) => (s === 1 ? 2 : s === 2 ? 3 : 0)), step === 3 ? FADE_MS : STEP_MS);
    return () => window.clearTimeout(id);
  }, [step]);

  if (!step) return null;
  const kind = step === 1 ? 'pinch' : 'pan';
  return (
    <button
      type="button"
      className={m.gesture}
      data-map-gesture={kind}
      data-leaving={step === 3 ? 'true' : undefined}
      aria-label={t('close')}
      onClick={() => setStep(3)}
    >
      <span aria-hidden="true" className={m.gestureFingers} data-kind={kind}>
        <span className={m.finger} data-f="a" />
        <span className={m.finger} data-f="b" />
      </span>
      <span className={m.gestureText} role="status">
        {t(kind)}
      </span>
      <span aria-hidden="true" className={m.gestureStep}>
        {t('step', { n: step === 1 ? 1 : 2 })}
      </span>
    </button>
  );
}
