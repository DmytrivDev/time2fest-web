'use client';

/**
 * Вхід під час трансляції (дошки `Desk-Auth-Stream`, `Phone-Auth-Stream`): вікно O-AUTH типу `form` —
 * десктоп: панель на місці чату; телефон: усередині вікна чату під плеєром (як O-NICK). Трансляція грає далі.
 * Кроки — ті самі, що на сторінці (`AuthSteps variant="stream"`): лист, код, помилки — усередині вікна.
 * Вхід у наявний акаунт закриває вікно й оголошує «Ти увійшов»; новий акаунт — «Акаунт створено» у вікні.
 */
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { useChatColumn, useOverlay } from '@/components/shell/OverlayManager';
import type { AuthIntent } from '@/lib/auth/sim';
import type { SignInResult } from '@/stores/auth';
import { AuthSteps } from './AuthSteps';
import { useAuthFlow } from './useAuthFlow';

export const AUTH_WINDOW_ID = 'O-AUTH';

function AuthWindowContent({
  mode,
  initialEmail,
  onSwitch,
  onSignedIn,
  onExit,
}: {
  mode: AuthIntent;
  initialEmail?: string;
  onSwitch: (mode: AuthIntent, email: string) => void;
  onSignedIn: (r: SignInResult) => void;
  onExit: () => void;
}) {
  const flow = useAuthFlow({ mode, initialEmail, onSignedIn });
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

/** Відкрити вхід вікном (трансляція не зупиняється). */
export function useOpenAuthWindow(): (mode?: AuthIntent) => void {
  const t = useTranslations('auth');
  const overlay = useOverlay();
  const chatColumn = useChatColumn();
  const announce = useAnnounce();

  const open = useCallback(
    function openWindow(mode: AuthIntent = 'signin', email?: string) {
      const close = () => overlay.close(AUTH_WINDOW_ID);
      overlay.open({
        id: AUTH_WINDOW_ID,
        inChat: true,
        kind: 'form',
        chrome: 'board',
        coral: true,
        title: mode === 'signup' ? t('signup.title') : t('signin.title'),
        description: chatColumn ? t('stream.descDesk') : t('stream.descPhone'),
        content: (
          <AuthWindowContent
            key={mode}
            mode={mode}
            initialEmail={email}
            onSwitch={(next, value) => openWindow(next, value)}
            onSignedIn={(r) => {
              close();
              announce(t('signedIn', { email: r.email }));
            }}
            onExit={close}
          />
        ),
      });
    },
    [overlay, chatColumn, announce, t],
  );

  return useCallback((mode?: AuthIntent) => open(mode), [open]);
}
