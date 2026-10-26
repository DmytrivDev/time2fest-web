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

/** Де показати банер: телефон — смуга; десктоп — кут, а без вільного кута (чат сховано) — смуга в потоці сторінки. */
export function useCookiePlacement(): CookieVariant {
  const column = useChatColumn();
  const chatHidden = useGuestStore((s) => s.chatHidden);
  const hasHost = useHasInflowHost();
  if (!column) return 'strip';
  return chatHidden && hasHost ? 'inflow' : 'corner';
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
