'use client';

/**
 * Вікна навколо пасу для `OverlayManager` (O-PASS-GATE, «Графік — у пасі», «Усе про пас»): з’єднують чисті картки
 * з `windows/*` зі станом гостя (`guest.offers`) і менеджером. Пропозиція пасу й чайові — не вікна, а окремий блок під
 * штампом (`OfferBlock`, рішення 2026-11-01); «Що дає пас» на сторінці більше немає — «Детальніше» веде у вікно пасу
 * або на /pass/ (`usePassDetails`).
 * Закриття (×, Esc, заміна іншим вікном) записує `dismissedAt` у `guest.offers` — закрита пропозиція
 * не повертається тієї ночі (`offerEligibility`). «Оформити пас» записує `acted: 'primary'` і відкриває оформлення
 * пасу (`useGetPass`); «Підтримати» поки показує імітоване «Оплата буде на наступному етапі».
 */
import { useGetPass, usePassDetails } from '@/components/pass/PassWindow';
import { PassGate, type PassGateFeature } from '@/components/windows/PassGate';
import { AlsoInPass, MainFeatures, PassActions, usePassFeatures } from '@/components/windows/PassInfo';
import { ScheduleGate } from '@/components/windows/ScheduleGate';
import type { PassOfferCountry } from '@/components/windows/PassOffer';
import { useOverlay, type OverlaySpec } from '@/components/shell/OverlayManager';
import { getData } from '@/lib/data/load';
import { formatClock } from '@/lib/i18n/time';
import type { Ms, OfferKind } from '@/lib/data/types';
import { useGuestStore } from '@/stores/guest';

export const PASS_OFFER_WINDOW_ID = 'O-PASS-OFFER';
export const TIPS_WINDOW_ID = 'O-TIPS';
export const PASS_GATE_WINDOW_ID = 'O-PASS-GATE';
export const PASS_INFO_WINDOW_ID = 'O-PASS-INFO';

export const OFFER_WINDOW_ID: Record<OfferKind, string> = {
  'pass-offer': PASS_OFFER_WINDOW_ID,
  tips: TIPS_WINDOW_ID,
  'pass-gate': PASS_GATE_WINDOW_ID,
  'pass-info': PASS_INFO_WINDOW_ID,
};

/** Закриття вікна пропозиції → `dismissedAt`, якщо вона ще показана. */
export function dismissOfferIfVisible(kind: OfferKind, at: Ms): void {
  const { offers, dismissOffer } = useGuestStore.getState();
  if (offers.visible === kind) dismissOffer(at);
}

/** Країни зі штампів гостя (по одній, у порядку отримання), назви — у називному. */
export function stampCountries(): PassOfferCountry[] {
  const data = getData();
  const seen = new Set<string>();
  const out: PassOfferCountry[] = [];
  for (const stamp of useGuestStore.getState().stamps) {
    if (seen.has(stamp.countryIso)) continue;
    seen.add(stamp.countryIso);
    const country = data.countriesByIso.get(stamp.countryIso);
    out.push({ iso: stamp.countryIso, name: country?.name.uk ?? stamp.countryIso, flagCode: country?.flagCode ?? stamp.countryIso });
  }
  return out;
}

export const wroteInChat = () => useGuestStore.getState().chat.sentAt.length > 0;

export interface OfferSpecDeps {
  /** Поточний час (спільний годинник) для `dismissedAt`. */
  now: () => Ms;
}

/** «Оформити пас» з пропозиції: записати дію й відкрити вікно оформлення на місці чату (телефон — шторка). */
export function useOfferGetPass(kind?: OfferKind): () => void {
  const getPass = useGetPass();
  return () => {
    useGuestStore.getState().actOffer('primary', kind);
    getPass();
  };
}

export const SCHEDULE_GATE_WINDOW_ID = 'O-SCHEDULE-GATE';
export const PASS_INFO_BOARD_ID = 'O-PASS-INFO-BOARD';

/** «Усе про пас» з вікна графіка: ті самі переваги й «Оформити пас», але вікном на місці чату (шторкою на телефоні). */
function PassInfoBoard() {
  const onGetPass = useOfferGetPass();
  const { main, also } = usePassFeatures(wroteInChat());
  return (
    <div className="flex flex-col gap-4 px-4 pb-4 pt-3.5" data-window="O-PASS-INFO-BOARD">
      <MainFeatures items={main} />
      <AlsoInPass items={also} />
      <PassActions onGetPass={onGetPass} />
    </div>
  );
}

export function passInfoBoardSpec(title: string): OverlaySpec {
  return { id: PASS_INFO_BOARD_ID, kind: 'accent', chrome: 'board', coral: true, title, content: <PassInfoBoard /> };
}

function ScheduleGateWindow({ eventId, infoTitle }: { eventId?: string; infoTitle: string }) {
  const { open, close } = useOverlay();
  const getPass = useGetPass();
  const event = eventId ? getData().eventsById.get(eventId) : undefined;
  const city = event ? getData().citiesById.get(event.cityId)?.name.uk : undefined;
  return (
    <ScheduleGate
      city={city}
      flagCode={event?.countryIso}
      time={event ? formatClock(event.midnightMs) : undefined}
      onGetPass={() => getPass()}
      onPassInfo={() => open(passInfoBoardSpec(infoTitle))}
      onClose={() => close(SCHEDULE_GATE_WINDOW_ID)}
    />
  );
}

/** «Графік — у Новорічному пасі» (рішення 2026-10-31): вікно на місці чату / шторкою замість плашки в потоці. */
export function scheduleGateSpec(deps: OfferSpecDeps, args: { eventId?: string; title: string; description: string; infoTitle: string }): OverlaySpec {
  return {
    id: SCHEDULE_GATE_WINDOW_ID,
    kind: 'accent',
    chrome: 'board',
    coral: true,
    title: args.title,
    description: args.description,
    onClose: () => dismissOfferIfVisible('pass-gate', deps.now()),
    content: <ScheduleGateWindow eventId={args.eventId} infoTitle={args.infoTitle} />,
  };
}

function PassGateWindow({ feature }: { feature: PassGateFeature }) {
  const { close } = useOverlay();
  const passDetails = usePassDetails();
  return <PassGate feature={feature} onClose={() => close(PASS_GATE_WINDOW_ID)} onWhatPassGives={passDetails} />;
}

export function passGateSpec(
  deps: OfferSpecDeps,
  args: { feature: PassGateFeature; trigger: string; title: string },
): OverlaySpec {
  return {
    id: PASS_GATE_WINDOW_ID,
    kind: 'inflow',
    title: args.title,
    onClose: () => dismissOfferIfVisible('pass-gate', deps.now()),
    content: <PassGateWindow feature={args.feature} />,
  };
}
