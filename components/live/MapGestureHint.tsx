'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type RefObject } from 'react';
import { mapHintSeen, markMapHintSeen } from '@/lib/storage/mapHint';
import { useGuestStore } from '@/stores/guest';
import m from './zoneMap.module.css';

/** Одне коло анімації: пальці розходяться й сходяться, потім разом вправо-вліво (як у погодженому прикладі). */
const LOOP_MS = 2600;
/** Спершу мапа затемнюється, потім стартують пальці; після кола затемнення згасає (правка власника 2026-11-03). */
const LEAD_MS = 300;
const FADE_MS = 250;
/** Скільки мапа має простояти повністю видимою, щоб швидке гортання повз неї не рахувалося. */
const SETTLE_MS = 250;
/** Що закриває низ екрана на телефоні: смуга чату й плашка cookies. */
const BOTTOM_OVERLAYS = '[data-chat-dock], [data-cookie-banner]';

/** Нижня межа видимої частини екрана: верх смуги чату чи плашки cookies, якщо вони внизу й видимі. */
function visibleBottom(): number {
  let limit = window.innerHeight;
  for (const el of document.querySelectorAll<HTMLElement>(BOTTOM_OVERLAYS)) {
    if (el.dataset.hidden === 'true') continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.top > window.innerHeight / 2) limit = Math.min(limit, r.top);
  }
  return limit;
}

/**
 * Телефон: підказка жестів поверх мапи (рішення власника 2026-11-03, варіант 1 «м’яке затемнення»): без тексту — легке
 * затемнення мапи й два пальці: масштаб, потім рух. Один раз — коли мапа вперше повністю видна (не під смугою чату чи
 * плашкою cookies) і простояла так мить: мапа одразу темнішає, пальці роблять одне коло, затемнення згасає й мапа
 * доступна. Дотик будь-де — сховати. Після «Скинути стан гостя» (машина часу) — чекає мапу знову.
 */
export function MapGestureHint({ boxRef }: { boxRef: RefObject<HTMLElement | null> }) {
  const t = useTranslations('liveMap.gesture');
  // 0 — немає, 1 — анімація, 2 — згасає.
  const [step, setStep] = useState<0 | 1 | 2>(0);
  // Новий гість (скидання в машині часу стирає позначку) — підказка знову чекає мапу.
  const guestId = useGuestStore((s) => s.id);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || mapHintSeen()) return;
    let frame = 0;
    let settle = 0;
    const fully = () => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.top >= 0 && r.bottom <= visibleBottom();
    };
    const stop = () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
    const check = () => {
      frame = 0;
      window.clearTimeout(settle);
      if (!fully()) return;
      settle = window.setTimeout(() => {
        if (!fully() || mapHintSeen()) return;
        stop();
        markMapHintSeen();
        setStep(1);
      }, SETTLE_MS);
    };
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(check);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
    return stop;
  }, [boxRef, guestId]);

  useEffect(() => {
    if (!step) return;
    const id = window.setTimeout(() => setStep((s) => (s === 1 ? 2 : 0)), step === 1 ? LEAD_MS + LOOP_MS : FADE_MS);
    return () => window.clearTimeout(id);
  }, [step]);

  if (!step) return null;
  return (
    <button
      type="button"
      className={m.gesture}
      data-map-gesture="play"
      data-leaving={step === 2 ? 'true' : undefined}
      aria-label={t('close')}
      onClick={() => setStep(2)}
    >
      <span aria-hidden="true" className={m.gestureScrim} />
      <span aria-hidden="true" className={m.finger} data-f="a" />
      <span aria-hidden="true" className={m.finger} data-f="b" />
      <span className="sr-only" role="status">
        {t('hint')}
      </span>
    </button>
  );
}
