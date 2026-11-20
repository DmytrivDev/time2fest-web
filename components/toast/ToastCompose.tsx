'use client';

/** Крок 1 вікна тосту: рівень, тост, підпис, примітка про оплату, «Оплатити $N · Скасувати». */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { validateNick } from '@/lib/chat/nick';
import { chatActions } from '@/lib/api/hooks/chat';
import { detectFlag } from '@/lib/geo/detectFlag';
import { useSitePrices } from '@/lib/api/hooks/site';
import { formatUsd } from '@/lib/offers/format';
import { signatureReady, useToastStore } from '@/stores/toast';
import { profileActions, useHasPass, useProfile } from '@/lib/api/hooks/auth';
import { ToastField, Phrases, Signature } from './ToastField';
import { Foot } from './ToastFoot';
import { ToastBenefits, ToastTiers } from './ToastTiers';
import s from './toastWindow.module.css';


function PayNote() {
  const t = useTranslations('toast');
  return (
    <p className={s.payNote}>
      <Icon name="lock" size={14} />
      <span>
        {t('payNote')}{' '}
        <NextLink href="/payments/" className="t2f-focus">
          {t('terms')}
        </NextLink>
      </span>
    </p>
  );
}

/** Ніки-підказки «зайнято» (сервіс чату; у `sim` — автори сценарію). */
const takenNicks = () => chatActions.takenNicks();

/** Крок 1: рівень, тост, підпис, «Оплатити $N · Скасувати». */
export function Compose({ onCancel, phone }: { onCancel: () => void; phone: boolean }) {
  const t = useTranslations('toast');
  const tier = useToastStore((x) => x.tier);
  const { tiers } = useSitePrices();
  const setTier = useToastStore((x) => x.setTier);
  const text = useToastStore((x) => x.text);
  const issue = useToastStore((x) => x.issue);
  const hasPass = useHasPass();
  const profile = useProfile();
  const storedNick = profile?.nick?.trim() || undefined;
  const storedFlag = profile?.flagCode ?? profile?.detectedFlag ?? undefined;
  const hasNick = signatureReady(storedNick);
  // Підпис: свій нік — рядок «Підпис у чаті · Змінити»; без дійсного ніку чи «Змінити» — редагування тут же.
  const [editing, setEditing] = useState(!hasNick);
  const [draftNick, setDraftNick] = useState(hasNick ? (storedNick ?? '') : '');
  const [draftFlag, setDraftFlag] = useState(() => storedFlag ?? detectFlag() ?? 'earth');
  const taken = useMemo(() => takenNicks(), []);
  const nickIssue = editing ? validateNick(draftNick, draftNick === storedNick ? [] : taken) : null;
  const nickOk = !editing || nickIssue === null;
  const [sig, setSig] = useState<'idle' | 'saving' | 'failed'>('idle');
  const blocked = !text.trim() || !!issue || !nickOk || sig === 'saving';
  const ref = useRef<HTMLDivElement>(null);
  const pay = async () => {
    if (blocked) return;
    // Нік і прапор — профіль (шов, залишки E5). Підпис не зберігся (стан шва №10, рішення 2026-11-14) — оплату не
    // починаємо: тост зі старим підписом не йде; помилка під підписом, «Оплатити» — спробувати ще раз.
    if (editing) {
      setSig('saving');
      const res = await profileActions.update({ nick: draftNick.trim(), flagCode: draftFlag });
      if (!res.ok) {
        setSig('failed');
        return;
      }
      setSig('idle');
    }
    const ok = useToastStore.getState().pay();
    // Фільтр не пропустив — повідомлення про помилку видно (прокрутка до поля).
    if (!ok && useToastStore.getState().issue) {
      requestAnimationFrame(() => ref.current?.querySelector('[data-toast-field]')?.scrollIntoView({ block: 'nearest' }));
    }
  };
  const showNick = editing ? draftNick.trim() || undefined : draftNick;
  return (
    <div className={s.flow} data-toast-step="compose" ref={ref}>
      <div className={s.body}>
        <h3 className={s.secTitle}>{t('chooseTitle')}</h3>
        <ToastTiers value={tier} onChange={setTier} phone={phone} />
        <ToastBenefits tier={tier} hasPass={hasPass} />
        <h3 className={s.secTitle}>{t('yourToast')}</h3>
        <ToastField nick={showNick} flagCode={showNick ? draftFlag : undefined} />
        {issue ? (
          <div className={s.reject} role="alert" data-toast-reject={issue.kind}>
            <Icon name="alert" size={18} />
            <div>
              <p className={s.rejectTitle}>{t('filter.title')}</p>
              <p className={s.rejectText}>{t(`filter.${issue.kind}`)}</p>
            </div>
          </div>
        ) : null}
        <Phrases />
        {issue ? null : <p className={s.rule}>{t('rule')}</p>}
        <Signature
          editing={editing}
          draftNick={draftNick}
          draftFlag={draftFlag}
          onEdit={() => setEditing(true)}
          onNick={setDraftNick}
          onFlag={setDraftFlag}
          issue={nickIssue}
          saveFailed={sig === 'failed'}
        />
        <PayNote />
      </div>
      <Foot>
        <div className={s.footRow}>
          <button
            type="button"
            disabled={blocked}
            aria-busy={sig === 'saving' || undefined}
            onClick={() => void pay()}
            className={cn('t2f-focus', s.coral)}
            data-action="toast-pay"
            title={!nickOk ? t('payNeedsNick') : undefined}
          >
            {sig === 'saving' ? t('signatureSaving') : t('pay', { price: formatUsd(tiers[tier]) })}
          </button>
          <button type="button" onClick={onCancel} className={cn('t2f-focus', s.line)}>
            {t('cancel')}
          </button>
        </div>
      </Foot>
    </div>
  );
}
