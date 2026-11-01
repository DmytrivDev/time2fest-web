'use client';

/**
 * P17 Sheet (телефон) і P20 Scrim.
 * - аркуш живе в просторі ПІД закріпленим плеєром: верх аркуша й затемнення не заходять на відео
 *   (нічого поверх плеєра); висота ≤ простору під плеєром, прокрутка всередині;
 * - закриття: ×, Esc, свайп униз за ручку, дотик по затемненню;
 * - `loading` — стан `l` (скелетон рядків).
 * Основа — Radix Dialog (фокус-пастка й повернення фокуса).
 */
import { Dialog } from 'radix-ui';
import { useCallback, useEffect, useRef, useState, type ComponentProps, type PointerEvent, type ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';
import { IconButton } from './IconButton';

/** Нижній край області плеєра у в’юпорті (0, якщо плеєра на сторінці немає або він прокручений). */
function readPlayerBottom(): number {
  const slot = document.querySelector<HTMLElement>('[data-player-slot="main"]');
  if (!slot) return 0;
  const r = slot.getBoundingClientRect();
  return Math.max(0, Math.min(window.innerHeight, r.bottom));
}

/** Вимірює простір під плеєром, поки `active`. */
export function usePlayerBottom(active: boolean): number {
  const [bottom, setBottom] = useState(0);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setBottom(readPlayerBottom());
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, { capture: true });
    };
  }, [active]);
  return bottom;
}

export interface ScrimProps extends ComponentProps<'div'> {
  /** Верхній край затемнення (низ плеєра); 0 — на сторінках без плеєра. */
  top?: number;
}

/** P20. Затемнення лише під аркушем (нижче плеєра) і на сторінках без плеєра. */
export function Scrim({ top = 0, className, style, ...rest }: ScrimProps) {
  return (
    <div
      data-scrim=""
      className={cn('fixed inset-x-0 bottom-0 z-40 bg-scrim', className)}
      style={{ top, ...style }}
      {...rest}
    />
  );
}

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Стан `l`. */
  loading?: boolean;
  /** TODO(i18n): з messages. */
  closeLabel?: string;
  backLabel?: string;
  /** Шапка за макетом O-NICK (ручка 36×4, заголовок 18/700 з підзаголовком, × 44 px, тіло без бічних відступів). */
  boardHeader?: boolean;
  /** З `boardHeader`: рядок «‹ Назад» і «×» над назвою (вікно другого рівня). */
  onBack?: () => void;
  /** Шапка O-AUTHOR (як на дошці): без ручки, «‹ Назад» і приглушений заголовок; аркуш на всю висоту під плеєром, тіло керує прокруткою саме. */
  authorHeader?: boolean;
  className?: string;
}

const SWIPE_CLOSE_PX = 64;

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  loading = false,
  closeLabel = 'Закрити',
  backLabel = 'Назад',
  boardHeader = false,
  onBack,
  authorHeader = false,
  className,
}: SheetProps) {
  const top = usePlayerBottom(open);
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    startY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (startY.current === null) return;
    setDragY(Math.max(0, e.clientY - startY.current));
  }, []);
  const onPointerEnd = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (startY.current === null) return;
      const dy = e.clientY - startY.current;
      startY.current = null;
      setDragY(0);
      if (dy > SWIPE_CLOSE_PX) onOpenChange(false);
    },
    [onOpenChange],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <Scrim top={top} />
        </Dialog.Overlay>
        <Dialog.Content
          data-sheet=""
          className={cn(
            'fixed inset-x-0 bottom-0 z-40 flex flex-col overflow-hidden rounded-t-lg bg-surface text-text shadow-overlay',
            className,
          )}
          style={{ maxHeight: `calc(100dvh - ${top}px)`, height: authorHeader ? `calc(100dvh - ${top}px)` : undefined, transform: dragY ? `translateY(${dragY}px)` : undefined }}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          {authorHeader ? null : (
          <div
            className={cn('flex shrink-0 touch-none justify-center', boardHeader ? 'h-4 items-end pb-1' : 'h-6 items-center')}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            aria-hidden="true"
          >
            <span className={cn('h-1 rounded-full', boardHeader ? 'w-9 bg-border' : 'w-10 bg-border-strong')} />
          </div>
          )}
          {authorHeader ? (
            <div className="t2f-author-header" data-author-header="">
              <Dialog.Close asChild>
                <button type="button" className="t2f-focus t2f-transition t2f-author-back">
                  <Icon name="chevron-left" size={18} className="[stroke-width:2]" />
                  {backLabel}
                </button>
              </Dialog.Close>
              <span className="flex-1" />
              <Dialog.Title className="text-caption font-normal text-text-muted">{title}</Dialog.Title>
            </div>
          ) : boardHeader ? (
            <div className="flex shrink-0 items-start gap-1 pe-1 ps-4 pt-1" data-board-header="">
              {/* З «‹ Назад» рядок із × стоїть на тій самій висоті, що × у звичайних вікнах (правило 2026-11-01). */}
              <div className={cn('min-w-0 flex-1', onBack ? 'pt-0' : 'pt-2.5')}>
                {onBack ? (
                <div className="flex min-h-11 items-center justify-between" data-back-row="">
                  <button type="button" onClick={onBack} data-action="back" className="t2f-focus t2f-transition t2f-author-back t2f-back-flush">
                    <Icon name="chevron-left" size={18} className="[stroke-width:2]" />
                    {backLabel}
                  </button>
                  <Dialog.Close asChild>
                    <IconButton icon="close" aria-label={closeLabel} />
                  </Dialog.Close>
                </div>
              ) : null}
                <Dialog.Title className="t2f-board-title">{title}</Dialog.Title>
                {description ? <Dialog.Description className="mt-1 text-caption text-text-muted">{description}</Dialog.Description> : null}
              </div>
              {onBack ? null : (
                <Dialog.Close asChild>
                  <IconButton icon="close" aria-label={closeLabel} />
                </Dialog.Close>
              )}
            </div>
          ) : (
            <>
              <div className="flex shrink-0 items-center justify-between gap-2 px-4">
                <Dialog.Title className="text-headline-sm">{title}</Dialog.Title>
                <Dialog.Close asChild>
                  <IconButton icon="close" aria-label={closeLabel} />
                </Dialog.Close>
              </div>
              {description ? (
                <Dialog.Description className="px-4 text-body text-text-secondary">{description}</Dialog.Description>
              ) : null}
            </>
          )}
          <div
            className={cn(authorHeader ? 'flex min-h-0 flex-1 flex-col' : 'min-h-0 flex-1 overflow-y-auto', !authorHeader && (boardHeader ? 'pb-0' : 'px-4 pb-6 pt-2'))}
            aria-busy={loading || undefined}
          >
            {loading ? (
              // TODO(T053): <Skeleton variant="line" />
              <div className="flex flex-col gap-3" role="status">
                <span className="sr-only">Завантаження</span>
                <span className="h-4 w-3/4 rounded-sm bg-surface-raised" />
                <span className="h-4 w-1/2 rounded-sm bg-surface-raised" />
                <span className="h-4 w-2/3 rounded-sm bg-surface-raised" />
              </div>
            ) : (
              children
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
