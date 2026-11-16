'use client';

/** Крок «Тост опубліковано» вікна тосту за рівнем і подарунок до тосту за $10 (`PassGiftCard`: пас активний / увійти й активувати). */
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { useOpenAuthWindow } from '@/components/auth/AuthWindow';
import { useOpenPassWindow, usePassDetails } from '@/components/pass/PassWindow';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { SendCodeButton } from '@/components/pass/PassBuy';
import { currentSession, useSession } from '@/lib/api/hooks/auth';
import { useToastStore } from '@/stores/toast';
import { ToastBubble } from './ToastBubble';
import { Foot } from './ToastFoot';
import s from './toastWindow.module.css';


/**
 * Подарунок до тосту за $10: «Пас активний» (увійшов — на акаунті) чи «Пас активний на цьому пристрої» (гість — як
 * куплений пас, з «Увійти кодом»; пас іде до першого акаунта на пристрої, рішення 2026-11-15).
 */
function PassGiftCard() {
  const t = useTranslations('toast');
  const gift = useToastStore((x) => x.gift);
  const devicePass = useSession().session?.devicePass ?? null;
  const passDetails = usePassDetails();
  const openAuth = useOpenAuthWindow();
  const openPass = useOpenPassWindow();
  if (!gift) return null;
  if (gift === 'active') {
    return (
      <div className={s.passCard} data-toast-gift="active">
        <div className={s.passHead}>
          <span className={s.passIcon} aria-hidden="true">
            <Icon name="ticket" size={18} />
          </span>
          <div className="flex-1">
            <p className={s.passTitle}>{t('passActive.title')}</p>
            <p className={s.passSub}>{t('passActive.sub')}</p>
          </div>
        </div>
        <p className={s.passText}>{t('passActive.text')}</p>
        <button type="button" onClick={passDetails} className={cn('t2f-focus', s.textLink, s.passLink)}>
          {t('passActive.more')}
        </button>
      </div>
    );
  }
  // Гість (рішення 2026-11-14): пас працює на цьому пристрої одразу, як куплений; «Увійти кодом» — щоб і на інших.
  const email = devicePass?.email ?? '';
  return (
    <div className={s.passCard} data-toast-gift="device">
      <div className={s.passHead}>
        <span className={s.passIcon} aria-hidden="true">
          <Icon name="ticket" size={18} />
        </span>
        <div className="flex-1">
          <p className={s.passTitle}>{t('passGift.title')}</p>
          <p className={s.passSub}>{t('passGift.sub')}</p>
        </div>
      </div>
      <p className={s.passText}>{t.rich('passGift.text', { email, b: (c) => <b>{c}</b> })}</p>
      {email ? (
        // Відступ від тексту більший, кнопка на всю ширину картки (правка власника 2026-11-16).
        <div className="mt-4 flex flex-col [&>button]:w-full">
          <SendCodeButton
            email={email}
            onSent={() => openAuth('signin', { step: { kind: 'code' }, email: currentSession()?.code?.email ?? email, afterSignIn: openPass })}
          />
        </div>
      ) : null}
    </div>
  );
}

export function Done({ onClose, phone }: { onClose: () => void; phone: boolean }) {
  const t = useTranslations('toast');
  const last = useToastStore((x) => x.last);
  const gift = useToastStore((x) => x.gift);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  if (!last) return null;
  const tier = last.tier;
  const compact = phone && tier === 10;
  return (
    <div className={s.flow} data-toast-step="success" data-tier={tier}>
      <div className={s.body} data-gap={tier === 10 ? '12' : undefined}>
        {compact ? (
          <div className={s.glassSmall} aria-hidden="true">
            <span>
              <Icon name="glass" size={22} />
            </span>
          </div>
        ) : (
          <div className={s.confetti} data-tier={tier} aria-hidden="true">
            {Array.from({ length: 7 }, (_, i) => (
              <i key={i} />
            ))}
            <span className={s.glassBig}>
              <Icon name="glass" size={32} strokeWidth={1.8} />
            </span>
          </div>
        )}
        <div className={s.doneHead} role="status" ref={ref} tabIndex={-1}>
          <p className={s.kicker}>{t('done.kicker')}</p>
          <h3 className={s.doneTitle}>{t('done.title')}</h3>
          <p className={s.doneText}>{t(`done.${tier}`)}</p>
        </div>
        <ToastBubble nick={last.nick} flagCode={last.flagCode} text={last.text} tier={tier} aside={t('strip.justNow')} meta pass={!!last.pass} />
        {gift ? <PassGiftCard /> : null}
      </div>
      <Foot>
        <button type="button" onClick={onClose} className={cn('t2f-focus', s.line, 'w-full')} data-action="toast-close">
          {t('done.close')}
        </button>
        <p className={s.receipt}>{t('done.receipt')}</p>
      </Foot>
    </div>
  );
}
