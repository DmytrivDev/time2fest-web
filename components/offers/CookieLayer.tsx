'use client';

/**
 * Згода на cookies у макеті (B-COOKIES, FR-065; рішення 2026-11-02, дошки `Desk-Cookies-Bar`, `Desk-Cookies-Design`).
 * - `CookieLayer` — у макеті одразу після `SkipLinks` (у DOM рано): плашка внизу екрана, `position: fixed`.
 *   Десктоп — `bar` завширшки з колонку відео (чат праворуч не закриває); телефон вертикально — `card` над «Розгорнути
 *   чат»; телефон горизонтально — `bar` компактний на всю ширину;
 * - плашка ніколи не лягає на відео (правило YouTube): коли між низом відео й низом екрана для неї немає місця, вона
 *   виїжджає вниз і повертається, щойно відео прокрутили вище;
 * - × — те саме, що «Лише необхідні»; «Налаштувати» — плашка зникає, `CookieSettings` відкривається через
 *   `OverlayManager` (на місці чату / шторкою); закрили без вибору — плашка повертається;
 * - `CookieFooter` — футер із «Налаштування cookies» (відкриває вікно налаштувань будь-коли).
 * Згода «Відео з Facebook» пишеться в `guest.consent.facebookVideo` — її ж читає картка плеєра `FacebookConsentCard`.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { CookieBanner, CookieSettings, type CookieChoices, type CookieVariant } from '@/components/windows/Cookies';
import { Footer } from '@/components/shell/Footer';
import { useChatColumn, useOverlay } from '@/components/shell/OverlayManager';
import { ACCEPT_ALL, applyConsent, dismissSaveFailed, NECESSARY_ONLY, retryConsent, useConsentSaveFailed } from '@/lib/offers/cookieFlow';
import { useGuestStore } from '@/stores/guest';

export const COOKIES_WINDOW_ID = 'O-COOKIES';

const noopSubscribe = () => () => undefined;
/** `false` на сервері й під час гідратації: збережена згода читається лише на клієнті, тож розмітка збігається. */
function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

const LANDSCAPE = '(orientation: landscape)';
function subscribeLandscape(cb: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
  const mq = window.matchMedia(LANDSCAPE);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
function useLandscape(): boolean {
  return useSyncExternalStore(subscribeLandscape, () => !!window.matchMedia?.(LANDSCAPE).matches, () => false);
}

/** Відступ плашки від низу екрана на десктопі (дошка: 16 px). */
const EDGE = 16;
/** Запас між низом відео й верхом плашки. */
const GAP = 8;

/** Видимий прямокутник відео (хост плеєра) або `null`, коли відео немає чи воно сховане. */
function videoRect(): DOMRect | null {
  // Кімната перегляду: «відео» — уся сітка вікон (плашка не лягає на жодне вікно й має ширину сітки).
  const grid = document.querySelector<HTMLElement>('[data-video-column]');
  if (grid) {
    const g = grid.getBoundingClientRect();
    if (g.width > 0 && g.height > 0) return g;
  }
  const host = document.querySelector<HTMLElement>('[data-player-host]');
  if (!host || getComputedStyle(host).visibility === 'hidden') return null;
  const r = host.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}

/** Колонка під плашку на десктопі: ширина відео, а без відео — вміст `<main>` без бічних відступів. */
function columnBox(): { left: number; width: number } | null {
  const v = videoRect();
  if (v) return { left: Math.round(v.left), width: Math.round(v.width) };
  const main = document.getElementById('main');
  if (!main) return null;
  const r = main.getBoundingClientRect();
  const cs = getComputedStyle(main);
  const pl = parseFloat(cs.paddingLeft) || 0;
  const pr = parseFloat(cs.paddingRight) || 0;
  return { left: Math.round(r.left + pl), width: Math.round(r.width - pl - pr) };
}

/**
 * Де стоїть плашка і чи вона схована, бо лягла б на відео. Перевірка — на прокрутку, зміну розмірів і зміну самої
 * плашки; позиція «вдома» рахується без зсуву анімації (`bottom` і висота з розмітки).
 */
export function useBarGeometry(el: HTMLElement | null, column: boolean, active: boolean) {
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  const [overVideo, setOverVideo] = useState(false);
  useEffect(() => {
    if (!active || !el) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      if (column) {
        const next = columnBox();
        setBox((prev) => (prev && next && prev.left === next.left && prev.width === next.width ? prev : next));
      }
      const v = videoRect();
      if (!v) {
        setOverVideo(false);
        return;
      }
      const r = el.getBoundingClientRect();
      const top = window.innerHeight - (parseFloat(getComputedStyle(el).bottom) || 0) - el.offsetHeight;
      const across = v.left < r.right && v.right > r.left;
      setOverVideo(across && v.bottom > top - GAP && v.top < window.innerHeight);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    ro?.observe(el);
    const host = document.querySelector<HTMLElement>('[data-player-host]');
    if (host) ro?.observe(host);
    const main = document.getElementById('main');
    if (main) ro?.observe(main);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
    };
  }, [el, column, active]);
  return { box, overVideo };
}

function SettingsWindow() {
  const consent = useGuestStore((s) => s.consent);
  const failed = useConsentSaveFailed();
  const { close } = useOverlay();
  return (
    <CookieSettings
      value={{ analytics: consent.analytics, marketing: consent.marketing, facebookVideo: consent.facebookVideo }}
      saveFailed={failed}
      onRetry={() => {
        if (retryConsent()) close(COOKIES_WINDOW_ID);
      }}
      onSave={(choices: CookieChoices) => {
        if (applyConsent(choices)) close(COOKIES_WINDOW_ID);
      }}
    />
  );
}

/** Відкрити «Налаштування cookies» (з плашки й з футера). */
export function useCookieSettings(): () => void {
  const t = useTranslations('cookies');
  const { open } = useOverlay();
  const title = t('settingsTitle');
  return useCallback(
    // Як вікна пасу й чайових: на місці чату, на телефоні — той самий шар без затемнення і тієї ж висоти.
    () => open({ id: COOKIES_WINDOW_ID, kind: 'form', title, content: <SettingsWindow /> }),
    [open, title],
  );
}

/** Нижній відступ сторінки на висоту плашки, поки вона є: низ сторінки (футер) не ховається під нею. */
function useReservedBottom(el: HTMLElement | null, active: boolean) {
  useEffect(() => {
    if (!active || !el) return;
    const prev = document.body.style.paddingBottom;
    const apply = () => {
      const bottom = parseFloat(getComputedStyle(el).bottom) || 0;
      document.body.style.paddingBottom = `${Math.ceil(el.offsetHeight + bottom + EDGE)}px`;
    };
    apply();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(apply);
      ro.observe(el);
    }
    return () => {
      ro?.disconnect();
      document.body.style.paddingBottom = prev;
    };
  }, [el, active]);
}

/** В макеті, одразу після посилань-пропусків. */
export function CookieLayer() {
  const hydrated = useHydrated();
  const answered = useGuestStore((s) => s.consent.answered);
  const failed = useConsentSaveFailed();
  const openSettings = useCookieSettings();
  const { current } = useOverlay();
  const column = useChatColumn();
  const landscape = useLandscape();
  const [el, setEl] = useState<HTMLElement | null>(null);

  // «Налаштувати»: поки вікно налаштувань відкрите, плашки немає.
  const settingsOpen = current?.id === COOKIES_WINDOW_ID;
  const visible = hydrated && (!answered || failed) && !settingsOpen;
  const variant: CookieVariant = column || landscape ? 'bar' : 'card';
  const { box, overVideo } = useBarGeometry(el, column, visible);
  useReservedBottom(el, visible);
  if (!visible) return null;

  const style: CSSProperties | undefined =
    column && box ? { left: box.left, width: box.width, bottom: EDGE } : undefined;
  return (
    <CookieBanner
      ref={setEl}
      variant={variant}
      compact={!column && landscape}
      hidden={overVideo || (column && !box)}
      saveFailed={failed}
      style={style}
      className={column ? undefined : 't2f-cookie-phone'}
      onAccept={() => applyConsent(ACCEPT_ALL)}
      onNecessaryOnly={() => applyConsent(NECESSARY_ONLY)}
      onClose={() => (failed ? dismissSaveFailed() : applyConsent(NECESSARY_ONLY))}
      onCustomize={openSettings}
      onRetry={() => {
        retryConsent();
      }}
    />
  );
}

/** Футер макета з робочим «Налаштування cookies». */
export function CookieFooter() {
  const openSettings = useCookieSettings();
  return <Footer onCookiesClick={openSettings} />;
}
