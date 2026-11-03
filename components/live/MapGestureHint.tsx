'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type RefObject } from 'react';
import { mapHintSeen, markMapHintSeen } from '@/lib/storage/mapHint';
import { useGuestStore } from '@/stores/guest';
import m from './zoneMap.module.css';

/** Одне коло анімації: пальці розходяться й сходяться, потім разом вправо-вліво (як у погодженому прикладі). */
const LOOP_MS = 2600;
/** Пауза між моментом, коли мапу повністю видно, і стартом пальців. */
const LEAD_MS = 150;
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
 * затемнення мапи й два пальці: масштаб, потім рух. Поки підказку не показано, мапа затемнена від самого початку (і під
 * час гортання); коли вона вперше повністю видна (не під смугою чату чи плашкою cookies) і простояла так мить — пальці
 * роблять одне коло, затемнення згасає й мапа доступна (правка власника 2026-11-03). Дотик — одразу зняти затемнення.
 * Після «Скинути стан гостя» (машина часу) — мапа знову затемнена й чекає.
 */
export function MapGestureHint({ boxRef }: { boxRef: RefObject<HTMLElement | null> }) {
  const t = useTranslations('liveMap.gesture');
  // 0 — немає; 1 — мапа затемнена й чекає, поки її повністю видно; 2 — анімація пальців; 3 — затемнення згасає.
  // Підказка живе лише на клієнті (мапа з'являється після завантаження геометрії), тож cookie читаємо одразу.
  const [step, setStep] = useState<0 | 1 | 2 | 3>(() => (mapHintSeen() ? 0 : 1));
  // Новий гість (скидання в машині часу стирає позначку) — мапа знову затемнена й чекає.
  const guestId = useGuestStore((s) => s.id);
  const [armedFor, setArmedFor] = useState(guestId);
  if (guestId !== armedFor) {
    setArmedFor(guestId);
    if (step === 0 && !mapHintSeen()) setStep(1);
  }

  useEffect(() => {
    const el = boxRef.current;
    if (!el || step !== 1) return;
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
        if (!fully()) return;
        stop();
        markMapHintSeen();
        setStep(2);
      }, SETTLE_MS);
    };
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(check);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
    return stop;
  }, [boxRef, step]);

  useEffect(() => {
    if (step < 2) return;
    const id = window.setTimeout(() => setStep((s) => (s === 2 ? 3 : 0)), step === 2 ? LEAD_MS + LOOP_MS : FADE_MS);
    return () => window.clearTimeout(id);
  }, [step]);

  if (!step) return null;
  return (
    <button
      type="button"
      className={m.gesture}
      data-map-gesture={step === 1 ? 'armed' : 'play'}
      data-leaving={step === 3 ? 'true' : undefined}
      aria-label={t('close')}
      onClick={() => {
        markMapHintSeen();
        setStep(3);
      }}
    >
      <span aria-hidden="true" className={m.gestureScrim} />
      {step >= 2 ? (
        <>
          <span aria-hidden="true" className={m.finger} data-f="a" />
          <span aria-hidden="true" className={m.finger} data-f="b" />
          <span className="sr-only" role="status">
            {t('hint')}
          </span>
        </>
      ) : null}
    </button>
  );
}
