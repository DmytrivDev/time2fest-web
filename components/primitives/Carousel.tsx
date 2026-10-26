'use client';

import Autoplay from 'embla-carousel-autoplay';
import useEmblaCarousel from 'embla-carousel-react';
import { useTranslations } from 'next-intl';
import { Children, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { cn } from './cn';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { IconButton } from './IconButton';


export interface CarouselProps {
  /** Назва каруселі для зчитувача («Зараз і далі», «Перший ряд · Лондон»). */
  label: string;
  /** Слайди: кожен прямий дочірній елемент — один слайд. Ширину слайда задає сам елемент. */
  children: ReactNode;
  /**
   * Автогортання — лише для стіни «Першого ряду» (ІНВ P26): по колу, пауза на наведенні й фокусі,
   * вимкнене під «зменшити рух». Для решти каруселей не вмикати.
   */
  autoplay?: boolean;
  /** Затримка автогортання, мс. */
  autoplayDelay?: number;
  /** По колу (автогортання завжди по колу). */
  loop?: boolean;
  /** Кнопка «Пауза» поруч (WCAG 2.2.2) — для каруселей з автогортанням. */
  showPause?: boolean;
  className?: string;
  /** Клас стрічки слайдів (відступи між ними). */
  trackClassName?: string;
}

/** P26. Карусель на Embla. Стрілка лише з того боку, де є непройдені елементи; перетягування мишею; стрілки клавіатури у фокусі. */
export function Carousel({
  label,
  children,
  autoplay = false,
  autoplayDelay = 4000,
  loop = false,
  showPause = false,
  className,
  trackClassName,
}: CarouselProps) {
  const t = useTranslations('primitives.carousel');
  const reduce = useReducedMotion();
  const slides = Children.toArray(children);
  const [paused, setPaused] = useState(false);

  const plugins = useMemo(
    () =>
      autoplay && !reduce
        ? [Autoplay({ delay: autoplayDelay, stopOnInteraction: false, stopOnMouseEnter: true, stopOnFocusIn: true, playOnInit: true })]
        : [],
    [autoplay, reduce, autoplayDelay],
  );
  const [viewport, api] = useEmblaCarousel({ align: 'start', loop: loop || autoplay, dragFree: false, containScroll: 'trimSnaps' }, plugins);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const update = useCallback(() => {
    if (!api) return;
    setCanPrev(api.canScrollPrev());
    setCanNext(api.canScrollNext());
  }, [api]);

  useEffect(() => {
    if (!api) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- синхронізація зі станом зовнішньої бібліотеки (Embla)
    update();
    api.on('select', update).on('reInit', update).on('resize', update);
    return () => {
      api.off('select', update).off('reInit', update).off('resize', update);
    };
  }, [api, update]);

  useEffect(() => {
    const player = api?.plugins().autoplay;
    if (!player) return;
    if (paused) player.stop();
    else player.play();
  }, [api, paused]);

  // Стрілки клавіатури гортають, коли фокус усередині каруселі.
  useEffect(() => {
    if (!api) return;
    const node = api.rootNode();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        api.scrollNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        api.scrollPrev();
      }
    };
    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [api]);

  const wantsPause = (showPause || autoplay) && autoplay && !reduce;

  return (
    <section aria-roledescription="carousel" aria-label={label} className={cn('relative', className)}>
      {/* Зміни слайдів зчитувач не оголошує */}
      <div ref={viewport} className="overflow-hidden" aria-live="off">
        <div className={cn('flex gap-2', trackClassName)}>
          {slides.map((slide, i) => (
            <div
              key={i}
              role="group"
              aria-roledescription="slide"
              aria-label={t('slide', { index: i + 1, total: slides.length })}
              className="min-w-0 shrink-0 grow-0"
            >
              {slide}
            </div>
          ))}
        </div>
      </div>
      {canPrev && (
        <IconButton
          icon="chevron-left"
          variant="ring"
          aria-label={t('prev')}
          className="absolute start-1 top-1/2 -translate-y-1/2 rounded-full bg-background"
          onClick={() => api?.scrollPrev()}
        />
      )}
      {canNext && (
        <IconButton
          icon="chevron-right"
          variant="ring"
          aria-label={t('next')}
          className="absolute end-1 top-1/2 -translate-y-1/2 rounded-full bg-background"
          onClick={() => api?.scrollNext()}
        />
      )}
      {wantsPause && (
        <IconButton
          icon={paused ? 'play' : 'pause'}
          variant="ring"
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? t('play') : t('pause')}
          className="absolute bottom-1 end-1 rounded-full bg-background"
        />
      )}
    </section>
  );
}
