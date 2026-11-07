'use client';

/**
 * Вікно «Чайові» на місці чату, на телефоні — шторка (дошка `Desk-Tips-Toast`, рішення власника 2026-11-07, друге коло:
 * спершу тост, оплата — лише по «Оплатити»). Стани — `stores/tips`:
 * - сума $2 🥂 / $5 🍾 / $10 🎆 і «Твій тост» (поле-повідомлення, ідеї), коралова «Оплатити $N» · «Скасувати»;
 * - оплата відкрита: «Чекаємо оплату на PayPro Global», тост ще можна правити, «Скасувати»;
 * - оплачено: «Перевір тост — і в чат», «Опублікувати тост · 0:24» (сам — за 30 с);
 * - «Оплата не пройшла» / «Немає з’єднання» → «Дякуємо! Твій тост уже в чаті».
 */
import { useTranslations } from 'next-intl';
import { useCallback, useId, useState, type ReactNode } from 'react';
import { EmojiPicker } from '@/components/chat/EmojiPicker';
import { EmojiText } from '@/components/primitives/Emoji';
import { IconButton } from '@/components/primitives/IconButton';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { Link } from '@/components/primitives/Link';
import { useOverlay } from '@/components/shell/OverlayManager';
import { formatUsd, TIP_AMOUNTS } from '@/lib/offers/format';
import { useNow } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import { TOAST_AUTO_MS, useTipsStore, type TipsPhase } from '@/stores/tips';
import { TipAmounts } from './TipAmounts';
import s from './tipsWindow.module.css';

export const TIPS_WINDOW_ID = 'O-TIPS-PAY';
/** Найдовший тост — як підпис у чаті, коротко. */
export const TOAST_MAX = 120;
const LINK = /(https?:\/\/|www\.)/i;

function useWho() {
  const t = useTranslations('offers');
  const nick = useGuestStore((g) => g.nick?.trim()) || t('toastGuest');
  const flagCode = useGuestStore((g) => g.flagCode ?? g.detectedFlag);
  return { nick, flagCode };
}

/** Золотий тост — як у чаті. */
function ToastBubble({ text }: { text: string }) {
  const t = useTranslations('offers');
  const { nick, flagCode } = useWho();
  return (
    <div className={cn(s.bubble, s.bubbleSolid)}>
      <span className={s.who}>
        {flagCode ? <Flag round code={flagCode} size="xs" decorative /> : null}
        <span className={s.nick}>{nick}</span>
        <span className="t2f-toast-badge">{t('toastBadge')}</span>
      </span>
      <span className={s.text}>
        <EmojiText text={text} />
      </span>
    </div>
  );
}

function PayNote({ text }: { text?: string }) {
  const t = useTranslations('tips');
  return (
    <p className={s.note}>
      <Icon name="lock" size={14} />
      <span>
        {text ?? t('payNote')}{' '}
        <Link href="#" className="font-semibold">
          {t('terms')}
        </Link>
      </span>
    </p>
  );
}

/** Сума й тост; оплата починається лише по «Оплатити $N». */
function Form({ onCancel }: { onCancel: () => void }) {
  const t = useTranslations('tips');
  const amount = useTipsStore((x) => x.amount);
  const setAmount = useTipsStore((x) => x.setAmount);
  const toast = useTipsStore((x) => x.toast);
  const pay = useTipsStore((x) => x.pay);
  const bad = !toast.trim() || LINK.test(toast);
  return (
    <div className={s.flow} data-tips="form">
      <div className={s.flowBody}>
        <div className={s.group}>
          <span className={s.label}>{t('amount')}</span>
          <TipAmounts value={amount} onChange={setAmount} compact />
        </div>
        <h3 className={s.h}>{t('composeTitle')}</h3>
        <ToastEditor />
        <PayNote text={t('payNoteCompose')} />
      </div>
      <div className={s.flowFoot}>
        <Button variant="coral" size="lg" onClick={pay} disabled={bad} data-action="tips-pay">
          {t('payAction', { price: formatUsd(amount) })}
        </Button>
        <Button variant="secondary" size="lg" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Поле тосту у вигляді золотого повідомлення: нік, прапор, «тост», лічильник, кнопка-емодзі (власні емодзі сайту, як у
 * чаті — вставка в позицію курсора, власник 2026-11-07); ідеї — у поле одним дотиком.
 */
function ToastEditor() {
  const t = useTranslations('tips');
  const tOffers = useTranslations('offers');
  const tChat = useTranslations('chat');
  const { nick, flagCode } = useWho();
  const toast = useTipsStore((x) => x.toast);
  const setToast = useTipsStore((x) => x.setToast);
  const id = useId();
  const pickerId = useId();
  const emojiBtnId = useId();
  const [picker, setPicker] = useState<{ kb: boolean } | null>(null);
  const closePicker = useCallback(
    (opts?: { restoreFocus?: boolean }) => {
      setPicker(null);
      if (opts?.restoreFocus) requestAnimationFrame(() => document.getElementById(emojiBtnId)?.focus());
    },
    [emojiBtnId],
  );
  const insertEmoji = (symbol: string) => {
    const el = document.getElementById(id) as HTMLTextAreaElement | null;
    const start = el?.selectionStart ?? toast.length;
    const end = el?.selectionEnd ?? start;
    const next = toast.slice(0, start) + symbol + toast.slice(end);
    if (next.length > TOAST_MAX) return;
    setToast(next);
    const caret = start + symbol.length;
    requestAnimationFrame(() => (document.getElementById(id) as HTMLTextAreaElement | null)?.setSelectionRange(caret, caret));
  };
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Esc закриває вибір емодзі
    <div
      className={s.editor}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && picker) {
          e.preventDefault();
          e.stopPropagation();
          closePicker({ restoreFocus: true });
        }
      }}
    >
      <div className={cn(s.bubble, s.editBubble)}>
        <span className={s.who}>
          {flagCode ? <Flag round code={flagCode} size="xs" decorative /> : null}
          <span className={s.nick}>{nick}</span>
          <span className="t2f-toast-badge">{tOffers('toastBadge')}</span>
          <span className={s.counter} aria-hidden="true">
            {toast.length} / {TOAST_MAX}
          </span>
          <IconButton
            id={emojiBtnId}
            icon="smile"
            compact
            aria-label={tChat('emojiButton')}
            aria-haspopup="dialog"
            aria-expanded={picker !== null}
            aria-controls={picker ? pickerId : undefined}
            data-emoji-trigger=""
            onClick={(e) => setPicker((p) => (p ? null : { kb: e.detail === 0 }))}
            className={s.emojiBtn}
          />
        </span>
        <label htmlFor={id} className="sr-only">
          {tOffers('toastField')}
        </label>
        <textarea
          id={id}
          value={toast}
          maxLength={TOAST_MAX}
          rows={2}
          onChange={(e) => setToast(e.target.value)}
          data-toast-field=""
          className={cn('t2f-focus', s.editField)}
        />
      </div>
      {picker ? (
        <div className={s.picker}>
          <EmojiPicker id={pickerId} onInsert={insertEmoji} onClose={closePicker} focusFirst={picker.kb} />
        </div>
      ) : null}
      {LINK.test(toast) ? <span className="text-caption text-primary">{tOffers('toastNoLinks')}</span> : null}
      <div className={s.ideas} role="group" aria-label={t('ideas')}>
        {(['one', 'two', 'three'] as const).map((k) => (
          <button key={k} type="button" aria-label={t(`idea.${k}`)} onClick={() => setToast(t(`idea.${k}`))} className={cn('t2f-focus', s.idea)}>
            <EmojiText text={t(`idea.${k}`)} />
          </button>
        ))}
      </div>
    </div>
  );
}

function Row({ badge, title, text }: { badge: ReactNode; title: string; text: string }) {
  return (
    <div className={s.row} role="status">
      {badge}
      <span className={s.rowText}>
        <b>{title}</b>
        <span>{text}</span>
      </span>
    </div>
  );
}

/** Оплата відкрита: «Чекаємо оплату на PayPro Global»; тост ще можна правити. */
function Paying({ onCancel }: { onCancel: () => void }) {
  const t = useTranslations('tips');
  return (
    <div className={s.flow} data-tips="paying">
      <div className={s.flowBody}>
        <Row badge={<span className={s.spinnerSm} aria-hidden="true" />} title={t('payingTitle')} text={t('payingText')} />
        <h3 className={s.h}>{t('composeTitle')}</h3>
        <ToastEditor />
        <p className={s.small}>{t('writeNote')}</p>
      </div>
      <div className={s.flowFoot}>
        <Button variant="secondary" size="lg" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}

/** Оплачено: «Перевір тост — і в чат» і «Опублікувати тост · 0:24» (сам — за 30 с). */
function Paid() {
  const t = useTranslations('tips');
  const amount = useTipsStore((x) => x.amount);
  const paidAt = useTipsStore((x) => x.paidAt) ?? 0;
  const toast = useTipsStore((x) => x.toast);
  const publish = useTipsStore((x) => x.publish);
  const now = useNow();
  const left = Math.min(TOAST_AUTO_MS / 1000, Math.max(0, Math.ceil((paidAt + TOAST_AUTO_MS - now) / 1000)));
  const bad = !toast.trim() || LINK.test(toast);
  return (
    <div className={s.flow} data-tips="paid">
      <div className={s.flowBody}>
        <Row
          badge={
            <span className={s.okBadge} aria-hidden="true">
              <Icon name="check" size={16} strokeWidth={2.6} />
            </span>
          }
          title={t('paidTitle', { price: formatUsd(amount) })}
          text={t('paidText')}
        />
        <h3 className={s.h}>{t('checkTitle')}</h3>
        <ToastEditor />
        <p className={s.small}>{t('autoNote')}</p>
      </div>
      <div className={s.flowFoot}>
        <Button variant="coral" size="lg" onClick={publish} disabled={bad} className={s.wide} data-action="publish-toast">
          {t('publish', { time: `0:${String(left).padStart(2, '0')}` })}
        </Button>
      </div>
    </div>
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
  const phase: TipsPhase = useTipsStore((x) => x.phase);
  const amount = useTipsStore((x) => x.amount);
  const toast = useTipsStore((x) => x.toast);
  const { pay, toForm } = useTipsStore.getState();
  const fromBlock = useTipsStore((x) => x.fromBlock);
  const price = formatUsd(amount);

  if (phase === 'form') return <Form onCancel={onClose} />;
  if (phase === 'paying') return <Paying onCancel={fromBlock ? onClose : toForm} />;
  if (phase === 'paid') return <Paid />;
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
        <ToastBubble text={toast} />
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
 * Відкрити вікно «Чайові»: сума й тост, «Оплатити $N». `block` — з блока (під штампом, сторінка «Підтримати») з його
 * сумою; без аргументів — кнопка «Підтримати» в хедері.
 */
export function useOpenTipsWindow(): (block?: { amount: (typeof TIP_AMOUNTS)[number] }) => void {
  const overlay = useOverlay();
  const t = useTranslations('tips');
  const defaultToast = useTranslations('offers')('toastDefault');
  return useCallback(
    (block) => {
      const store = useTipsStore.getState();
      // Оплата вже йде чи оплачено (тост ще не в чаті) — показуємо її, а не починаємо нову.
      if (store.phase !== 'paying' && store.phase !== 'paid') {
        if (block) store.openFromBlock(block.amount, defaultToast);
        else {
          store.toForm();
          if (!store.toast) store.setToast(defaultToast);
        }
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
        // Оплата йде чи оплачено — лишаємо: підтвердять і тост опублікуємо й при закритому вікні; решту — з нуля.
        onClose: () => {
          const phase = useTipsStore.getState().phase;
          if (phase !== 'paying' && phase !== 'paid') useTipsStore.getState().reset();
        },
        content: <TipsWindowContent onClose={close} />,
      });
    },
    [overlay, t, defaultToast],
  );
}
