'use client';

/**
 * Пропозиція пасу — окремий блок під штампом (рішення власника 2026-11-01), не вікно `OverlayManager`:
 * вікна збоку («Обрати трансляцію», вхід, «Поділитися») її не прибирають. Штамп ще відкритий — блок одразу під ним;
 * штамп прибрали — на тому ж місці.
 * - з’являється за `offer:show` (правила — `offerEligibility`; запис — `useOfferWindows`), лишається й після
 *   перезавантаження, доки не закриють «×» або не оформлять пас;
 * - «Оформити пас» — вікно пасу на місці чату (телефон — шторка), навіть без трансляції;
 * - «Детальніше» — те саме вікно, коли трансляція грає; інакше — сторінка /pass/ (`usePassDetails`);
 * - поява й зникнення — як у штампа: місце відкривається порожнім, картка «приземляється»; «×» — картка гасне, потім
 *   місце стягується (`StampMotion.css`).
 * Картки «Чайові · Скажи тост на весь світ» тут більше немає (рішення власника 2026-11-12): тост доступний усім і
 * завжди — смуга тостів під плеєром, келих у полі чату, «Підтримати».
 */
import { useEffect, useRef, useState } from 'react';
import { usePassDetails } from '@/components/pass/PassWindow';
import { Reveal } from '@/components/primitives/Reveal';
import { PassOffer } from '@/components/windows/PassOffer';
import { currentStamps, useStamps } from '@/lib/api/hooks/passport';
import { useClock } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import { metPoints, nextPoints } from '@/lib/offers/passPath';
import { useNow } from '@/lib/time/TimeProvider';
import { useOfferGetPass } from './OfferWindows';
import { useHasPass } from '@/lib/api/hooks/auth';

const LEAVE_MS = 220;
/** Reveal стягує місце за 240 мс. */
const COLLAPSE_MS = 280;
const reducedMotionOn = () => typeof document !== 'undefined' && document.documentElement.dataset.reduceMotion !== 'false';

export function OfferBlock({ className }: { className?: string }) {
  const clock = useClock();
  // Хвилинна точність — «за 54 хв» оновлюється раз на хвилину.
  const now = useNow({ granularity: 'minute' });
  // Картка блоку — остання незакрита пропозиція пасу (з історії, не з `visible`: вікна-підказки на кшталт
  // «Графік — у пасі» теж пишуть `visible`, але картку під штампом не витісняють).
  const hasPass = useHasPass();
  const shownNow = useGuestStore((g): boolean => {
    if (hasPass) return false;
    const last = g.offers.history.findLast((e) => e.kind === 'pass-offer');
    return !!last && last.dismissedAt === undefined;
  });
  const stampCount = useStamps().length;
  const onGetPass = useOfferGetPass('pass-offer');
  const passDetails = usePassDetails();

  // Поки блок плавно зникає після «×», показуємо ту саму картку; позначку «зникає» знімаємо, коли картка знову видна.
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- картка знову видна — анімація зникнення скінчилась
    if (shownNow) setLeaving(false);
  }, [shownNow]);
  // Після «×» картка лишається лише на час анімації (гасне, потім місце стягується), далі — прибирається з розмітки.
  const current = shownNow || leaving;

  const leaveTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);
  const dismiss = () => {
    const done = () => useGuestStore.getState().dismissOffer(clock.getSnapshot(), 'pass-offer');
    if (reducedMotionOn()) return done();
    setLeaving(true);
    leaveTimer.current = window.setTimeout(() => {
      done();
      leaveTimer.current = window.setTimeout(() => setLeaving(false), COLLAPSE_MS);
    }, LEAVE_MS);
  };

  return (
    // Поява картки оголошується ввічливо (як раніше `InFlowSlot`); фокус не переноситься.
    <div aria-live="polite" className={className}>
      <Reveal open={shownNow}>
        {current ? (
          <div className="pb-4" data-offer-block="pass-offer" data-leaving={leaving || undefined}>
            <PassOffer
              count={stampCount}
              met={metPoints(currentStamps())}
              next={nextPoints(now, 3)}
              now={now}
              onClose={dismiss}
              onGetPass={onGetPass}
              onDetails={() => {
                useGuestStore.getState().actOffer('details', 'pass-offer');
                passDetails();
              }}
            />
          </div>
        ) : null}
      </Reveal>
    </div>
  );
}
