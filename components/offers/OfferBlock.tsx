'use client';

/**
 * Пропозиція пасу й чайові — окремий блок під штампом (рішення власника 2026-11-01), не вікно `OverlayManager`:
 * вікна збоку («Обрати трансляцію», вхід, «Поділитися») її не прибирають. Штамп ще відкритий — блок одразу під ним;
 * штамп прибрали — на тому ж місці, тобто над «Першим рядом».
 * - з’являється за `offer:show` (правила — `offerEligibility`; запис — `useOfferWindows`), лишається й після
 *   перезавантаження, доки не закриють «×» або не оформлять пас;
 * - чайові — «Скажи тост на весь світ»: після «Підтримати» золотий тост гостя з’являється в чаті «Світ»;
 * - «Оформити пас» — вікно пасу на місці чату (телефон — шторка), навіть без трансляції;
 * - «Детальніше» — те саме вікно, коли трансляція грає; інакше — сторінка /pass/ (`usePassDetails`);
 * - поява й зникнення — як у штампа: місце відкривається порожнім, картка «приземляється»; «×» — картка гасне, потім
 *   місце стягується (`StampMotion.css`).
 */
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { buildToast } from '@/lib/chat-sim/toast';
import { useChatFeed } from '@/lib/chat-sim/store';
import { usePassDetails } from '@/components/pass/PassWindow';
import { Reveal } from '@/components/primitives/Reveal';
import { PassOffer } from '@/components/windows/PassOffer';
import { Tips } from '@/components/windows/Tips';
import { useClock } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import { stampCountries, useOfferGetPass, wroteInChat } from './OfferWindows';

type BlockKind = 'pass-offer' | 'tips';
const LEAVE_MS = 220;
/** Reveal стягує місце за 240 мс. */
const COLLAPSE_MS = 280;
const reducedMotionOn = () => typeof document !== 'undefined' && document.documentElement.dataset.reduceMotion !== 'false';

export function OfferBlock({ className }: { className?: string }) {
  const clock = useClock();
  // Картка блоку — остання незакрита пропозиція пасу чи чайових (з історії, не з `visible`: вікна-підказки на кшталт
  // «Графік — у пасі» теж пишуть `visible`, але картку під штампом не витісняють).
  const kind = useGuestStore((g): BlockKind | null => {
    if (g.hasPass) return null;
    const last = g.offers.history.findLast((e) => e.kind === 'pass-offer' || e.kind === 'tips');
    return last && last.dismissedAt === undefined ? (last.kind as BlockKind) : null;
  });
  const stampCount = useGuestStore((g) => g.stamps.length);
  const tOffers = useTranslations('offers');
  const nick = useGuestStore((g) => g.nick?.trim()) || tOffers('toastGuest');
  const flagCode = useGuestStore((g) => g.flagCode ?? g.detectedFlag);
  const onGetPass = useOfferGetPass('pass-offer');
  const passDetails = usePassDetails();


  // Поки блок плавно зникає після «×», показуємо ту саму картку; позначку «зникає» знімаємо, коли картка знову видна.
  const [leaving, setLeaving] = useState(false);
  const [shown, setShown] = useState<BlockKind | null>(null);
  useEffect(() => {
    if (kind) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- запам’ятати показану картку для анімації зникнення
      setShown(kind);
      setLeaving(false);
    }
  }, [kind]);
  // Після «×» картка лишається лише на час анімації (гасне, потім місце стягується), далі — прибирається з розмітки.
  const current = kind ?? (leaving ? shown : null);

  const leaveTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);
  const dismiss = () => {
    const k = current;
    const done = () => k && useGuestStore.getState().dismissOffer(clock.getSnapshot(), k);
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
    <Reveal open={!!kind}>
      {current ? (
        <div key={current} className="pb-4" data-offer-block={current} data-leaving={leaving || undefined}>
          {current === 'pass-offer' ? (
            <PassOffer
              count={stampCount}
              countries={stampCountries()}
              wroteInChat={wroteInChat()}
              onClose={dismiss}
              onGetPass={onGetPass}
              onDetails={() => {
                useGuestStore.getState().actOffer('details', 'pass-offer');
                passDetails();
              }}
            />
          ) : (
            <Tips
              nick={nick}
              flagCode={flagCode}
              onClose={dismiss}
              onSupport={(amount, toast) => {
                const g = useGuestStore.getState();
                g.actOffer('primary', 'tips');
                useChatFeed.getState().append([
                  buildToast({ text: toast, amount, now: clock.getSnapshot(), guestId: g.id, nick, flagCode, hasPass: g.hasPass }),
                ]);
              }}
            />
          )}
        </div>
      ) : null}
    </Reveal>
    </div>
  );
}
