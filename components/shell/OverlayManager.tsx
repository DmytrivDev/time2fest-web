'use client';

/**
 * OverlayManager (ІНВ 5.3 / 4, EXPERIENCE «Вікна» і «Уточнення 2026-10-25»).
 * ОДНЕ вікно за раз: нове `open()` замінює відкрите. Розміщення залежить від типу вікна й в’юпорта:
 * - `form` / `accent` (з полем введення: O-NICK, O-FIRST-ROW, O-REMIND, O-SHARE) і `nonmodal` (O-AUTHOR, мова, профіль):
 *   телефон і планшет-портрет — `Sheet` під плеєром; є колонка чату (десктоп, планшет-альбом) — `ChatSlotPanel` на її місці;
 * - `inflow` (короткі вікна без введення: штамп, оцінка, пропозиції, «Що дає», cookies) — `InFlowSlot` під плеєром на будь-якій ширині;
 *   слот ставить сторінка через `<OverlayInFlowOutlet />` під рядком дій плеєра.
 * Коли чат сховано на десктопі, колонка тимчасово відкривається під панель: `#chat` отримує `data-chat-forced="true"`,
 * доки панель відкрита (ChatPanel / CSS сторінки ховають колонку лише без цього атрибута).
 * Вікно з власною кораловою кнопкою (`coral`) реєструється в `lib/overlay/coral` — кнопка звуку стає нейтральною.
 * `closeOn` — події шини (`lib/events/bus`), після яких вікно закривається саме (напр. оцінка — після `moment:rate-close`).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { CHAT_DOCK_SLOT_ID, ChatSlotPanel, InFlowSlot, SEAT_DOCK_SLOT_ID } from '@/components/primitives/Panel';
import { Sheet } from '@/components/primitives/Sheet';
import { on, type UiEventType } from '@/lib/events/bus';
import { useRegisterCoral } from '@/lib/overlay/coral';
import { useChatDock } from '@/stores/chatDock';
import { useGuestStore } from '@/stores/guest';

export type OverlayKind = 'form' | 'accent' | 'nonmodal' | 'inflow';
export type OverlayPlacement = 'sheet' | 'panel' | 'inflow' | 'dock' | 'seat';

export interface OverlaySpec {
  /** Ідентифікатор вікна (O-NICK тощо); повторне `open` з тим самим id оновлює вміст. */
  id: string;
  kind: OverlayKind;
  title: ReactNode;
  description?: ReactNode;
  content: ReactNode;
  /** Стан `l` аркуша. */
  loading?: boolean;
  /** Шапка вікна за макетом O-NICK (заголовок з підзаголовком, × 44 px, тіло без відступів — відступи дає вміст). */
  chrome?: 'board' | 'author';
  /** У вікні є власна коралова кнопка (звук стає нейтральним). */
  coral?: boolean;
  /** Події шини, після яких вікно закривається саме. */
  closeOn?: UiEventType[];
  /** Вікно чату (O-NICK, O-AUTHOR, правила, «Моя емоція»): на телефоні відкривається всередині розгорнутого вікна чату. */
  inChat?: boolean;
  /** Викликається, коли вікно закрито (людиною, заміною чи подією). */
  onClose?: () => void;
}

/**
 * Розміщення за типом і наявністю колонки чату. Телефон з вікном чату внизу: вікна чату — усередині нього (`dock`),
 * вікно покупки «Першого ряду» (`accent`) — окремим шаром поверх чату (`seat`, рішення 2026-10-29).
 */
export function placementFor(kind: OverlayKind, chatColumn: boolean, inDock = false, seatDock = false): OverlayPlacement {
  if (kind === 'inflow') return 'inflow';
  if (chatColumn) return 'panel';
  if (kind === 'accent' && seatDock) return 'seat';
  return inDock ? 'dock' : 'sheet';
}

export interface OverlayApi {
  current: OverlaySpec | null;
  open(spec: OverlaySpec): void;
  /** Без `id` закриває будь-яке відкрите вікно; з `id` — лише якщо відкрите саме воно. */
  close(id?: string): void;
}

function dockSlotExists(id = CHAT_DOCK_SLOT_ID): boolean {
  return typeof document !== 'undefined' && document.getElementById(id) !== null;
}

const OverlayContext = createContext<OverlayApi | null>(null);

const NOOP_API: OverlayApi = { current: null, open: () => undefined, close: () => undefined };

/** Поза OverlayManager (історії, тести) — тиха заглушка. */
export function useOverlay(): OverlayApi {
  return useContext(OverlayContext) ?? NOOP_API;
}

/** Чи відкрите якесь вікно (рушій пропозицій: `overlayOpen`, data-model 2). */
export function useOverlayOpen(): boolean {
  return useOverlay().current !== null;
}

/** Колонка чату є: десктоп ≥ 1200 і планшет-альбом (збігається з live-shell.module.css). */
export const CHAT_COLUMN_QUERY = '(min-width: 1200px), (min-width: 768px) and (orientation: landscape) and (not ((max-height: 500px) and (pointer: coarse)))';

function subscribeColumn(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const mq = window.matchMedia(CHAT_COLUMN_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const getColumn = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(CHAT_COLUMN_QUERY).matches : false);

/** Телефон у альбомній орієнтації (низький екран, дотик): окремий режим вікна чату (`ChatDock`), без колонки. */
export const PHONE_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)';
function subscribeLandscape(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const mq = window.matchMedia(PHONE_LANDSCAPE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const getLandscape = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_LANDSCAPE_QUERY).matches : false;
export function usePhoneLandscape(): boolean {
  return useSyncExternalStore(subscribeLandscape, getLandscape, () => false);
}

export function useChatColumn(): boolean {
  return useSyncExternalStore(subscribeColumn, getColumn, () => false);
}

function CoralClaim() {
  useRegisterCoral();
  return null;
}

export interface OverlayManagerProps {
  children?: ReactNode;
}

export function OverlayManager({ children }: OverlayManagerProps) {
  const [current, setCurrent] = useState<OverlaySpec | null>(null);
  const chatColumn = useChatColumn();
  const chatHidden = useGuestStore((s) => s.chatHidden);

  // Дзеркало стану: `onClose` викликається поза оновленням стану (без дублів у StrictMode).
  const ref = useRef<OverlaySpec | null>(null);
  const set = useCallback((next: OverlaySpec | null) => {
    ref.current = next;
    setCurrent(next);
  }, []);

  const open = useCallback(
    (spec: OverlaySpec) => {
      const prev = ref.current;
      // Телефон: вікно чату відкривається всередині розгорнутого чату — спершу розгортаємо його.
      if (spec.inChat && spec.kind !== 'inflow' && !chatColumn && dockSlotExists()) useChatDock.getState().setExpanded(true);
      set(spec);
      if (prev && prev.id !== spec.id) prev.onClose?.();
    },
    [set, chatColumn],
  );

  const close = useCallback(
    (id?: string) => {
      const prev = ref.current;
      if (!prev || (id !== undefined && prev.id !== id)) return;
      set(null);
      prev.onClose?.();
    },
    [set],
  );

  // Події шини, що закривають поточне вікно.
  const closeOnKey = current?.closeOn?.join('|') ?? '';
  const currentId = current?.id;
  useEffect(() => {
    if (!currentId || !closeOnKey) return;
    const offs = (closeOnKey.split('|') as UiEventType[]).map((type) => on(type, () => close(currentId)));
    return () => offs.forEach((off) => off());
  }, [currentId, closeOnKey, close]);

  const placement = current
    ? placementFor(current.kind, chatColumn, !!current.inChat && dockSlotExists(), dockSlotExists(SEAT_DOCK_SLOT_ID))
    : null;

  // Чат сховано на десктопі: колонка тимчасово відкривається під панель.
  const forceColumn = placement === 'panel' && chatHidden;
  useEffect(() => {
    if (!forceColumn) return;
    const aside = document.getElementById('chat');
    aside?.setAttribute('data-chat-forced', 'true');
    return () => aside?.removeAttribute('data-chat-forced');
  }, [forceColumn]);

  const api = useMemo<OverlayApi>(() => ({ current, open, close }), [current, open, close]);
  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!next) close(currentId);
    },
    [close, currentId],
  );

  return (
    <OverlayContext.Provider value={api}>
      {children}
      {current && current.coral ? <CoralClaim key={current.id} /> : null}
      {current && placement === 'sheet' ? (
        <Sheet open onOpenChange={onOpenChange} title={current.title} description={current.description} loading={current.loading} boardHeader={current.chrome === 'board'} authorHeader={current.chrome === 'author'}>
          {current.content}
        </Sheet>
      ) : null}
      {current && placement === 'dock' ? (
        <ChatSlotPanel
          open
          onOpenChange={onOpenChange}
          containerId={CHAT_DOCK_SLOT_ID}
          variant={current.kind === 'accent' ? 'accent' : current.kind === 'nonmodal' ? 'nonmodal' : 'form'}
          title={current.title}
          description={current.description}
          boardHeader={current.chrome === 'board'}
          authorHeader={current.chrome === 'author'}
        >
          {current.content}
        </ChatSlotPanel>
      ) : null}
      {current && placement === 'seat' ? (
        <ChatSlotPanel
          open
          onOpenChange={onOpenChange}
          containerId={SEAT_DOCK_SLOT_ID}
          variant="accent"
          title={current.title}
          description={current.description}
          boardHeader={current.chrome === 'board'}
          className="t2f-seat-panel"
        >
          {current.content}
        </ChatSlotPanel>
      ) : null}
      {current && placement === 'panel' ? (
        <ChatSlotPanel
          open
          onOpenChange={onOpenChange}
          variant={current.kind === 'accent' ? 'accent' : current.kind === 'nonmodal' ? 'nonmodal' : 'form'}
          title={current.title}
          description={current.description}
          boardHeader={current.chrome === 'board'}
          authorHeader={current.chrome === 'author'}
        >
          {current.content}
        </ChatSlotPanel>
      ) : null}
    </OverlayContext.Provider>
  );
}

export interface OverlayInFlowOutletProps {
  reserveHeight?: number;
  label?: string;
  className?: string;
}

/** Місце під рядком дій плеєра для вікон `inflow`; сторінка ставить його один раз. */
export function OverlayInFlowOutlet({ reserveHeight, label, className }: OverlayInFlowOutletProps) {
  const { current } = useOverlay();
  const spec = current && current.kind === 'inflow' ? current : null;
  return (
    <InFlowSlot reserveHeight={reserveHeight} label={label} className={className}>
      {spec ? <div key={spec.id}>{spec.content}</div> : null}
    </InFlowSlot>
  );
}
