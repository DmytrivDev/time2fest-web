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
 * Шторки на телефоні (`seat`, `sheet`) закриваються плавно (рішення 2026-11-02): закрите вікно ще `CLOSE_MS` лишається
 * в `closing` і їде вниз; нове вікно чи зменшений рух прибирають його одразу.
 * Перехід на іншу сторінку без колонки чату (телефон, планшет-портрет) закриває шторку одразу (правка власника 2026-11-10):
 * вікно чату й шар шторок належать сторінці, тож на новій сторінці відкрита шторка була б порожньою.
 * Верх шторок — одне правило сайту за видом (`lib/overlay/sheetTop.ts`): вікна чату (`inChat`) — під смугою «Перший ряд»,
 * решта — під відео.
 */
import { usePathname } from 'next/navigation';
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
  /**
   * Вікно чату (O-NICK, O-AUTHOR, правила, «Моя емоція», вхід O-AUTH): на телефоні — усередині вікна чату, якщо воно вже
   * розгорнуте; якщо згорнуте — окремим шаром поверх сторінки (`separate`), сам чат не розгортається (правка 2026-10-29).
   */
  inChat?: boolean;
  /** Окремий шар на телефоні (як вікно покупки «Першого ряду»); ставить сам менеджер у `open`. */
  separate?: boolean;
  /** Викликається, коли вікно закрито (людиною, заміною чи подією). */
  onClose?: () => void;
  /** Вікно другого рівня (шапка `board`): зверху «‹ Назад» і «×», нижче — назва (рішення 2026-11-01, «Ще дії»). */
  onBack?: () => void;
  /** Сторінка, на якій вікно відкрито (`location.pathname`); ставить сам менеджер у `open`. */
  openedAt?: string;
}

/**
 * Розміщення за типом і наявністю колонки чату. Телефон з вікном чату внизу (рішення власника 2026-11-04 — два види
 * шторок, обидва без затемнення): вікна чату — усередині розгорнутого чату (`dock`) або, коли він згорнутий, окремим
 * шаром тієї самої висоти — до смуги «Перший ряд» (`seat`); усі інші вікна (пас, графік, «Перший ряд», «Поділитися»,
 * вхід, мова…) — окремим шаром вищим, до самого відео (`seat`, `ChatDock` міряє висоту за `inChat`).
 * Без вікна чату на сторінці — `Sheet`.
 */
export function placementFor(kind: OverlayKind, chatColumn: boolean, inDock = false, seatDock = false): OverlayPlacement {
  if (kind === 'inflow') return 'inflow';
  if (chatColumn) return 'panel';
  if (inDock) return 'dock';
  return seatDock ? 'seat' : 'sheet';
}

/** Вікно на телефоні — окремим шаром (`seat`), а не всередині розгорнутого чату. */
export function isSeatSpec(spec: OverlaySpec | null | undefined): boolean {
  return !!spec && spec.kind !== 'inflow' && (!spec.inChat || !!spec.separate);
}

export interface OverlayApi {
  current: OverlaySpec | null;
  /** Шторка, що саме закривається (їде вниз); `null` — нічого не закривається. */
  closing?: OverlaySpec | null;
  open(spec: OverlaySpec): void;
  /** Без `id` закриває будь-яке відкрите вікно; з `id` — лише якщо відкрите саме воно. */
  close(id?: string): void;
}

/** Подія: на сторінці з’явились чи зникли контейнери шторок (`ChatDock`) — менеджер перемальовує розміщення. */
const SLOTS_EVENT = 't2f:overlay-slots';
export function notifyOverlaySlots(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SLOTS_EVENT));
}

function dockSlotExists(id = CHAT_DOCK_SLOT_ID): boolean {
  return typeof document !== 'undefined' && document.getElementById(id) !== null;
}

const OverlayContext = createContext<OverlayApi | null>(null);

const NOOP_API: OverlayApi = { current: null, closing: null, open: () => undefined, close: () => undefined };

/** Тривалість виїзду шторки вниз (як згортання вікна чату). */
export const CLOSE_MS = 200;

function motionReduced(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.documentElement.getAttribute('data-reduce-motion') === 'true') return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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

/**
 * Планшет у портреті (768–1199, рішення власника 2026-11-10, дошка `Tab-P-New`): власний одноколонковий макет —
 * структура телефона (чат — шторка знизу), але поля 32 px і картки сіткою. Той самий запит, що в CSS-модулях.
 */
export const TABLET_PORTRAIT_QUERY = '(min-width: 768px) and (max-width: 1199.98px) and (orientation: portrait)';
function subscribeTabletPortrait(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const mq = window.matchMedia(TABLET_PORTRAIT_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const getTabletPortrait = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(TABLET_PORTRAIT_QUERY).matches : false;
export function useTabletPortrait(): boolean {
  return useSyncExternalStore(subscribeTabletPortrait, getTabletPortrait, () => false);
}

/** Планшет в альбомі (768–1199, крім телефона в альбомі; дошка `Tab-L-New`, 2026-11-10). */
export const TABLET_LANDSCAPE_QUERY =
  '(min-width: 768px) and (max-width: 1199.98px) and (orientation: landscape) and (not ((max-height: 500px) and (pointer: coarse)))';
function subscribeTabletLandscape(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const mq = window.matchMedia(TABLET_LANDSCAPE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const getTabletLandscape = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(TABLET_LANDSCAPE_QUERY).matches : false;
export function useTabletLandscape(): boolean {
  return useSyncExternalStore(subscribeTabletLandscape, getTabletLandscape, () => false);
}

/** Телефон (портрет чи альбом) або планшет-портрет: режиму вечірки тут немає — посилання ведуть на `/tv-info/`. */
const PARTY_INFO_QUERY = `(max-width: 767.98px), ${TABLET_PORTRAIT_QUERY}, ${PHONE_LANDSCAPE_QUERY}`;
function subscribePartyInfo(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const mq = window.matchMedia(PARTY_INFO_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const getPartyInfo = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PARTY_INFO_QUERY).matches : false;
/**
 * Куди веде «Режим вечірки» (меню, «⋯», футер, рядок дій, кімната; правка власника 2026-11-10): телефон і планшет-портрет —
 * інформаційна сторінка `/tv-info/`, десктоп і планшет-альбом — сам режим `/tv/`.
 */
export function usePartyHref(): '/tv/' | '/tv-info/' {
  return useSyncExternalStore(subscribePartyInfo, getPartyInfo, () => false) ? '/tv-info/' : '/tv/';
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
  // Шторка, що закривається: спека й її розміщення на момент закриття.
  const [closing, setClosing] = useState<{ spec: OverlaySpec; placement: OverlayPlacement } | null>(null);
  const placementRef = useRef<OverlayPlacement | null>(null);
  const closingTimer = useRef<number | undefined>(undefined);
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
      // Телефон: вікно чату — усередині розгорнутого чату; чат згорнутий — окремий шар, чат не розгортаємо.
      const separate =
        !!spec.inChat && spec.kind !== 'inflow' && !chatColumn && dockSlotExists() && !useChatDock.getState().expanded;
      // Те саме вікно оновлюється на місці (напр. вхід ↔ реєстрація): шар не змінюємо.
      const keep = prev && prev.id === spec.id ? prev.separate : undefined;
      // Нова шторка займає місце тієї, що закривається; вікно в потоці сторінки (рушій пропозицій відкриває його
      // одразу після закриття) виїзду не заважає.
      if (spec.kind !== 'inflow') {
        window.clearTimeout(closingTimer.current);
        setClosing(null);
      }
      set({ ...spec, separate: keep ?? separate, openedAt: window.location.pathname });
      if (prev && prev.id !== spec.id) prev.onClose?.();
    },
    [set, chatColumn],
  );

  const close = useCallback(
    (id?: string) => {
      const prev = ref.current;
      if (!prev || (id !== undefined && prev.id !== id)) return;
      const was = placementRef.current;
      if ((was === 'seat' || was === 'sheet') && !motionReduced()) {
        window.clearTimeout(closingTimer.current);
        setClosing({ spec: prev, placement: was });
        closingTimer.current = window.setTimeout(() => setClosing(null), CLOSE_MS + 40);
      }
      set(null);
      prev.onClose?.();
    },
    [set],
  );

  // Перехід на іншу сторінку (телефон, планшет-портрет): шторку закриваємо одразу, без виїзду. Вікно, яке нова сторінка
  // відкрила сама (уже на новій адресі), лишається.
  const pathname = usePathname();
  useEffect(() => {
    const cur = ref.current;
    if (chatColumn || !cur || cur.kind === 'inflow' || cur.openedAt === window.location.pathname) return;
    window.clearTimeout(closingTimer.current);
    setClosing(null);
    set(null);
    cur.onClose?.();
  }, [pathname, chatColumn, set]);

  // Контейнери шторок (`ChatDock`) змонтувались заново (нова сторінка): розміщення й портал — у нові контейнери.
  const [, bumpSlots] = useState(0);
  useEffect(() => {
    const onSlots = () => bumpSlots((n) => n + 1);
    window.addEventListener(SLOTS_EVENT, onSlots);
    return () => window.removeEventListener(SLOTS_EVENT, onSlots);
  }, []);

  // Події шини, що закривають поточне вікно.
  const closeOnKey = current?.closeOn?.join('|') ?? '';
  const currentId = current?.id;
  useEffect(() => {
    if (!currentId || !closeOnKey) return;
    const offs = (closeOnKey.split('|') as UiEventType[]).map((type) => on(type, () => close(currentId)));
    return () => offs.forEach((off) => off());
  }, [currentId, closeOnKey, close]);

  const placement = current
    ? placementFor(
        current.kind,
        chatColumn,
        !!current.inChat && !current.separate && dockSlotExists(),
        dockSlotExists(SEAT_DOCK_SLOT_ID),
      )
    : null;

  // Чат сховано на десктопі: колонка тимчасово відкривається під панель.
  const forceColumn = placement === 'panel' && chatHidden;
  useEffect(() => {
    if (!forceColumn) return;
    const aside = document.getElementById('chat');
    aside?.setAttribute('data-chat-forced', 'true');
    return () => aside?.removeAttribute('data-chat-forced');
  }, [forceColumn]);

  useEffect(() => {
    placementRef.current = placement;
  }, [placement]);
  useEffect(() => () => window.clearTimeout(closingTimer.current), []);

  const api = useMemo<OverlayApi>(() => ({ current, closing: closing?.spec ?? null, open, close }), [current, closing, open, close]);
  // Що малювати в шторках: відкрите вікно або те, що саме закривається.
  const sheetSpec = current && placement === 'sheet' ? current : closing?.placement === 'sheet' ? closing.spec : null;
  const seatSpec = current && placement === 'seat' ? current : closing?.placement === 'seat' ? closing.spec : null;
  const sheetClosing = !!sheetSpec && sheetSpec !== current;
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
      {sheetSpec ? (
        <Sheet
          open
          closing={sheetClosing}
          onOpenChange={sheetClosing ? () => undefined : onOpenChange}
          title={sheetSpec.title}
          description={sheetSpec.description}
          loading={sheetSpec.loading}
          boardHeader={sheetSpec.chrome === 'board'}
          onBack={sheetSpec.onBack}
          authorHeader={sheetSpec.chrome === 'author'}
          kind={sheetSpec.inChat ? 'chat' : 'video'}
        >
          {sheetSpec.content}
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
          onBack={current.onBack}
          authorHeader={current.chrome === 'author'}
        >
          {current.content}
        </ChatSlotPanel>
      ) : null}
      {seatSpec ? (
        <ChatSlotPanel
          open
          onOpenChange={seatSpec === current ? onOpenChange : () => undefined}
          containerId={SEAT_DOCK_SLOT_ID}
          variant={seatSpec.kind === 'accent' ? 'accent' : seatSpec.kind === 'nonmodal' ? 'nonmodal' : 'form'}
          title={seatSpec.title}
          description={seatSpec.description}
          boardHeader={seatSpec.chrome === 'board'}
          onBack={seatSpec.onBack}
          authorHeader={seatSpec.chrome === 'author'}
          className="t2f-seat-panel"
        >
          {seatSpec.content}
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
          onBack={current.onBack}
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
