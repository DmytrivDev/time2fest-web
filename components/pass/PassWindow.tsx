'use client';

/**
 * O-PASS-BUY — оформлення пасу під час трансляції (дошки `O-PASS-BUY · Під час трансляції: …`, v100):
 * десктоп — панель на місці чату, телефон — вікно під плеєром (як вхід O-AUTH); трансляція грає далі.
 * Угорі — ціна й можливості пасу з «Усе про пас», «Скажи тост за $10 · …і Новорічний пас у подарунок» (дошка
 * `Pass-5-New`, 2026-11-12 — вікно тосту з $10), нижче — те саме оформлення, що на сторінці (`PassBuy variant="stream"`).
 * «Дивитися далі» закриває вікно: права колонка стає такою, як була (чат чи нічого).
 *
 * `useGetPass` — одна дія для «Пас» у хедері, «Новорічний пас» у меню й усіх «Оформити пас» на сайті
 * (рішення власника 2026-10-30): трансляція грає — це вікно; інакше — сторінка `/pass/`.
 */
import { useTranslations } from 'next-intl';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { useCallback, useContext, useLayoutEffect, useRef, type MouseEvent } from 'react';
import { useOpenAuthWindow } from '@/components/auth/AuthWindow';
import { AuthIcon } from '@/components/auth/icons';
import { useOverlay } from '@/components/shell/OverlayManager';
import { ToastGift } from '@/components/toast/ToastGift';
import { useOptionalPlayer } from '@/lib/player/PlayerProvider';
import { currentSession } from '@/lib/api/hooks/auth';
import { usePassStore } from '@/stores/pass';
import { PassBuy, usePassView } from './PassBuy';
import { PassPerksCompact } from './PassPerks';
import s from './pass.module.css';

export const PASS_WINDOW_ID = 'O-PASS-BUY';
export const PASS_HREF = '/pass/';

function PassWindowContent({ onClose, onSignIn }: { onClose: () => void; onSignIn: () => void }) {
  const view = usePassView();
  const ref = useRef<HTMLDivElement>(null);
  const openAuthWindow = useOpenAuthWindow();
  const result = view === 'pending' || view === 'failed' || view === 'success' || view === 'active';
  // Вікно відкрилося на місці іншого (напр. «Оформити пас» у вході) чи оплата дала результат — вміст з початку,
  // а не з місця, до якого прокрутили попереднє вікно (правка власника 2026-10-30).
  useLayoutEffect(() => {
    for (let el = ref.current?.parentElement; el; el = el.parentElement) {
      if (el.scrollTop > 0) el.scrollTop = 0;
      if (el.hasAttribute('data-chat-slot-panel')) break;
    }
  }, [result]);
  const form = view === 'guest' || view === 'signed' || view === 'opening';
  return (
    <div ref={ref} data-window={PASS_WINDOW_ID} data-view={view} className={s.window}>
      {form ? <PassPerksCompact /> : null}
      {/* Інший шлях до пасу — тост за $10 (дошка `Pass-5-New`, 2026-11-12). */}
      {form ? <ToastGift variant="window" className={s.toastGift} /> : null}
      <PassBuy
        variant="stream"
        onSignIn={onSignIn}
        onCodeSent={() => {
          const code = currentSession()?.code;
          openAuthWindow('signin', { step: { kind: 'code' }, email: code?.email });
        }}
        onDone={onClose}
      />
    </div>
  );
}

/** Відкрити оформлення пасу вікном (трансляція не зупиняється). */
export function useOpenPassWindow(): () => void {
  const t = useTranslations('pass.window');
  const overlay = useOverlay();
  const openAuthWindow = useOpenAuthWindow();
  const open = useCallback(
    function openWindow() {
      const close = () => overlay.close(PASS_WINDOW_ID);
      overlay.open({
        id: PASS_WINDOW_ID,
        kind: 'form',
        chrome: 'board',
        coral: true,
        title: (
          <span className={s.windowTitle}>
            <AuthIcon name="ticket" size={20} />
            {t('title')}
          </span>
        ),
        // Закрили після оплати — наступне відкриття почнеться з «Пас уже є», а не з успіху.
        onClose: () => {
          if (usePassStore.getState().phase === 'success') usePassStore.getState().reset();
        },
        content: <PassWindowContent onClose={close} onSignIn={() => openAuthWindow('signin', { afterSignIn: openWindow })} />,
      });
    },
    [overlay, openAuthWindow, t],
  );
  return open;
}

/**
 * «Оформити пас» звідусіль — вікно оформлення на місці чату (телефон — шторка), навіть коли трансляції зараз немає
 * (рішення власника 2026-11-01). Посилання (`href="/pass/"`, передай подію) без трансляції — звичайний перехід на сторінку.
 */
export function useGetPass(): (e?: MouseEvent) => void {
  const player = useOptionalPlayer();
  const openWindow = useOpenPassWindow();
  const playing = player?.status === 'playing';
  return useCallback(
    (e?: MouseEvent) => {
      if (e && !playing) return;
      e?.preventDefault();
      openWindow();
    },
    [playing, openWindow],
  );
}

/**
 * «Детальніше» / «Що в пасі»: трансляція грає — те саме вікно пасу на місці чату; інакше — сторінка «Новорічний пас».
 * Картки «Що дає Новорічний пас» на самій сторінці більше немає (рішення власника 2026-11-01).
 */
export function usePassDetails(): () => void {
  const player = useOptionalPlayer();
  const openWindow = useOpenPassWindow();
  // Роутер Next (поза ним — вікна в історіях і тестах — звичайний перехід).
  const router = useContext(AppRouterContext);
  const playing = player?.status === 'playing';
  return useCallback(() => {
    if (playing) return openWindow();
    if (router) router.push(PASS_HREF);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- поза роутером Next
    else window.location.assign(PASS_HREF);
  }, [playing, openWindow, router]);
}
