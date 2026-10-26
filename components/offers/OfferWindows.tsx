'use client';

/**
 * Вікна пропозицій (O-PASS-OFFER, O-TIPS, O-PASS-GATE, O-PASS-INFO) для `OverlayManager` (`inflow`):
 * з’єднують чисті картки з `windows/*` зі станом гостя (`guest.offers`, країни штампів) і самим менеджером.
 * Закриття (×, Esc, заміна іншим вікном) записує `dismissedAt` у `guest.offers` — закрита пропозиція
 * не повертається тієї ночі (`offerEligibility`). Оплата — наступний етап: «Оформити пас» і «Підтримати» лише
 * записують `acted: 'primary'`, а картка показує імітоване «Оплата буде на наступному етапі».
 */
import { PassGate, type PassGateFeature } from '@/components/windows/PassGate';
import { PassInfo } from '@/components/windows/PassInfo';
import { PassOffer, type PassOfferCountry } from '@/components/windows/PassOffer';
import { Tips } from '@/components/windows/Tips';
import { useOverlay, type OverlaySpec } from '@/components/shell/OverlayManager';
import { getData } from '@/lib/data/load';
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

const wroteInChat = () => useGuestStore.getState().chat.sentAt.length > 0;

export interface OfferSpecDeps {
  /** Поточний час (спільний годинник) для `dismissedAt`. */
  now: () => Ms;
}

function PassInfoWindow() {
  const { close } = useOverlay();
  return <PassInfo wroteInChat={wroteInChat()} onClose={() => close(PASS_INFO_WINDOW_ID)} onGetPass={() => useGuestStore.getState().actOffer('primary')} />;
}

export function passInfoSpec(deps: OfferSpecDeps, title: string): OverlaySpec {
  return {
    id: PASS_INFO_WINDOW_ID,
    kind: 'inflow',
    title,
    onClose: () => dismissOfferIfVisible('pass-info', deps.now()),
    content: <PassInfoWindow />,
  };
}

function PassOfferWindow({ count, deps, infoTitle }: { count: number; deps: OfferSpecDeps; infoTitle: string }) {
  const { open, close } = useOverlay();
  return (
    <PassOffer
      count={count}
      countries={stampCountries()}
      wroteInChat={wroteInChat()}
      onClose={() => close(PASS_OFFER_WINDOW_ID)}
      onGetPass={() => useGuestStore.getState().actOffer('primary')}
      onDetails={() => {
        const guest = useGuestStore.getState();
        const trigger = guest.offers.history.at(-1)?.triggerEventId ?? '';
        guest.actOffer('details');
        // Заміна вікна закриває пропозицію (`dismissedAt`), а «Що дає пас» стає новою відкритою карткою.
        open(passInfoSpec(deps, infoTitle));
        useGuestStore.getState().showOffer('pass-info', trigger, deps.now());
      }}
    />
  );
}

export function passOfferSpec(deps: OfferSpecDeps, args: { count: number; title: string; infoTitle: string }): OverlaySpec {
  return {
    id: PASS_OFFER_WINDOW_ID,
    kind: 'inflow',
    title: args.title,
    onClose: () => dismissOfferIfVisible('pass-offer', deps.now()),
    content: <PassOfferWindow count={args.count} deps={deps} infoTitle={args.infoTitle} />,
  };
}

function TipsWindow() {
  const { close } = useOverlay();
  return <Tips onClose={() => close(TIPS_WINDOW_ID)} onSupport={() => useGuestStore.getState().actOffer('primary')} />;
}

export function tipsSpec(deps: OfferSpecDeps, title: string): OverlaySpec {
  return {
    id: TIPS_WINDOW_ID,
    kind: 'inflow',
    title,
    onClose: () => dismissOfferIfVisible('tips', deps.now()),
    content: <TipsWindow />,
  };
}

function PassGateWindow({ feature, trigger, deps, infoTitle }: { feature: PassGateFeature; trigger: string; deps: OfferSpecDeps; infoTitle: string }) {
  const { open, close } = useOverlay();
  return (
    <PassGate
      feature={feature}
      onClose={() => close(PASS_GATE_WINDOW_ID)}
      onWhatPassGives={() => {
        open(passInfoSpec(deps, infoTitle));
        useGuestStore.getState().showOffer('pass-info', trigger, deps.now());
      }}
    />
  );
}

export function passGateSpec(
  deps: OfferSpecDeps,
  args: { feature: PassGateFeature; trigger: string; title: string; infoTitle: string },
): OverlaySpec {
  return {
    id: PASS_GATE_WINDOW_ID,
    kind: 'inflow',
    title: args.title,
    onClose: () => dismissOfferIfVisible('pass-gate', deps.now()),
    content: <PassGateWindow feature={args.feature} trigger={args.trigger} deps={deps} infoTitle={args.infoTitle} />,
  };
}
