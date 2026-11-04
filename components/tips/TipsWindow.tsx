'use client';

/**
 * Вікно «Чайові» (дошки `Desk-Tips-Pay`, `Desk-Tips-Thanks`, рішення власника 2026-11-01): на місці чату, на телефоні —
 * шторка (як вікно пасу). Стани — `stores/tips`:
 * - форма (з «Підтримати» в хедері): тост у чаті «Світ» із «Змінити», сума $2 / $5 / $10, email для квитанції (акаунт
 *   не потрібен), «Підтримати $N»;
 * - «Відкриваємо оплату…» → «Чекаємо підтвердження оплати» / «Оплата не пройшла» / «Немає з’єднання» → «Дякуємо!».
 * Стани — по центру вікна; тексти — як в оплати пасу. Після «Дякуємо» лише «Закрити».
 */
import { useTranslations } from 'next-intl';
import { useCallback, useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { Link } from '@/components/primitives/Link';
import { TextField } from '@/components/primitives/TextField';
import { useOverlay } from '@/components/shell/OverlayManager';
import { TOAST_MAX } from '@/components/windows/Tips';
import { formatUsd, TIP_AMOUNTS } from '@/lib/offers/format';
import { useGuestStore } from '@/stores/guest';
import { useTipsStore, type TipsPhase } from '@/stores/tips';
import s from './tipsWindow.module.css';

export const TIPS_WINDOW_ID = 'O-TIPS-PAY';
const LINK = /(https?:\/\/|www\.)/i;

function useWho() {
  const t = useTranslations('offers');
  const nick = useGuestStore((g) => g.nick?.trim()) || t('toastGuest');
  const flagCode = useGuestStore((g) => g.flagCode ?? g.detectedFlag);
  return { nick, flagCode };
}

/** Золотий тост — як у чаті (`solid`) або прев’ю з «Змінити». */
function ToastBubble({ text, solid, onEdit }: { text: string; solid?: boolean; onEdit?: () => void }) {
  const t = useTranslations('offers');
  const { nick, flagCode } = useWho();
  return (
    <div className={cn(s.bubble, solid && s.bubbleSolid)}>
      <span className={s.who}>
        {flagCode ? <Flag round code={flagCode} size="xs" decorative /> : null}
        <span className={s.nick}>{nick}</span>
        <span className="t2f-toast-badge">{t('toastBadge')}</span>
        {onEdit ? (
          <button type="button" onClick={onEdit} className={cn('t2f-focus', s.edit)}>
            <Icon name="pencil" size={14} />
            {t('toastEdit')}
          </button>
        ) : null}
      </span>
      <span className={s.text}>{text}</span>
    </div>
  );
}

function Amounts({ disabled }: { disabled?: boolean }) {
  const t = useTranslations('offers');
  const amount = useTipsStore((x) => x.amount);
  const setAmount = useTipsStore((x) => x.setAmount);
  return (
    <div role="radiogroup" aria-label={t('tipsAmount')} className={s.amounts}>
      {TIP_AMOUNTS.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={amount === n}
          disabled={disabled}
          onClick={() => setAmount(n)}
          className={cn('t2f-focus t2f-transition', s.amount)}
        >
          {formatUsd(n)}
        </button>
      ))}
    </div>
  );
}

function PayNote() {
  const t = useTranslations('tips');
  return (
    <p className={s.note}>
      <Icon name="lock" size={14} />
      <span>
        {t('payNote')}{' '}
        <Link href="#" className="font-semibold">
          {t('terms')}
        </Link>
      </span>
    </p>
  );
}

function Form() {
  const t = useTranslations('tips');
  const tOffers = useTranslations('offers');
  const toast = useTipsStore((x) => x.toast) || tOffers('toastDefault');
  const setToast = useTipsStore((x) => x.setToast);
  const amount = useTipsStore((x) => x.amount);
  const email = useTipsStore((x) => x.email);
  const issue = useTipsStore((x) => x.emailIssue);
  const setEmail = useTipsStore((x) => x.setEmail);
  const submit = useTipsStore((x) => x.submit);
  const [editing, setEditing] = useState(false);
  const fieldId = useId();
  const bad = !toast.trim() || LINK.test(toast);
  return (
    <form
      noValidate
      className={s.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (bad) return;
        setToast(toast.trim());
        submit();
      }}
    >
      <div className={s.toastCard}>
        <span className={s.kicker}>{t('toastKicker')}</span>
        {editing ? (
          <>
            <label htmlFor={fieldId} className="sr-only">
              {tOffers('toastField')}
            </label>
            <textarea
              id={fieldId}
              value={toast}
              maxLength={TOAST_MAX}
              rows={3}
              onChange={(e) => setToast(e.target.value)}
              className={cn('t2f-focus', s.field)}
            />
            {LINK.test(toast) ? <span className="text-caption text-primary">{tOffers('toastNoLinks')}</span> : null}
          </>
        ) : (
          <ToastBubble text={toast} onEdit={() => setEditing(true)} />
        )}
      </div>
      <div className={s.group}>
        <span className={s.label}>{t('amount')}</span>
        <Amounts />
      </div>
      <TextField
        label={t('email')}
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="name@example.com"
        hint={issue ? undefined : t('emailHint')}
        error={issue === 'empty' ? t('emailEmpty') : issue === 'invalid' ? t('emailInvalid') : undefined}
      />
      <Button type="submit" variant="coral" size="lg" disabled={bad}>
        {tOffers('tipsAction', { amount: formatUsd(amount) })}
      </Button>
      <PayNote />
    </form>
  );
}

function Badge({ icon, tone, spin }: { icon?: IconName; tone: 'gold' | 'red' | 'grey'; spin?: boolean }) {
  return (
    <span className={s.badge} data-tone={tone} aria-hidden="true">
      {spin ? <span className={s.spinner} /> : icon ? <Icon name={icon} size={32} /> : null}
    </span>
  );
}

function Status({ badge, title, text, children, extra }: { badge: ReactNode; title: string; text: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className={s.status} role="status">
      {badge}
      <h3 className={s.title}>{title}</h3>
      <p className={s.lead}>{text}</p>
      <div className={s.actions}>{children}</div>
      {extra}
    </div>
  );
}

function Help() {
  const t = useTranslations('tips');
  return (
    <p className={s.help}>
      <Icon name="help" size={16} />
      {t('helpQ')}{' '}
      <Link href="#" className="font-semibold">
        {t('help')}
      </Link>
    </p>
  );
}

export function TipsWindowContent({ onClose }: { onClose: () => void }) {
  const t = useTranslations('tips');
  const tOffers = useTranslations('offers');
  const phase: TipsPhase = useTipsStore((x) => x.phase);
  const amount = useTipsStore((x) => x.amount);
  const toast = useTipsStore((x) => x.toast) || tOffers('toastDefault');
  const { pay, toForm } = useTipsStore.getState();
  const fromBlock = useTipsStore((x) => x.fromBlock);
  const price = formatUsd(amount);

  if (phase === 'form') return <Form />;
  if (phase === 'opening')
    return (
      <Status badge={<Badge tone="gold" spin />} title={t('openingTitle')} text={t('openingText')}>
        <Button variant="secondary" size="lg" onClick={fromBlock ? onClose : toForm}>
          {t('cancel')}
        </Button>
      </Status>
    );
  if (phase === 'pending')
    return (
      <Status badge={<Badge tone="gold" icon="clock" />} title={t('pendingTitle')} text={t('pendingText')} extra={<Help />}>
        <Button variant="secondary" size="lg" onClick={onClose}>
          {t('close')}
        </Button>
      </Status>
    );
  if (phase === 'failed')
    return (
      <Status badge={<Badge tone="red" icon="alert" />} title={t('failedTitle')} text={t('failedText')} extra={<Help />}>
        <div className={s.summary}>
          <Icon name="glass" size={18} className="text-highlight" />
          <span className={s.summaryText}>{t.rich('summary', { price, b: (c) => <b className="text-text">{c}</b> })}</span>
          <button type="button" onClick={toForm} className={cn('t2f-focus', s.edit)}>
            {t('change')}
          </button>
        </div>
        <Button variant="coral" size="lg" onClick={pay}>
          {t('retry', { price })}
        </Button>
        <Button variant="secondary" size="lg" onClick={onClose}>
          {t('close')}
        </Button>
      </Status>
    );
  if (phase === 'offline')
    return (
      <Status badge={<Badge tone="grey" icon="wifi-off" />} title={t('offlineTitle')} text={t('offlineText')}>
        <Button variant="coral" size="lg" onClick={pay}>
          {t('retryShort')}
        </Button>
        <Button variant="secondary" size="lg" onClick={onClose}>
          {t('close')}
        </Button>
      </Status>
    );
  // success
  return (
    <div className={cn(s.status, s.done)} role="status" data-tips="success">
      <span className={s.confetti} aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <i key={i} />
        ))}
      </span>
      <Badge tone="gold" icon="glass" />
      <span className={s.kicker}>{t('doneKicker')}</span>
      <h3 className={s.title}>{t('doneTitle')}</h3>
      <p className={s.lead}>{t('doneText')}</p>
      <div className={s.bubbleWrap}>
        <ToastBubble text={toast} solid />
      </div>
      <div className={s.actions}>
        <Button variant="secondary" size="lg" onClick={onClose}>
          {t('close')}
        </Button>
      </div>
      <p className={s.receipt}>{t('receipt')}</p>
    </div>
  );
}

/**
 * Відкрити вікно «Чайові». `block` — з блока під штампом: одразу оплата (стан «Відкриваємо оплату…»);
 * без аргументів — форма (кнопка «Підтримати» в хедері).
 */
export function useOpenTipsWindow(): (block?: { amount: (typeof TIP_AMOUNTS)[number]; toast: string }) => void {
  const overlay = useOverlay();
  const t = useTranslations('tips');
  return useCallback(
    (block) => {
      const store = useTipsStore.getState();
      // Підтвердження ще чекаємо — показуємо його, а не починаємо нову оплату.
      if (store.phase !== 'pending') {
        if (block) store.payFromBlock(block.amount, block.toast);
        else store.toForm();
      }
      const close = () => overlay.close(TIPS_WINDOW_ID);
      overlay.open({
        id: TIPS_WINDOW_ID,
        kind: 'form',
        chrome: 'board',
        coral: true,
        title: (
          <span className={s.windowTitle}>
            <Icon name="glass" size={20} />
            {t('title')}
          </span>
        ),
        // «Чекаємо підтвердження» лишаємо — оплату підтвердять і при закритому вікні; решту — з нуля.
        onClose: () => {
          if (useTipsStore.getState().phase !== 'pending') useTipsStore.getState().reset();
        },
        content: <TipsWindowContent onClose={close} />,
      });
    },
    [overlay, t],
  );
}
