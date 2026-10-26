'use client';

/**
 * C3. MiniPlayer — лише десктоп. Відео в ньому те саме, що й у `PlayerBlock`: другого плеєра немає.
 * Коли мініплеєр видимий, його відеообласть реєструється в `PlayerProvider` як слот `main`, і єдиний
 * `PlayerHost` пересідає над нею (iframe не перемонтовується, відео не перезавантажується);
 * при закритті попередній слот повертається. Колонку чату праворуч мініплеєр не перекриває:
 * типові кути — ліві (`DEFAULT_CORNERS`); якщо фокус потрапляє під нього, він переходить в інший кут.
 * У DOM мініплеєр стоїть після основного керування (ставити в кінці макета).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { cornerAvoiding, DEFAULT_CORNERS, nextCorner, type MiniPlayerCorner } from '@/lib/player/miniPlayerCorners';
import { usePlayerActions, useOptionalPlayerInternals } from '@/lib/player/PlayerProvider';
import { MINI_SLOT_ATTR, useMiniPlayerVisibility } from '@/lib/player/useMiniPlayerVisibility';

export type { MiniPlayerCorner } from '@/lib/player/miniPlayerCorners';

export interface MiniPlayerProps {
  /** Назва трансляції: «Лондон · Біг-Бен» (без відмінювання). */
  title: string;
  visible: boolean;
  /** Кут: керований (разом із `onCornerChange`) або з початковим `defaultCorner`. */
  corner?: MiniPlayerCorner;
  defaultCorner?: MiniPlayerCorner;
  onCornerChange?: (corner: MiniPlayerCorner) => void;
  /** Дозволені кути (по колу). Типово — ліві, бо чат праворуч. */
  corners?: readonly MiniPlayerCorner[];
  onReturn?: () => void;
  onFullscreen?: () => void;
  onClose?: () => void;
  /** Що стоїть на місці відео, поки хост плеєра його не показує (у Storybook — постер). */
  fallback?: ReactNode;
  className?: string;
}

const POSITION: Record<MiniPlayerCorner, string> = {
  'bottom-left': 'bottom-6 start-6',
  'top-left': 'top-20 start-6',
  'bottom-right': 'bottom-6 end-6',
  'top-right': 'top-20 end-6',
};

function MoveCornerIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <rect x="12" y="12" width="7" height="6" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MiniPlayer({
  title,
  visible,
  corner,
  defaultCorner = DEFAULT_CORNERS[0] ?? 'bottom-left',
  onCornerChange,
  corners = DEFAULT_CORNERS,
  onReturn,
  onFullscreen,
  onClose,
  fallback,
  className,
}: MiniPlayerProps) {
  const t = useTranslations('liveCards.miniPlayer');
  const internals = useOptionalPlayerInternals();
  const registerSlot = internals?.registerSlot;
  const currentSlot = internals?.slotElement ?? null;

  const [innerCorner, setInnerCorner] = useState<MiniPlayerCorner>(defaultCorner);
  const active = corner ?? innerCorner;
  const rootRef = useRef<HTMLElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const currentSlotRef = useRef<HTMLElement | null>(currentSlot);

  const setCorner = (next: MiniPlayerCorner) => {
    if (next === active) return;
    if (corner === undefined) setInnerCorner(next);
    onCornerChange?.(next);
  };
  const setCornerRef = useRef(setCorner);
  useEffect(() => {
    currentSlotRef.current = currentSlot;
    setCornerRef.current = setCorner;
  });

  // Хост пересідає над відеообласть мініплеєра; при закритті повертається на попередній слот.
  useEffect(() => {
    if (!visible || !registerSlot) return;
    const el = slotRef.current;
    if (!el) return;
    const previous = currentSlotRef.current;
    const unregister = registerSlot('main', el);
    return () => {
      unregister();
      const stillOurs = currentSlotRef.current === el || currentSlotRef.current === null;
      if (stillOurs && previous && previous.isConnected && !previous.hasAttribute(MINI_SLOT_ATTR)) registerSlot('main', previous);
    };
  }, [visible, registerSlot]);

  // Кут змінився → хост має перерахувати позицію (слот не змінював розмір, лише місце).
  useLayoutEffect(() => {
    if (visible) window.dispatchEvent(new Event('resize'));
  }, [visible, active]);

  // Фокус під мініплеєром → інший кут (WCAG 2.4.11).
  useEffect(() => {
    if (!visible) return;
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      const box = rootRef.current;
      if (!(target instanceof Element) || !box || box.contains(target)) return;
      const r = target.getBoundingClientRect();
      const next = cornerAvoiding(
        active,
        corners,
        { top: r.top, left: r.left, width: r.width, height: r.height },
        { width: window.innerWidth, height: window.innerHeight },
      );
      if (next) setCornerRef.current(next);
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [visible, active, corners]);

  if (!visible) return null;

  return (
    <section
      ref={rootRef}
      aria-label={t('region', { title })}
      data-mini-player=""
      data-corner={active}
      className={cn(
        'fixed z-20 w-89.5 overflow-hidden rounded-md border border-border bg-surface shadow-mini-player',
        POSITION[active],
        className,
      )}
    >
      <div
        ref={slotRef}
        {...{ [MINI_SLOT_ATTR]: '' }}
        className="relative flex h-50 w-full items-center justify-center rounded-t-md bg-background"
      >
        {fallback ?? (
          <span className="flex flex-col items-center gap-1 text-caption font-medium text-text-muted">
            <Icon name="play" size={20} />
            {t('poster', { title })}
          </span>
        )}
      </div>
      <div className="flex h-touch-min items-center border-t border-border ps-1 pe-0.5">
        <button
          type="button"
          onClick={onReturn}
          className="t2f-focus t2f-press t2f-transition inline-flex min-h-touch-min items-center gap-1.5 rounded-md px-2.5 text-label-sm text-text hover:bg-surface-raised"
        >
          <Icon name="arrow-left" size={18} />
          {t('return')}
        </button>
        <span className="flex-1" />
        <IconButton icon="expand" aria-label={t('fullscreen')} onClick={onFullscreen} />
        <button
          type="button"
          aria-label={t('move')}
          onClick={() => setCorner(nextCorner(active, corners))}
          className="t2f-focus t2f-press t2f-transition group inline-flex size-touch-min shrink-0 items-center justify-center rounded-full"
        >
          <span className="t2f-transition inline-flex size-full items-center justify-center rounded-full border border-transparent text-text group-hover:bg-surface-raised">
            <MoveCornerIcon />
          </span>
        </button>
        <IconButton icon="close" aria-label={t('close')} onClick={onClose} />
      </div>
    </section>
  );
}

/**
 * Мініплеєр, підключений до `PlayerProvider`: видимий, коли основний слот вийшов за екран на десктопі;
 * «Повернутися» прокручує до плеєра, «Повний екран» розгортає хост, × зупиняє відео й закриває мініплеєр.
 * Ставити в кінці `(live)`-макета, після основного керування.
 */
export function ConnectedMiniPlayer(props: Omit<MiniPlayerProps, 'visible'> & { enabled?: boolean }) {
  const { enabled = true, onReturn, onFullscreen, onClose, ...rest } = props;
  const { visible, dismiss, returnToPlayer } = useMiniPlayerVisibility({ enabled });
  const { pause } = usePlayerActions();
  return (
    <MiniPlayer
      {...rest}
      visible={visible}
      onReturn={onReturn ?? returnToPlayer}
      onFullscreen={
        onFullscreen ??
        (() => {
          void document.querySelector<HTMLElement>('[data-player-host]')?.requestFullscreen?.();
        })
      }
      onClose={
        onClose ??
        (() => {
          pause();
          dismiss();
        })
      }
    />
  );
}
