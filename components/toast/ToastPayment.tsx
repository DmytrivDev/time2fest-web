'use client';

/**
 * Кроки оплати вікна тосту: «Чекаємо оплату» (`Paying`), «Оплата не пройшла» / «Немає з’єднання» (`Failed`) та їхні
 * спільні шматки — що оплачується (`Summary`) і тост, який уже не змінити (`LockedField`).
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { cn } from '@/components/primitives/cn';
import { Emoji, EmojiText } from '@/components/primitives/Emoji';
import { Icon } from '@/components/primitives/Icon';
import { formatUsd } from '@/lib/offers/format';
import { useToastStore } from '@/stores/toast';
import { useProfile } from '@/lib/api/hooks/auth';
import { ToastPill } from './ToastBubble';
import { Who } from './ToastField';
import { Foot } from './ToastFoot';
import { TIER_EMOJI } from './ToastTiers';
import s from './toastWindow.module.css';


/** «Тост $5 · пляшка ігристого» — що оплачується. */
function Summary() {
  const t = useTranslations('toast');
  const tier = useToastStore((x) => x.tier);
  return (
    <div className={s.summary} data-toast-summary={tier}>
      <Emoji char={TIER_EMOJI[tier]} size={22} />
      <div className="min-w-0 flex-1">
        <p className={s.summaryTitle}>{t('summary.title', { price: formatUsd(tier), name: t(`tiers.${tier}`) })}</p>
        <p className={s.summaryText}>{t(`summary.${tier}`)}</p>
      </div>
    </div>
  );
}

/** Тост, який уже не змінити (оплата йде чи не пройшла). */
function LockedField() {
  const text = useToastStore((x) => x.text);
  const me = useProfile();
  const nick = me?.nick?.trim() || undefined;
  const flag = me?.flagCode ?? me?.detectedFlag ?? undefined;
  return (
    <div className={s.field} data-locked="">
      <div className={s.fieldHead}>
        <Who nick={nick} flagCode={flag} />
        <ToastPill />
      </div>
      <p className={s.lockedText}>
        <EmojiText text={text} />
      </p>
    </div>
  );
}

export function Paying({ onCancel }: { onCancel: () => void }) {
  const t = useTranslations('toast');
  const tier = useToastStore((x) => x.tier);
  return (
    <div className={s.flow} data-toast-step="paying">
      <div className={s.body}>
        <div className={s.status} role="status">
          <span className={s.spin} aria-hidden="true" />
          <div>
            <p className={s.statusTitle}>{t('paying.title')}</p>
            <p className={s.statusText}>{t('paying.text')}</p>
          </div>
        </div>
        <Summary />
        <LockedField />
        <p className={s.note}>{tier >= 5 ? t('paying.notePinned') : t('paying.noteChat')}</p>
      </div>
      <Foot>
        <div className={s.footRow}>
          {/* Справжня оплата відкриває сторінку PayPro знову; в імітації вкладки немає — оплата просто йде далі. */}
          <button type="button" className={cn('t2f-focus', s.line)} data-action="toast-reopen">
            <Icon name="external" size={16} />
            {t('paying.open')}
          </button>
          <button type="button" onClick={onCancel} className={cn('t2f-focus', s.line)}>
            {t('cancel')}
          </button>
        </div>
      </Foot>
    </div>
  );
}

export function Failed({ onCancel, offline }: { onCancel: () => void; offline?: boolean }) {
  const t = useTranslations('toast');
  const tier = useToastStore((x) => x.tier);
  return (
    <div className={s.flow} data-toast-step={offline ? 'offline' : 'failed'}>
      <div className={s.body}>
        <div className={s.failBox} role="alert">
          <span className={s.failIcon} aria-hidden="true">
            <Icon name={offline ? 'wifi-off' : 'alert'} size={20} />
          </span>
          <div>
            <p className={s.failTitle}>{offline ? t('offline.title') : t('failed.title')}</p>
            <p className={s.failText}>{offline ? t('offline.text') : t('failed.text')}</p>
          </div>
        </div>
        <Summary />
        <LockedField />
        <p className={s.saved}>
          <Icon name="check" size={14} strokeWidth={2.4} />
          {t('failed.saved')}
        </p>
        <p className={s.help}>
          {t('failed.helpQ')}{' '}
          <NextLink href="/help/" className="t2f-focus">
            {t('failed.help')}
          </NextLink>
        </p>
      </div>
      <Foot>
        <div className={s.footRow}>
          <button type="button" onClick={() => useToastStore.getState().pay()} className={cn('t2f-focus', s.coral)} data-action="toast-retry">
            {offline ? t('offline.retry') : t('failed.retry', { price: formatUsd(tier) })}
          </button>
          <button type="button" onClick={onCancel} className={cn('t2f-focus', s.line, s.lineNarrow)}>
            {t('cancel')}
          </button>
        </div>
      </Foot>
    </div>
  );
}
