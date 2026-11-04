'use client';

/**
 * Вхід під час трансляції (дошки `Desk-Auth-Stream`, `Phone-Auth-Stream`): вікно O-AUTH типу `form` без підзаголовка
 * (правка власника 2026-10-29: що трансляція грає далі — й так видно) —
 * десктоп: панель на місці чату; телефон: усередині вікна чату під плеєром (як O-NICK). Трансляція грає далі.
 * Кроки — ті самі, що на сторінці (`AuthSteps variant="stream"`): лист, код, помилки — усередині вікна.
 * Вхід у наявний акаунт закриває вікно й оголошує «Ти увійшов»; новий акаунт — «Акаунт створено» у вікні.
 */
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { useOverlay } from '@/components/shell/OverlayManager';
import type { AuthIntent } from '@/lib/auth/sim';
import type { SignInResult } from '@/stores/auth';
import { AuthSteps } from './AuthSteps';
import { useAuthFlow, type AuthStep } from './useAuthFlow';

export const AUTH_WINDOW_ID = 'O-AUTH';

function AuthWindowContent({
  mode,
  initialEmail,
  initialStep,
  onSwitch,
  onSignedIn,
  onExit,
}: {
  mode: AuthIntent;
  initialEmail?: string;
  initialStep?: AuthStep;
  onSwitch: (mode: AuthIntent, email: string) => void;
  onSignedIn: (r: SignInResult) => void;
  onExit: () => void;
}) {
  const flow = useAuthFlow({ mode, initialEmail, initialStep, onSignedIn });
  return (
    <div data-window={AUTH_WINDOW_ID}>
      <AuthSteps
        flow={flow}
        variant="stream"
        onSwitchMode={() => onSwitch(mode === 'signin' ? 'signup' : 'signin', flow.email)}
        onExit={onExit}
      />
    </div>
  );
}

export interface AuthWindowOptions {
  /** Почати з кроку (напр. «Лист надіслано» — лист уже надіслано з вікна пасу). */
  step?: AuthStep;
  email?: string;
  /** Після входу в наявний акаунт (вікно закрито) — напр. повернутися до вікна пасу. */
  afterSignIn?: () => void;
}

/** Відкрити вхід вікном (трансляція не зупиняється). */
export function useOpenAuthWindow(): (mode?: AuthIntent, opts?: AuthWindowOptions) => void {
  const t = useTranslations('auth');
  const overlay = useOverlay();
  const announce = useAnnounce();

  const open = useCallback(
    function openWindow(mode: AuthIntent = 'signin', email?: string, opts: AuthWindowOptions = {}) {
      const close = () => overlay.close(AUTH_WINDOW_ID);
      overlay.open({
        id: AUTH_WINDOW_ID,
        kind: 'form',
        chrome: 'board',
        coral: true,
        title: mode === 'signup' ? t('signup.title') : t('signin.title'),
        content: (
          <AuthWindowContent
            key={mode}
            mode={mode}
            initialEmail={email}
            initialStep={opts.step}
            onSwitch={(next, value) => openWindow(next, value, { afterSignIn: opts.afterSignIn })}
            onSignedIn={(r) => {
              close();
              announce(t('signedIn', { email: r.email }));
              opts.afterSignIn?.();
            }}
            onExit={close}
          />
        ),
      });
    },
    [overlay, announce, t],
  );

  return useCallback((mode?: AuthIntent, opts?: AuthWindowOptions) => open(mode, opts?.email, opts), [open]);
}
