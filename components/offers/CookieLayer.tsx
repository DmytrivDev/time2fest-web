'use client';

/**
 * Згода на cookies у макеті й на сторінках (B-COOKIES, FR-065).
 * - `CookieLayer` — в макеті одразу після `SkipLinks` (у DOM рано): `corner` (десктоп, лівий нижній кут) або `strip` (телефон);
 *   поки банер видимий, сторінка має нижній відступ на його висоту (нічого не закрито);
 * - `CookieInflow` — на сторінці з плеєром, під рядком дій, на місці штампа: смуга `inflow`, коли вільного кута немає
 *   (чат сховано, відео на всю ширину). Реєструється як хост, тож `CookieLayer` тоді мовчить;
 * - `CookieFooter` — футер із «Налаштування cookies» (відкриває вікно налаштувань будь-коли);
 * - «Налаштувати» відкриває `CookieSettings` через `OverlayManager` (Sheet / ChatSlotPanel).
 * Згода «Відео з Facebook» пишеться в `guest.consent.facebookVideo` — її ж читає картка плеєра `FacebookConsentCard`.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { CookieBanner, CookieSettings, type CookieChoices, type CookieVariant } from '@/components/windows/Cookies';
import { Footer } from '@/components/shell/Footer';
import { useChatColumn, useOverlay } from '@/components/shell/OverlayManager';
import {
  ACCEPT_ALL,
  applyConsent,
  NECESSARY_ONLY,
  registerInflowHost,
  retryConsent,
  useConsentSaveFailed,
  useHasInflowHost,
} from '@/lib/offers/cookieFlow';
import { useGuestStore } from '@/stores/guest';

export const COOKIES_WINDOW_ID = 'O-COOKIES';

const noopSubscribe = () => () => undefined;
/** `false` на сервері й під час гідратації: збережена згода читається лише на клієнті, тож розмітка збігається. */
function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** Орієнтовна висота кутової картки (`Desk-Cookies`) і смуги (`Phone-Cookies`), поки банер ще не виміряно. */
const CORNER_H = 216;
const STRIP_H = 120;
const EDGE = 16;

/**
 * Банер ніколи не лягає на відео: кут (смуга) зайнятий, якщо на першому екрані (прокрутка 0 — найгірший випадок,
 * далі відео лише піднімається) низ слоту плеєра глибше за верх банера. Телефон: закріплений плеєр угорі.
 */
function useFixedSpotBlocked(column: boolean): boolean {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const slot = document.querySelector<HTMLElement>('[data-player-slot="main"]');
      if (!slot) {
        setBlocked(false);
        return;
      }
      const r = slot.getBoundingClientRect();
      const banner = document.querySelector<HTMLElement>('[data-cookie-banner="corner"], [data-cookie-banner="strip"]');
      const h = banner?.getBoundingClientRect().height || (column ? CORNER_H : STRIP_H);
      const videoBottom = column ? r.top + window.scrollY + r.height : r.height;
      const bannerTop = window.innerHeight - (column ? EDGE : 0) - h;
      setBlocked(videoBottom > bannerTop);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener('resize', schedule, { passive: true });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    const slot = document.querySelector<HTMLElement>('[data-player-slot="main"]');
    if (slot) ro?.observe(slot);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
    };
  }, [column]);
  return blocked;
}

/**
 * Де показати банер (макети `Desk-Cookies`, `Desk-Cookies-Wide`, `Phone-Cookies`): телефон — смуга внизу; десктоп —
 * кутова картка ліворуч унизу, поки є чат праворуч; без вільного кута (чат сховано або картка лягла б на відео) —
 * смуга в потоці сторінки під рядком дій.
 */
export function useCookiePlacement(): CookieVariant {
  const column = useChatColumn();
  const chatHidden = useGuestStore((s) => s.chatHidden);
  const hasHost = useHasInflowHost();
  const blocked = useFixedSpotBlocked(column);
  if (hasHost && (blocked || (column && chatHidden))) return 'inflow';
  return column ? 'corner' : 'strip';
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

/** Відкрити «Налаштування cookies» (з банера й з футера). */
export function useCookieSettings(): () => void {
  const t = useTranslations('cookies');
  const { open } = useOverlay();
  const title = t('settingsTitle');
  return useCallback(
    () => open({ id: COOKIES_WINDOW_ID, kind: 'form', title, content: <SettingsWindow /> }),
    [open, title],
  );
}

/** Нижній відступ сторінки на висоту фіксованого банера, поки він видимий. */
function useReservedBottom(el: HTMLElement | null, active: boolean) {
  useEffect(() => {
    if (!active || !el) return;
    const prev = document.body.style.paddingBottom;
    const apply = () => {
      document.body.style.paddingBottom = `${el.getBoundingClientRect().height}px`;
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

function useBanner(variant: CookieVariant) {
  const hydrated = useHydrated();
  const answered = useGuestStore((s) => s.consent.answered);
  const failed = useConsentSaveFailed();
  const openSettings = useCookieSettings();
  const visible = hydrated && (!answered || failed);
  const [el, setEl] = useState<HTMLElement | null>(null);
  useReservedBottom(el, visible && variant !== 'inflow');
  return {
    visible,
    props: {
      ref: setEl,
      variant,
      saveFailed: failed,
      onAccept: () => applyConsent(ACCEPT_ALL),
      onNecessaryOnly: () => applyConsent(NECESSARY_ONLY),
      onCustomize: openSettings,
      onRetry: () => {
        retryConsent();
      },
    },
  };
}

/** В макеті, одразу після посилань-пропусків. */
export function CookieLayer() {
  const placement = useCookiePlacement();
  const banner = useBanner(placement);
  if (!banner.visible || placement === 'inflow') return null;
  return <CookieBanner {...banner.props} />;
}

/** На сторінці з плеєром, перед `OverlayInFlowOutlet`: смуга, коли вільного кута немає. */
export function CookieInflow() {
  useEffect(() => registerInflowHost(), []);
  const placement = useCookiePlacement();
  const banner = useBanner(placement);
  if (!banner.visible || placement !== 'inflow') return null;
  return <CookieBanner {...banner.props} className="mb-2" />;
}

/** Футер макета з робочим «Налаштування cookies». */
export function CookieFooter() {
  const openSettings = useCookieSettings();
  return <Footer onCookiesClick={openSettings} />;
}
