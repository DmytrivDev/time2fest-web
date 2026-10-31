'use client';

/**
 * P27. Бігуча стрічка (стіна «Першого ряду», рішення власника 2026-10-31): замість стрілок — коли елементів більше,
 * ніж влазить, стрічка повільно їде вліво по колу без шва (список повторено двічі, за останнім — той самий проміжок
 * і знову перший). Прокрутка — нативна (`scrollLeft`), тож колесо, тачпад, свайп і перетягування мишкою працюють
 * як звичайно й теж ідуть по колу.
 * - Наведення курсора й фокус зупиняють рух, поки курсор/фокус тут.
 * - Колесо, тачпад, перетягування, дотик зупиняють рух «до дії поза стрічкою» (клік чи клавіша деінде).
 * - «Зменшити рух» — рух вимкнено, лишається ручна прокрутка.
 * - `rows={2}` (телефон): два ряди, кожен їде окремо; зупинка — спільна.
 * Копія — `inert` і `aria-hidden`: зчитувач і Tab бачать кожен елемент один раз.
 */
import { Children, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { cn } from './cn';

export interface MarqueeProps {
  /** Назва стрічки для зчитувача. */
  label: string;
  children: ReactNode;
  /** Два ряди (телефон). Елементи діляться між рядами так, щоб ряди були приблизно рівні. */
  rows?: 1 | 2;
  /** Швидкість, px/с. */
  speed?: number;
  /** Проміжок між елементами, px (такий самий і на стику кола). */
  gap?: number;
  /** Вага кожного елемента для поділу на два ряди (напр. довжина імені); без неї — порівну. */
  weights?: number[];
  /** Стрічка виходить у поля батька на стільки px з боків (краї згасають у полях, перший елемент — на краю вмісту). */
  bleed?: number;
  className?: string;
}

/** Зупинка: `hover`/`focus` — поки курсор чи фокус тут; `held` — після ручної прокрутки, до дії поза стрічкою. */
function usePause(root: React.RefObject<HTMLElement | null>) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!held) return;
    const outside = (e: Event) => {
      if (root.current && e.target instanceof Node && root.current.contains(e.target)) return;
      setHeld(false);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', outside, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', outside, true);
    };
  }, [held, root]);
  return {
    paused: hover || focus || held,
    held,
    hold: () => setHeld(true),
    handlers: {
      onPointerEnter: (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse') setHover(true);
      },
      onPointerLeave: () => setHover(false),
      onFocus: () => setFocus(true),
      onBlur: (e: React.FocusEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      },
    },
  };
}

function MarqueeRow({ items, gap, bleed, speed, paused, onManual }: { items: ReactNode[]; gap: number; bleed: number; speed: number; paused: boolean; onManual(): void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [period, setPeriod] = useState(0); // ширина одного кола (px); 0 — усе влазить, крутити нічого
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const pos = useRef(0); // дробова позиція (scrollLeft цілочисельний у частині браузерів)

  useLayoutEffect(() => {
    const el = viewport.current;
    const tr = track.current;
    if (!el || !tr) return;
    const measure = () => {
      const first = tr.querySelector<HTMLElement>('[data-copy="1"]');
      const second = tr.querySelector<HTMLElement>('[data-copy="2"]');
      const one = first ? first.offsetWidth : tr.scrollWidth;
      const overflow = one > el.clientWidth - 2 * bleed + 1;
      setPeriod(overflow && second ? second.offsetLeft - first!.offsetLeft : overflow ? -1 : 0);
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    ro?.observe(tr);
    return () => ro?.disconnect();
  }, [items.length, bleed]);

  // Перескок на те саме місце в іншій копії — коло без кінця в обидва боки.
  const wrap = useCallback(() => {
    const el = viewport.current;
    if (!el || period <= 0) return;
    if (el.scrollLeft >= period) el.scrollLeft -= period;
    else if (el.scrollLeft <= 0) el.scrollLeft += period;
    pos.current = el.scrollLeft;
  }, [period]);

  useEffect(() => {
    const el = viewport.current;
    if (!el || period <= 0) return;
    // З 1 px, а не з 0: інакше прокрутка вліво з самого початку не дає події scroll і коло не замикається.
    if (el.scrollLeft < 1) el.scrollLeft = 1;
    el.addEventListener('scroll', wrap, { passive: true });
    return () => el.removeEventListener('scroll', wrap);
  }, [period, wrap]);

  useEffect(() => {
    const el = viewport.current;
    if (!el || period <= 0 || paused || speed <= 0) return;
    pos.current = el.scrollLeft;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(t) {
      const dt = Math.min(64, t - last);
      last = t;
      pos.current += (speed * dt) / 1000;
      if (pos.current >= period) pos.current -= period;
      el.scrollLeft = pos.current;
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [period, paused, speed]);

  const looping = period !== 0;
  const copy = (n: 1 | 2) => (
    <div data-copy={n} aria-hidden={n === 2 || undefined} inert={n === 2 || undefined} className="flex shrink-0" style={{ gap }}>
      {items}
    </div>
  );
  return (
    <div
      ref={viewport}
      data-marquee-row=""
      data-looping={looping || undefined}
      // Прокручуваний ряд доступний з клавіатури (axe: scrollable-region-focusable); фокус зупиняє рух.
      tabIndex={looping ? 0 : undefined}
      className="t2f-focus t2f-marquee-viewport"
      style={bleed ? { marginInline: -bleed, paddingInline: bleed } : undefined}
      onWheel={(e) => {
        if (Math.abs(e.deltaX) > 0 || e.shiftKey) onManual();
      }}
      onTouchStart={onManual}
      onPointerDown={(e) => {
        if (e.pointerType !== 'mouse' || e.button !== 0 || !viewport.current) return;
        drag.current = { x: e.clientX, left: viewport.current.scrollLeft, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !viewport.current) return;
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) < 5) return;
        if (!d.moved) {
          d.moved = true;
          onManual();
          viewport.current.setPointerCapture(e.pointerId);
        }
        viewport.current.scrollLeft = d.left - dx;
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onClickCapture={(e) => {
        // Після перетягування клік по фішці не спрацьовує.
        if (drag.current?.moved) e.stopPropagation();
      }}
    >
      <div ref={track} className="flex w-max" style={{ gap }}>
        {copy(1)}
        {looping ? copy(2) : null}
      </div>
    </div>
  );
}

/** Ділимо елементи на два ряди приблизно рівної довжини (за вагою — оцінкою ширини). */
function splitRows(items: ReactNode[], weights: number[]): [ReactNode[], ReactNode[]] {
  const total = weights.reduce((a, b) => a + b, 0);
  const a: ReactNode[] = [];
  const b: ReactNode[] = [];
  let acc = 0;
  items.forEach((it, i) => {
    if (acc < total / 2) {
      a.push(it);
      acc += weights[i]!;
    } else b.push(it);
  });
  return [a, b];
}

export function Marquee({ label, children, rows = 1, speed = 28, gap = 8, bleed = 0, weights, className }: MarqueeProps) {
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { paused, hold, handlers } = usePause(root);
  const items = Children.toArray(children);
  const v = reduced ? 0 : speed;
  const lines = rows === 2 && items.length > 1 ? splitRows(items, items.map((_, i) => weights?.[i] ?? 1)) : [items];
  return (
    <div
      ref={root}
      role="region"
      aria-label={label}
      data-marquee=""
      data-paused={paused || undefined}
      className={cn('t2f-marquee flex flex-col', className)}
      style={{ gap }}
      {...handlers}
    >
      {lines.map((line, i) => (
        <MarqueeRow key={i} items={line} gap={gap} bleed={bleed} speed={v} paused={paused} onManual={hold} />
      ))}
    </div>
  );
}
