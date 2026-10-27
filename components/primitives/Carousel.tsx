'use client';

/**
 * P26. Карусель (стіна «Першого ряду», «Зараз і далі») — рішення власника після перегляду головної:
 * - стрічка завжди на всю ширину, нічого не перекомпоновується й не «стрибає»; нативна прокрутка з прилипанням
 *   до початку елементів (scroll-snap), тож ліворуч завжди видно край першого видимого елемента;
 * - `loop` (стіна): прокрутка по колу без кінця — копії слайдів по боках, непомітний перескок на те саме місце
 *   в середній копії; обидві стрілки завжди активні; правий край м’яко згасає (`fade`);
 * - без `loop` («Зараз і далі»): гортання лише до країв, на краю відповідна стрілка неактивна;
 * - стрілки: `sides` — ліворуч і праворуч від стрічки (поза нею); `none` — без стрілок (зовнішні через `useCarousel`
 *   і `CarouselArrow`, напр. у рядку заголовка); гортання на сторінку;
 * - мишею — натиснути й тягти; на дотик — свайп (нативно).
 * Копії слайдів — `inert` і `aria-hidden`: зчитувач і Tab бачать кожен елемент один раз.
 */
import { useTranslations } from 'next-intl';
import { Children, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';

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
    // Сторінка — ширина вікна без «хвоста»; прилипання (snap) доводить до початку елемента.
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth - 80), behavior: reduce ? 'auto' : 'smooth' });
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
  /** По колу (стіна «Першого ряду»). */
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

  // Мишею: натиснути й тягти (без прилипання під час руху); клік після перетягування не спрацьовує.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let drag: { x: number; left: number; moved: boolean; id: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
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
      drag = null;
      if (!moved) return;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      delete el.dataset.dragging;
      // Прилипання повертається — стрічка доїжджає до початку елемента; останній перескок по колу — після нього.
      el.dispatchEvent(new Event('scroll'));
      const swallow = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      el.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 0);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [viewportRef]);

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
