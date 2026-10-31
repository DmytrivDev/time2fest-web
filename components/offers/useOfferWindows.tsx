'use client';

/**
 * Пропозиції й підказки пасу на поверхні з плеєром (T120, FR-063/064, `contracts/ui-events.md` `offer:show`).
 * Сторінка з `OverlayInFlowOutlet` викликає `useOfferWindows()` один раз (поруч із `useMomentWindows`):
 * - слухає `offer:show` від `EngineScheduler` (правила часу, «після оцінки», «одна за раз» — у `offerEligibility`)
 *   і відкриває картку `pass-offer` / `tips` у `InFlowSlot` (`inflow`), записуючи `OfferEntry` у `guest.offers`;
 * - повідомляє рушію про стан інтерфейсу: чи відкрите вікно (рядок «Штамп у паспорті» не рахується) і чи людина
 *   вводить текст (фокус у полі або ~10 с після останнього натискання) — див. `lib/offers/uiState`;
 * - віддає `requestSchedule` (кнопка графіка: з пасом — перемикає, без пасу — вікно «Графік — у Новорічному пасі» на місці
 *   чату, рішення 2026-10-31), `openPassGate`, `openPassInfo`.
 * Поява анонсується ввічливо самим `InFlowSlot` (`aria-live="polite"`); фокус сторінка не переносить.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { STAMP_WINDOW_ID } from '@/components/live/useMomentWindows';
import { useOverlay } from '@/components/shell/OverlayManager';
import { GATE_KEYS, type PassGateFeature } from '@/components/windows/PassGate';
import { on } from '@/lib/events/bus';
import { installTypingTracking, setOverlayOpen } from '@/lib/offers/uiState';
import { useClock } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import { OFFER_WINDOW_ID, passGateSpec, passInfoBoardSpec, passInfoSpec, passOfferSpec, scheduleGateSpec, tipsSpec, type OfferSpecDeps } from './OfferWindows';
import { getData } from '@/lib/data/load';
import { formatClock } from '@/lib/i18n/time';

export interface PassWindowsApi {
  /** Кнопка графіка події: з пасом — додати/прибрати, без пасу — «Потрібен пас». */
  requestSchedule(eventId: string, next?: boolean): void;
  openPassGate(feature: PassGateFeature, triggerEventId?: string): void;
  /** «Мій графік» без пасу — вікно «Графік — у Новорічному пасі» без конкретного міста. */
  openScheduleGate(): void;
  /** «Що дає Новорічний пас» на місці чату / шторкою (смужка «Мій графік» без пасу). */
  openPassInfoBoard(): void;
  openPassInfo(): void;
}

export function useOfferWindows(): PassWindowsApi {
  const overlay = useOverlay();
  const { open, current } = overlay;
  const clock = useClock();
  const t = useTranslations('offers');
  const tPass = useTranslations('pass');
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  });

  const deps = useMemo<OfferSpecDeps>(() => ({ now: () => clock.getSnapshot() }), [clock]);

  // Стан інтерфейсу для рушія.
  const overlayBusy = current !== null && current.id !== STAMP_WINDOW_ID;
  useEffect(() => {
    setOverlayOpen(overlayBusy);
  }, [overlayBusy]);
  useEffect(() => () => setOverlayOpen(false), []);
  useEffect(() => installTypingTracking(() => clock.getSnapshot()), [clock]);

  // Після перезавантаження `visible` міг лишитись без вікна — інакше пропозиції заблоковано назавжди.
  useEffect(() => {
    const { offers, hideOffer } = useGuestStore.getState();
    const cur = currentRef.current;
    if (offers.visible !== null && cur?.id !== OFFER_WINDOW_ID[offers.visible]) hideOffer();
  }, []);

  const infoTitle = tPass('infoTitle');

  const openPassInfo = useCallback(() => {
    open(passInfoSpec(deps, infoTitle));
    const last = useGuestStore.getState().stamps.at(-1)?.eventId ?? '';
    useGuestStore.getState().showOffer('pass-info', last, deps.now());
  }, [open, deps, infoTitle]);

  const openPassGate = useCallback(
    (feature: PassGateFeature, triggerEventId = '') => {
      const title = tPass(GATE_KEYS[feature].title);
      open(passGateSpec(deps, { feature, trigger: triggerEventId, title, infoTitle }));
      useGuestStore.getState().showOffer('pass-gate', triggerEventId, deps.now());
    },
    [open, deps, tPass, infoTitle],
  );

  const requestSchedule = useCallback(
    (eventId: string) => {
      const guest = useGuestStore.getState();
      if (guest.hasPass) {
        guest.toggleSchedule(eventId);
        return;
      }
      const event = getData().eventsById.get(eventId);
      const city = event ? (getData().citiesById.get(event.cityId)?.name.uk ?? '') : '';
      open(
        scheduleGateSpec(deps, {
          eventId,
          title: tPass('scheduleGate.title'),
          description: tPass('scheduleGate.adding', { city, time: event ? formatClock(event.midnightMs) : '' }),
          infoTitle,
        }),
      );
      guest.showOffer('pass-gate', eventId, deps.now());
    },
    [open, deps, tPass, infoTitle],
  );

  const openScheduleGate = useCallback(() => {
    open(scheduleGateSpec(deps, { title: tPass('scheduleGate.title'), description: tPass('scheduleGate.filterSub'), infoTitle }));
    useGuestStore.getState().showOffer('pass-gate', '', deps.now());
  }, [open, deps, tPass, infoTitle]);

  const openPassInfoBoard = useCallback(() => open(passInfoBoardSpec(infoTitle)), [open, infoTitle]);

  // `offer:show` → картка в потоці.
  useEffect(
    () =>
      on('offer:show', (p) => {
        const cur = currentRef.current;
        if (cur && cur.id !== STAMP_WINDOW_ID) return; // рушій мав це врахувати; страхуємось від гонки
        if (useGuestStore.getState().hasPass) return;
        if (p.kind === 'pass-offer') {
          open(passOfferSpec(deps, { count: p.stampCount, title: t('passTitle', { count: p.stampCount }), infoTitle }));
        } else {
          open(tipsSpec(deps, t('tipsTitle')));
        }
        useGuestStore.getState().showOffer(p.kind, p.triggerEventId, p.at);
      }),
    [open, deps, t, infoTitle],
  );

  return { requestSchedule, openPassGate, openPassInfo, openScheduleGate, openPassInfoBoard };
}
