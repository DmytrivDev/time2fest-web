'use client';

/**
 * O-FIRST-ROW / O-PAY — зв’язувальний вміст вікна «Першого ряду» (T115/T116).
 * Відкривається через `OverlayManager` (`accent`: десктоп — ChatSlotPanel на місці чату з жовтою межею, телефон — Sheet);
 * вікно має власну коралову кнопку, тож кнопка звуку нейтральна. Показує форму чи результат за `stores/firstRow.flow`.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import {
  FIRST_ROW_WINDOW_ID,
  settlePayment,
  snapshot,
  type FirstRowEvent,
} from '@/components/firstrow/controller';
import type { FirstRowDraftValues, FirstRowFormProps } from '@/components/firstrow/types';
import { useOverlay } from '@/components/shell/OverlayManager';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { HOLD_EXTEND_OFFER, HOLD_SEC } from '@/lib/engine/config';
import { emojiWaitSec, extendHold, PAY_ROUNDTRIP_MS, validateForm, type FormErrors } from '@/lib/firstrow/pay';
import { ticketCode } from '@/lib/firstrow/seatsSim';
import { useOptionalPlayerActions } from '@/lib/player/PlayerProvider';
import { useNow, useTimeSource } from '@/lib/time/TimeProvider';
import { useChatUi } from '@/stores/chat';
import { readEntry, useBoughtPass, useFirstRowStore, writeEntry } from '@/stores/firstRow';
import { useGuestStore } from '@/stores/guest';
import { FirstRowForm } from './FirstRowForm';
import { FirstRowEdit, FirstRowPending, FirstRowSoldOut, FirstRowSuccess } from './FirstRowResult';

export interface FirstRowWindowProps {
  event: FirstRowEvent;
  city: string;
}

const DEFAULT_EMOJI = 'glasses';
const COUNTRIES_HREF = '/countries';

export function FirstRowWindow({ event, city }: FirstRowWindowProps) {
  const t = useTranslations('firstRow');
  const now = useNow();
  const source = useTimeSource();
  const reduced = useReducedMotion();
  const overlay = useOverlay();
  const player = useOptionalPlayerActions();
  const flow = useFirstRowStore((s) => (s.flow?.eventId === event.id ? s.flow : null));
  const email = useFirstRowStore((s) => s.email);
  const setEmail = useFirstRowStore((s) => s.setEmail);
  const patchFlow = useFirstRowStore((s) => s.patchFlow);
  const entry = useGuestStore((s) => s.firstRow[event.id]) ?? {};
  const nick = useGuestStore((s) => s.nick);
  const flagCode = useGuestStore((s) => s.flagCode ?? s.detectedFlag ?? 'UN');
  const updateFirstRow = useGuestStore((s) => s.updateFirstRow);
  const boughtPass = useBoughtPass();
  const hasPass = useGuestStore((s) => s.hasPass);
  const emotionChangedAt = useChatUi((s) => s.emotionChangedAt);
  const markEmotionChanged = useChatUi((s) => s.markEmotionChanged);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const { view } = snapshot(event, now, { reducedMotion: reduced });
  const phase = flow?.phase ?? (entry.seat !== undefined ? 'success' : 'form');
  const draft = entry.draft;
  const values: FirstRowDraftValues = {
    email,
    name: draft?.name ?? nick ?? '',
    greeting: draft?.greeting ?? '',
    emojiId: draft?.emojiId ?? DEFAULT_EMOJI,
  };
  const close = () => overlay.close(FIRST_ROW_WINDOW_ID);

  const setDraft = (patch: Partial<FirstRowDraftValues>) => {
    if (patch.email !== undefined) setEmail(patch.email);
    const rest = { ...patch };
    delete rest.email;
    if (Object.keys(rest).length === 0) return;
    updateFirstRow(event.id, (prev) => ({
      ...prev,
      draft: { name: prev.draft?.name ?? values.name, greeting: prev.draft?.greeting ?? values.greeting, emojiId: prev.draft?.emojiId ?? values.emojiId, ...rest },
    }));
  };

  if (phase === 'success' && entry.seat !== undefined) {
    return (
      <FirstRowSuccess
        city={city}
        cityId={event.cityId}
        midnightMs={event.midnightMs}
        seat={entry.seat}
        name={values.name}
        flagCode={flagCode}
        emojiId={values.emojiId}
        greeting={values.greeting}
        email={email}
        pass={boughtPass ? 'discount' : 'gifted'}
        ticketCode={ticketCode(event.cityId, entry.seat)}
        onEdit={() => patchFlow({ phase: 'edit' })}
        onShare={() => {
          // Системне меню «Поділитися»; без нього — копіюємо посилання.
          const url = window.location.origin + '/';
          const text = t('success.shareText', { city });
          if (typeof navigator.share === 'function') {
            navigator.share({ title: t('heading', { city }), text, url }).catch(() => undefined);
          } else {
            navigator.clipboard?.writeText(`${text} ${url}`).catch(() => undefined);
          }
        }}
      />
    );
  }

  if (phase === 'edit' && entry.seat !== undefined) {
    return (
      <EditBody
        city={city}
        flagCode={flagCode}
        seat={entry.seat}
        initial={values}
        waitSec={emojiWaitSec(emotionChangedAt, now)}
        onCancel={() => patchFlow({ phase: 'success' })}
        onSave={(next) => {
          if (next.emojiId !== values.emojiId) {
            if (emojiWaitSec(emotionChangedAt, now) > 0) return false;
            markEmotionChanged(now);
          }
          setDraft(next);
          patchFlow({ phase: 'success' });
          return true;
        }}
      />
    );
  }

  if (phase === 'soldout') return <FirstRowSoldOut city={city} onBack={close} otherHref={COUNTRIES_HREF} />;

  const hold = entry.seat === undefined ? entry.hold : undefined;
  const holdUntil = hold?.until ?? now;

  if (phase === 'pending') {
    return (
      <FirstRowPending
        city={city}
        midnightMs={event.midnightMs}
        freeCount={view.freeCount}
        total={view.total}
        flagCode={flagCode}
        preview={{ name: values.name, emojiId: values.emojiId }}
        holdUntil={holdUntil}
        email={email}
        onClose={close}
      />
    );
  }

  // Форма: `form`, `declined`, `expired`.
  const remainingMs = Math.max(0, holdUntil - now);
  const base = view.priceChanged?.to ?? entry.priceLocked ?? view.price.current ?? view.price.full;
  const payPrice = boughtPass ? Math.floor(base * 50) / 100 : base;
  const totalMin = (HOLD_SEC + (hold?.extended ? 300 : 0)) / 60;
  const lastMinutes = remainingMs <= HOLD_EXTEND_OFFER;
  const announce = view.hold?.warn1 ? t('form.holdWarn1') : view.hold?.warn5 ? t('form.holdWarn5') : null;
  const notice: FirstRowFormProps['notice'] =
    phase === 'declined'
      ? { kind: 'declined' }
      : phase === 'expired' && flow?.expired
        ? { kind: 'expired', free: flow.expired.free, price: flow.expired.price, holdUntil: flow.expired.until, priceChanged: flow.expired.priceChanged }
        : undefined;

  const onPay = () => {
    if (flow?.submitting) return;
    const errors: FormErrors = validateForm(values);
    if (Object.keys(errors).length) {
      patchFlow({ errors });
      return;
    }
    // Людина підтверджує нову ціну натисканням «Оплатити $7,99».
    if (view.priceChanged) writeEntry(event.id, { ...readEntry(event.id), priceLocked: view.priceChanged.to });
    patchFlow({ errors: {}, submitting: true });
    // Перед переходом на PayPro плеєр стає на паузу (O-PAY).
    player?.pause();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      settlePayment(event, source.now());
    }, PAY_ROUNDTRIP_MS);
  };

  return (
    <FirstRowForm
      city={city}
      flagCode={flagCode}
      midnightMs={event.midnightMs}
      freeCount={view.freeCount}
      total={view.total}
      view={view}
      payPrice={payPrice}
      holdUntil={holdUntil}
      holdBoard={flow?.returned || lastMinutes ? { remainingMs, totalMin } : undefined}
      holdWarning={view.hold && lastMinutes ? { canExtend: view.hold.canExtend } : undefined}
      extendedUntil={hold?.extended ? hold.until : undefined}
      onExtend={() => writeEntry(event.id, extendHold(readEntry(event.id), now))}
      announce={announce}
      notice={notice}
      values={values}
      onChange={(patch) => {
        setDraft(patch);
        if (flow && Object.keys(flow.errors).length) {
          const next = { ...flow.errors };
          if (patch.email !== undefined) delete next.email;
          if (patch.name !== undefined) delete next.name;
          if (patch.greeting !== undefined) delete next.greeting;
          patchFlow({ errors: next });
        }
      }}
      errors={flow?.errors}
      onPay={onPay}
      submitting={flow?.submitting ?? false}
      giftPass={!hasPass}
      onLoginForPass={boughtPass ? undefined : () => undefined}
    />
  );
}

function EditBody({
  city,
  flagCode,
  seat,
  initial,
  waitSec,
  onSave,
  onCancel,
}: {
  city: string;
  flagCode: string;
  seat: number;
  initial: FirstRowDraftValues;
  waitSec: number;
  onSave(next: { name: string; greeting: string; emojiId: string }): boolean;
  onCancel(): void;
}) {
  const [values, setValues] = useState({ name: initial.name, greeting: initial.greeting, emojiId: initial.emojiId });
  const [errors, setErrors] = useState<Pick<FormErrors, 'name' | 'greeting'>>({});
  return (
    <FirstRowEdit
      city={city}
      flagCode={flagCode}
      seat={seat}
      values={values}
      onChange={(patch) => {
        if (patch.emojiId !== undefined && waitSec > 0) return;
        setValues((v) => ({ ...v, ...patch }));
      }}
      emojiWaitSec={waitSec}
      errors={errors}
      onSave={() => {
        const e = validateForm({ email: 'x@x.xx', name: values.name, greeting: values.greeting });
        const next: Pick<FormErrors, 'name' | 'greeting'> = {};
        if (e.name) next.name = e.name;
        if (e.greeting) next.greeting = e.greeting;
        setErrors(next);
        if (next.name || next.greeting) return;
        onSave(values);
      }}
      onCancel={onCancel}
    />
  );
}
