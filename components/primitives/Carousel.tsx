'use client';

/**
 * P26. Карусель («Зараз і далі»; колись і стіна «Першого ряду», прибрана 2026-11-12) — рішення власника після перегляду головної:
 * - стрічка завжди на всю ширину, нічого не перекомпоновується й не «стрибає»; нативна прокрутка з прилипанням
 *   до початку елементів (scroll-snap), тож ліворуч завжди видно край першого видимого елемента;
 * - `loop` (стіна): прокрутка по колу без кінця — копії слайдів по боках, непомітний перескок на те саме місце
 *   в середній копії; обидві стрілки завжди активні; правий край м’яко згасає (`fade`);
 * - без `loop` («Зараз і далі»): гортання лише до країв, на краю відповідна стрілка неактивна;
 * - стрілки: `sides` — ліворуч і праворуч від стрічки (поза нею); `none` — без стрілок (зовнішні через `useCarousel`
 *   і `CarouselArrow`, напр. у рядку заголовка); стрілка гортає на один слайд (правка власника 2026-10-31);
 * - мишею — натиснути й тягти будь-де, зокрема над картками-посиланнями (нативне перетягування посилань вимкнено);
 *   короткий клік лишається кліком; на дотик — свайп (нативно);
 * - стрілки й відпускання після перетягування плавно (≈0,45 с, сповільнення наприкінці) доводять стрічку до початку
 *   картки — ніколи не лишається пів картки зліва (правка власника 2026-10-31); після перетягування — у бік руху.
 * Копії слайдів — `inert` і `aria-hidden`: зчитувач і Tab бачать кожен елемент один раз.
 */
import { useTranslations } from 'next-intl';
import { Children, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';

const SLIDE = '[aria-roledescription="slide"]';

/** Позиції прокрутки, на яких картка стоїть рівно біля лівого краю (остання — кінець стрічки). */
export function slideStops(el: HTMLElement, selector = SLIDE): number[] {
  const slides = el.querySelectorAll<HTMLElement>(selector);
  if (!slides.length) return [0];
  const base = slides[0]!.offsetLeft;
  const max = Math.max(0, el.scrollWidth - el.clientWidth);
  return [...new Set([...slides].map((sl) => Math.round(Math.min(max, sl.offsetLeft - base))))].sort((a, b) => a - b);
}

const glides = new WeakMap<HTMLElement, number>();

/** Плавна прокрутка до `target` (ease-out). Прилипання (snap) на час руху вимкнено — інакше браузер «стрибає». */
export function glideTo(el: HTMLElement, target: number, ms = 450) {
  const prev = glides.get(el);
  if (prev) cancelAnimationFrame(prev);
  const reduce = document.documentElement.getAttribute('data-reduce-motion') === 'true' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const from = el.scrollLeft;
  if (reduce || Math.abs(target - from) < 1 || typeof requestAnimationFrame !== 'function') {
    el.scrollLeft = target;
    delete el.dataset.dragging;
    return;
  }
  el.dataset.dragging = 'true';
  const start = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - start) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.scrollLeft = from + (target - from) * e;
    if (k < 1) glides.set(el, requestAnimationFrame(step));
    else {
      glides.delete(el);
      el.scrollLeft = target;
      delete el.dataset.dragging;
    }
  };
  glides.set(el, requestAnimationFrame(step));
}

export interface CarouselController {
  viewportRef: RefObject<HTMLDivElement | null>;
  canPrev: boolean;
  canNext: boolean;
  prev(): void;
  next(): void;
  /** Перерахувати краї (після зміни слайдів). */
  update(): void;
}

/** Прокрутка стрічки: краї, сторінка вліво / вправо. `loop` — стрілки завжди активні. */
export function useCarousel({ loop = false }: { loop?: boolean } = {}): CarouselController {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ prev: false, next: false });
  const update = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const prev = el.scrollLeft > 1;
    const next = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((e) => (e.prev === prev && e.next === next ? e : { prev, next }));
  }, []);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [update]);
  const page = useCallback((dir: 1 | -1) => {
    const el = viewportRef.current;
    if (!el) return;
    const reduce = document.documentElement.getAttribute('data-reduce-motion') === 'true';
    if (el.closest('[data-loop="true"]')) {
      // По колу (стіна): крок на слайд, далі — прилипання й тихий перескок між копіями.
      const slides = el.querySelectorAll<HTMLElement>('[aria-roledescription="slide"]');
      const step = slides.length > 1 ? slides[1]!.offsetLeft - slides[0]!.offsetLeft : slides[0]?.offsetWidth || 120;
      el.scrollBy({ left: dir * step, behavior: reduce ? 'auto' : 'smooth' });
      return;
    }
    // На одну картку від тієї, що зараз біля лівого краю, — плавно й рівно на її початок.
    const stops = slideStops(el);
    const cur = el.scrollLeft;
    const target = dir > 0 ? (stops.find((x) => x > cur + 2) ?? stops.at(-1)!) : ([...stops].reverse().find((x) => x < cur - 2) ?? 0);
    glideTo(el, target);
  }, []);
  const prev = useCallback(() => page(-1), [page]);
  const next = useCallback(() => page(1), [page]);
  return { viewportRef, canPrev: loop || edges.prev, canNext: loop || edges.next, prev, next, update };
}

export interface CarouselArrowProps {
  dir: 'prev' | 'next';
  label: string;
  disabled?: boolean;
  onClick(): void;
  /** `sm` — коло 30 px (стіна, макет `Main`), `md` — коло 36 px у рядку заголовка. Ціль — завжди 44 px. */
  size?: 'sm' | 'md';
  className?: string;
}

/** Стрілка каруселі: ціль 44 px, видиме коло з рамкою border-strong (макет `Main`). */
export function CarouselArrow({ dir, label, disabled = false, onClick, size = 'sm', className }: CarouselArrowProps) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      data-carousel-arrow={dir}
      className={cn('t2f-focus t2f-carousel-arrow', size === 'md' ? 't2f-carousel-arrow-md' : 't2f-carousel-arrow-sm', className)}
    >
      <span aria-hidden="true" className="t2f-carousel-circle">
        <Icon name={dir === 'prev' ? 'chevron-left' : 'chevron-right'} size={size === 'md' ? 16 : 14} strokeWidth={2.2} />
      </span>
    </button>
  );
}

export interface CarouselProps {
  /** Назва каруселі для зчитувача. */
  label: string;
  /** Слайди: кожен прямий дочірній елемент — один слайд. Ширину слайда задає сам елемент. */
  children: ReactNode;
  /** По колу. */
  loop?: boolean;
  /** `sides` — стрілки по боках; `none` — без стрілок (зовнішній `controller`, телефон). */
  arrows?: 'sides' | 'none';
  /** Зовнішнє керування (стрілки в рядку заголовка). */
  controller?: CarouselController;
  prevLabel?: string;
  nextLabel?: string;
  /** М’яке згасання правого краю (стіна). */
  fade?: boolean;
  className?: string;
  trackClassName?: string;
}

export function Carousel({
  label,
  children,
  loop = false,
  arrows = 'sides',
  controller,
  prevLabel,
  nextLabel,
  fade = false,
  className,
  trackClassName,
}: CarouselProps) {
  const t = useTranslations('primitives.carousel');
  const own = useCarousel({ loop });
  const ctl = controller ?? own;
  const { viewportRef, update } = ctl;
  const slides = Children.toArray(children);
  const trackRef = useRef<HTMLDivElement>(null);
  // Копії для прокрутки по колу — лише коли стрічка справді ширша за вікно (інакше крутити нічого).
  const [overflow, setOverflow] = useState(false);
  const looping = loop && overflow;

  useLayoutEffect(() => {
    const el = viewportRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const check = () => {
      const c1 = track.querySelector<HTMLElement>('[data-copy="1"]');
      const c2 = track.querySelector<HTMLElement>('[data-copy="2"]');
      const copyWidth = c1 && c2 ? c2.offsetLeft - c1.offsetLeft : track.scrollWidth;
      setOverflow(copyWidth > el.clientWidth + 1);
    };
    check();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(check) : null;
    ro?.observe(el);
    ro?.observe(track);
    return () => ro?.disconnect();
  }, [viewportRef, slides.length]);

  // По колу: старт на початку середньої копії; заїхали в бічну копію — тихий перескок на те саме місце в середній.
  useLayoutEffect(() => {
    if (!looping) return;
    const el = viewportRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const at = (copy: number) => {
      const c = track.querySelector<HTMLElement>(`[data-copy="${copy}"]`);
      const c0 = track.querySelector<HTMLElement>('[data-copy="0"]');
      return c && c0 ? c.offsetLeft - c0.offsetLeft : 0;
    };
    el.scrollLeft = at(1);
    let timer = 0;
    const wrap = () => {
      if (el.dataset.dragging === 'true') return;
      const s1 = at(1);
      const w = at(2) - s1;
      if (w <= 0) return;
      if (el.scrollLeft < s1 - 1) el.scrollLeft += w;
      else if (el.scrollLeft >= s1 + w - 1) el.scrollLeft -= w;
    };
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(wrap, 160);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener('scroll', onScroll);
    };
  }, [looping, viewportRef, slides.length]);

  useDragScroll(viewportRef);

  useEffect(() => {
    update();
  }, [update, slides.length, looping]);

  const copies = looping ? [0, 1, 2] : [1];
  return (
    <section
      aria-roledescription="carousel"
      aria-label={label}
      data-carousel={arrows}
      data-loop={looping ? 'true' : undefined}
      className={cn('t2f-carousel', className)}
    >
      {arrows === 'sides' ? <CarouselArrow dir="prev" label={prevLabel ?? t('prev')} disabled={!ctl.canPrev} onClick={ctl.prev} /> : null}
      {/* Область прокрутки досяжна з клавіатури (←/→ гортають нативно): серед слайдів може не бути фокусованих. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div ref={viewportRef} tabIndex={0} aria-live="off" data-fade={fade ? 'true' : undefined} className="t2f-focus t2f-carousel-viewport">
        <div ref={trackRef} className={cn('t2f-carousel-track', trackClassName)}>
          {copies.map((copy) =>
            slides.map((slide, i) => {
              const clone = copy !== 1;
              return (
                <div
                  key={`${copy}-${i}`}
                  data-copy={i === 0 ? copy : undefined}
                  data-carousel-clone={clone ? '' : undefined}
                  role={clone ? undefined : 'group'}
                  aria-roledescription={clone ? undefined : 'slide'}
                  aria-label={clone ? undefined : t('slide', { index: i + 1, total: slides.length })}
                  aria-hidden={clone ? true : undefined}
                  inert={clone}
                  className="t2f-carousel-slide"
                >
                  {slide}
                </div>
              );
            }),
          )}
        </div>
      </div>
      {arrows === 'sides' ? <CarouselArrow dir="next" label={nextLabel ?? t('next')} disabled={!ctl.canNext} onClick={ctl.next} /> : null}
    </section>
  );
}

/**
 * Мишею: натиснути й тягти (без прилипання під час руху); клік після перетягування не спрацьовує. Відпустили — плавно
 * до початку картки (`selector` — слайди). Спільне для каруселей і стрічок мапи («Де дивитися»).
 */
export function useDragScroll(viewportRef: RefObject<HTMLElement | null>, selector = SLIDE) {
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let drag: { x: number; left: number; moved: boolean; id: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      const g = glides.get(el);
      if (g) {
        cancelAnimationFrame(g);
        glides.delete(el);
        delete el.dataset.dragging;
      }
      drag = { x: e.clientX, left: el.scrollLeft, moved: false, id: e.pointerId };
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        el.setPointerCapture(e.pointerId);
        el.dataset.dragging = 'true';
      }
      el.scrollLeft = drag.left - dx;
    };
    const up = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved;
      const dx = e.clientX - drag.x;
      drag = null;
      if (!moved) return;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (el.closest('[data-loop="true"]')) {
        delete el.dataset.dragging;
        // По колу: прилипання повертається; останній перескок між копіями — після нього.
        el.dispatchEvent(new Event('scroll'));
      } else {
        // Плавно до початку картки: потягнули помітно (> 30 px) — у бік руху, ледь-ледь — до найближчої.
        const stops = slideStops(el, selector);
        const cur = el.scrollLeft;
        let target = stops.reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a), stops[0]!);
        if (dx < -30) target = stops.find((x) => x >= cur - 1) ?? stops.at(-1)!;
        else if (dx > 30) target = [...stops].reverse().find((x) => x <= cur + 1) ?? 0;
        glideTo(el, target, 380);
      }
      const swallow = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      el.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 0);
    };
    // Посилання й картинки в слайдах браузер тягне сам (drag-and-drop) і перериває перетягування стрічки.
    const noNativeDrag = (e: DragEvent) => e.preventDefault();
    el.addEventListener('dragstart', noNativeDrag);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('dragstart', noNativeDrag);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [viewportRef, selector]);
}
