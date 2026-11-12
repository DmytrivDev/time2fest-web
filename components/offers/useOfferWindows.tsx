'use client';

/**
 * Пропозиції й підказки пасу на поверхні з плеєром (T120, FR-063/064, `contracts/ui-events.md` `offer:show`).
 * Сторінка з `OverlayInFlowOutlet` викликає `useOfferWindows()` один раз (поруч із `useMomentWindows`):
 * - слухає `offer:show` від `EngineScheduler` (правила часу, «одна за раз» — у `offerEligibility`) і записує `OfferEntry`
 *   у `guest.offers`; саму картку пасу показує `OfferBlock` під штампом (рішення 2026-11-01);
 * - повідомляє рушію про стан інтерфейсу: чи відкрите вікно (рядок «Штамп у паспорті» не рахується) і чи людина
 *   вводить текст (фокус у полі або ~10 с після останнього натискання) — див. `lib/offers/uiState`;
 * - віддає `requestSchedule` (кнопка графіка: з пасом — перемикає, без пасу — вікно «Графік — у Новорічному пасі» на місці
 *   чату, рішення 2026-10-31), `openPassGate`, `openPassInfo`. З пасом після дії — тостер «Додано в графік · Повернути»;
 *   пояс повний (усі слоти, до 4 країн — рішення 2026-11-06) — вікно «Замінити в графіку?» на місці чату.
 * Поява анонсується ввічливо самим `InFlowSlot` (`aria-live="polite"`); фокус сторінка не переносить.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useOverlay } from '@/components/shell/OverlayManager';
import { GATE_KEYS, type PassGateFeature } from '@/components/windows/PassGate';
import { on } from '@/lib/events/bus';
import { installTypingTracking, setOverlayOpen } from '@/lib/offers/uiState';
import { useClock } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import { usePassDetails } from '@/components/pass/PassWindow';
import { OFFER_WINDOW_ID, passGateSpec, passInfoBoardSpec, scheduleGateSpec, type OfferSpecDeps } from './OfferWindows';
import { getData } from '@/lib/data/load';
import { formatClock } from '@/lib/i18n/time';
import { scheduledCountries, scheduleToggleResult } from '@/lib/schedule/countryZone';
import { showScheduleToast } from '@/components/schedule/toastStore';
import { SCHEDULE_REPLACE_ID, useScheduleReplace } from '@/components/schedule/scheduleReplace';
import { ScheduleReplaceContent } from '@/components/schedule/ScheduleWindows';

export interface PassWindowsApi {
  /** Кнопка графіка події: з пасом — додати/прибрати, без пасу — «Потрібен пас». */
  /** `back` — «‹ Назад» / «Скасувати» у вікні заміни (повернутись до списку країн поясу). */
  requestSchedule(eventId: string, next?: boolean, back?: () => void): void;
  openPassGate(feature: PassGateFeature, triggerEventId?: string): void;
  /** «Мій графік» без пасу — вікно «Графік — у Новорічному пасі» без конкретного міста. */
  openScheduleGate(): void;
  /** «Що дає Новорічний пас» на місці чату / шторкою (смужка «Мій графік» без пасу). */
  openPassInfoBoard(): void;
  openPassInfo(): void;
  /** «Замінити» на слоті поясу, поки відкрите вікно «Замінити в графіку?». */
  replaceInSchedule(outIso: string): void;
}

const countryName = (iso: string) => getData().countriesByIso.get(iso)?.name.uk ?? iso;

export function useOfferWindows(): PassWindowsApi {
  const overlay = useOverlay();
  const { open, current } = overlay;
  const clock = useClock();
  const tPass = useTranslations('pass');
  const tS = useTranslations('schedulePage');
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  });

  const deps = useMemo<OfferSpecDeps>(() => ({ now: () => clock.getSnapshot() }), [clock]);

  // Стан інтерфейсу для рушія.
  // Штамп — окремий блок під плеєром (не вікно), тож будь-яке відкрите вікно — «зайнято».
  const overlayBusy = current !== null;
  useEffect(() => {
    setOverlayOpen(overlayBusy);
  }, [overlayBusy]);
  useEffect(() => () => setOverlayOpen(false), []);
  useEffect(() => installTypingTracking(() => clock.getSnapshot()), [clock]);

  // Після перезавантаження `visible` вікна-підказки (pass-gate) міг лишитись без вікна — інакше пропозиції заблоковано
  // назавжди. Пропозиція пасу — блок під штампом (`OfferBlock`), вона лишається видимою й після перезавантаження.
  useEffect(() => {
    const { offers, hideOffer } = useGuestStore.getState();
    const cur = currentRef.current;
    const isBlock = offers.visible === 'pass-offer';
    if (offers.visible !== null && !isBlock && cur?.id !== OFFER_WINDOW_ID[offers.visible]) hideOffer();
  }, []);

  const infoTitle = tPass('infoTitle');

  const openPassInfo = usePassDetails();

  const openPassGate = useCallback(
    (feature: PassGateFeature, triggerEventId = '') => {
      const title = tPass(GATE_KEYS[feature].title);
      open(passGateSpec(deps, { feature, trigger: triggerEventId, title }));
      useGuestStore.getState().showOffer('pass-gate', triggerEventId, deps.now());
    },
    [open, deps, tPass],
  );

  const replaceInSchedule = useCallback(
    (outIso: string) => {
      const eventId = useScheduleReplace.getState().eventId;
      const event = eventId ? getData().eventsById.get(eventId) : undefined;
      if (!eventId || !event) return;
      const guest = useGuestStore.getState();
      const prev = guest.schedule;
      guest.replaceSchedule(outIso, eventId);
      showScheduleToast(tS('toast.replaced', { from: countryName(outIso), to: countryName(event.countryIso) }), prev);
      overlay.close(SCHEDULE_REPLACE_ID);
    },
    [overlay, tS],
  );

  const openScheduleReplace = useCallback(
    (eventId: string, back?: () => void) => {
      const event = getData().eventsById.get(eventId);
      if (!event) return;
      useScheduleReplace.setState({ eventId });
      open({
        id: SCHEDULE_REPLACE_ID,
        kind: 'accent',
        chrome: 'board',
        title: tS('replaceWin.title'),
        description: tS('replaceWin.sub', { count: scheduledCountries(useGuestStore.getState().schedule, event.zoneId).length }),
        onClose: () => useScheduleReplace.setState({ eventId: null }),
        ...(back ? { onBack: back } : {}),
        content: (
          <ScheduleReplaceContent eventId={eventId} onReplace={replaceInSchedule} onCancel={back ?? (() => overlay.close(SCHEDULE_REPLACE_ID))} />
        ),
      });
    },
    [open, overlay, tS, replaceInSchedule],
  );

  const requestSchedule = useCallback(
    (eventId: string, _next?: boolean, back?: () => void) => {
      const guest = useGuestStore.getState();
      if (guest.hasPass) {
        const prev = guest.schedule;
        const result = scheduleToggleResult(prev, eventId);
        if (result === 'full') {
          openScheduleReplace(eventId, back);
          return;
        }
        guest.toggleSchedule(eventId);
        const iso = getData().eventsById.get(eventId)?.countryIso ?? '';
        showScheduleToast(tS(result === 'added' ? 'toast.added' : 'toast.removed', { country: countryName(iso) }), prev);
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
    [open, deps, tPass, infoTitle, tS, openScheduleReplace],
  );

  const openScheduleGate = useCallback(() => {
    open(scheduleGateSpec(deps, { title: tPass('scheduleGate.title'), description: tPass('scheduleGate.filterSub'), infoTitle }));
    useGuestStore.getState().showOffer('pass-gate', '', deps.now());
  }, [open, deps, tPass, infoTitle]);

  const openPassInfoBoard = useCallback(() => open(passInfoBoardSpec(infoTitle)), [open, infoTitle]);

  // `offer:show` → запис у `guest.offers`; показує картку блок під штампом (`OfferBlock`) — вікна збоку її не прибирають.
  useEffect(
    () =>
      on('offer:show', (p) => {
        if (useGuestStore.getState().hasPass) return;
        useGuestStore.getState().showOffer(p.kind, p.triggerEventId, p.at);
      }),
    [],
  );

  return { requestSchedule, openPassGate, openPassInfo, openScheduleGate, openPassInfoBoard, replaceInSchedule };
}
