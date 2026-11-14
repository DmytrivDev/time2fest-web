'use client';

/**
 * Вікно «Сказати тост» — головний платний продукт (дошки `Desk-Toast-New` · «3 · Вікно тосту», `Phone-Toast-New` ·
 * «3 · Вікно тосту (шторка)», «4 · Оплата й результат», v2; рішення власника 2026-11-12; замінює вікно «Чайові»).
 * Десктоп — вікно 340 px на місці чату (не модальне), телефон — шторка до низу відео; вміст прокручується, кнопки
 * дій закріплені внизу. Стани — `stores/toast`:
 * - крок 1: «Обери тост» — $2 келих · $5 пляшка ігристого (за замовчуванням) · $10 феєрверк (без позначки «найвигідніше» — рішення
 *   власника 2026-11-13: незрозуміло, чим саме); під плитками — що дає рівень (галочки; решта сіра з «з $N»; з пасом — «Новорічний пас у тебе вже є»);
 *   «Твій тост» — поле як повідомлення в чаті (нік, прапор, «тост», лічильник до 120, емодзі), ідеї-чипси, правило;
 *   підпис (нік і прапор, «Змінити»); гість без ніку — «Як підписати тост?» тут же, «Оплатити» неактивна до дійсного
 *   ніку (тост ніколи не підписують «Гість»); примітка про оплату; внизу «Оплатити $N · Скасувати»;
 * - фільтр на «Оплатити» (`lib/toast/filter`): «Тост не пройшов перевірку — зміни текст», проблемне місце підкреслено,
 *   оплата неактивна, доки текст не змінено;
 * - «Чекаємо оплату на PayPro Global» (тост уже не змінити) · «Відкрити оплату · Скасувати»;
 * - «Оплата не пройшла» · «Спробувати ще — $N · Скасувати»; «Немає з’єднання»;
 * - «Тост опубліковано» за рівнем; $10 — «Пас активний» (увійшов) або «Новорічний пас — подарунок до тосту» з
 *   «Увійти й активувати пас» (гість: пас належить акаунту, рішення 2026-11-10).
 * Відкрити — `useOpenToastWindow()` (смуга тостів, келих у чаті, «Сказати тост» у шапці, «Скажи тост за $10» у пасі) —
 * лише поки свято йде (рішення власника 2026-11-13).
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef } from 'react';
import { Icon } from '@/components/primitives/Icon';
import { useChatColumn, useOverlay } from '@/components/shell/OverlayManager';
import { getData } from '@/lib/data/load';
import { canSayToast } from '@/lib/toast/season';
import { useTimeSource } from '@/lib/time/TimeProvider';
import { type ToastTier } from '@/lib/toast/tiers';
import { useToastStore } from '@/stores/toast';
import { Compose } from './ToastCompose';
import { Done } from './ToastDone';
import { Failed, Paying } from './ToastPayment';
import s from './toastWindow.module.css';

export const TOAST_WINDOW_ID = 'O-TOAST';

export function ToastWindowContent({ onClose }: { onClose: () => void }) {
  const phase = useToastStore((x) => x.phase);
  // Шторка (телефон, планшет-портрет): плитки 92 px, успіх $10 — компактний (дошка `Phone-Toast-New`).
  const phone = !useChatColumn();
  const ref = useRef<HTMLDivElement>(null);
  // Новий крок — вміст з початку, а не з місця, до якого прокрутили попередній.
  useEffect(() => {
    for (let el = ref.current?.parentElement; el; el = el.parentElement) {
      if (el.scrollTop > 0) el.scrollTop = 0;
      if (el.hasAttribute('data-chat-slot-panel')) break;
    }
  }, [phase]);
  return (
    <div ref={ref} data-window={TOAST_WINDOW_ID} data-phase={phase} className="flex min-h-full flex-col">
      {phase === 'paying' ? (
        <Paying onCancel={() => useToastStore.getState().toForm()} />
      ) : phase === 'failed' || phase === 'offline' ? (
        <Failed onCancel={onClose} offline={phase === 'offline'} />
      ) : phase === 'success' ? (
        <Done onClose={onClose} phone={phone} />
      ) : (
        <Compose onCancel={onClose} phone={phone} />
      )}
    </div>
  );
}

/** Відкрити вікно тосту з цим рівнем ($10 — з «Скажи тост за $10»), без — $5 за замовчуванням. */
export type OpenToastWindow = (opts?: { tier?: ToastTier }) => void;

/**
 * Відкрити «Сказати тост» — одна дія для всіх входів: смуга тостів, келих у полі чату, «Сказати тост» у шапці й на
 * «Тостах світу» (`/support/`), «Скажи тост за $10» у пасі, картка штампа. Оплата вже йде — вікно покаже її, а не почне нову.
 * Лише поки свято йде (`canSayToast`, рішення власника 2026-11-13): до й після свята — нічого не робить, щоб застаріле
 * посилання (`/support/?toast=10`) чи кнопка, що не встигла зникнути, не відкрили оплату. Час — у мить дотику.
 */
export function useOpenToastWindow(): OpenToastWindow {
  const overlay = useOverlay();
  const time = useTimeSource();
  const t = useTranslations('toast');
  const defaultText = t('phrases.one');
  return useCallback(
    (opts) => {
      if (!canSayToast(time.now(), getData())) return;
      useToastStore.getState().prepare(opts?.tier, defaultText);
      const close = () => overlay.close(TOAST_WINDOW_ID);
      overlay.open({
        id: TOAST_WINDOW_ID,
        kind: 'form',
        chrome: 'board',
        coral: true,
        title: (
          <span className={s.windowTitle}>
            <Icon name="glass" size={20} />
            {t('title')}
          </span>
        ),
        onClose: () => useToastStore.getState().closed(),
        content: <ToastWindowContent onClose={close} />,
      });
    },
    [overlay, time, t, defaultText],
  );
}