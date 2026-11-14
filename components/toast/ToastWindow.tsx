'use client';

/**
 * Вікно «Сказати тост» — головний платний продукт (дошки `Desk-Toast-New` · «3 · Вікно тосту», `Phone-Toast-New` ·
 * «3 · Вікно тосту (шторка)», «4 · Оплата й результат», v2; рішення власника 2026-11-12; замінює вікно «Чайові»).
 * Десктоп — вікно 340 px на місці чату (не модальне), телефон — шторка до низу відео; вміст прокручується, кнопки
 * дій закріплені внизу. Стани — `stores/toast`:
 * - крок 1: «Обери тост» — $2 келих · $5 пляшка ігристого (за замовчуванням) · $10 феєрверк (без позначки «найвигідніше» — рішення
 *   власника 2026-11-13: незрозуміло, чим саме); під плитками — що дає рівень (галочки; решта сіра з «з $N»; з пасом — «Новорічний пас у тебе вже є»);
 *   «Твій тост» — поле як повідомлення в чаті (нік, прапор, «тост», лічильник до 120, емодзі), ідеї-чипси, правило;
 *   підпис (нік і прапор, «Змінити»); гість без ніку — «Як підписати тост?» тут же, «Оплатити» неактивна до дійсного
 *   ніку (тост ніколи не підписують «Гість»); примітка про оплату; внизу «Оплатити $N · Скасувати»;
 * - фільтр на «Оплатити» (`lib/toast/filter`): «Тост не пройшов перевірку — зміни текст», проблемне місце підкреслено,
 *   оплата неактивна, доки текст не змінено;
 * - «Чекаємо оплату на PayPro Global» (тост уже не змінити) · «Відкрити оплату · Скасувати»;
 * - «Оплата не пройшла» · «Спробувати ще — $N · Скасувати»; «Немає з’єднання»;
 * - «Тост опубліковано» за рівнем; $10 — «Пас активний» (увійшов) або «Новорічний пас — подарунок до тосту» з
 *   «Увійти й активувати пас» (гість: пас належить акаунту, рішення 2026-11-10).
 * Відкрити — `useOpenToastWindow()` (смуга тостів, келих у чаті, «Сказати тост» у шапці, «Скажи тост за $10» у пасі) —
 * лише поки свято йде (рішення власника 2026-11-13).
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useOpenAuthWindow } from '@/components/auth/AuthWindow';
import { EmojiPicker } from '@/components/chat/EmojiPicker';
import { useOpenPassWindow, usePassDetails } from '@/components/pass/PassWindow';
import { cn } from '@/components/primitives/cn';
import { Emoji, EmojiText } from '@/components/primitives/Emoji';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { useChatColumn, useOverlay } from '@/components/shell/OverlayManager';
import { FlagField } from '@/components/windows/FlagField';
import { validateNick, type NickIssue } from '@/lib/chat/nick';
import { NICK_MAX } from '@/lib/chat/send';
import { chatActions } from '@/lib/api/hooks/chat';
import { getData } from '@/lib/data/load';
import { detectFlag } from '@/lib/geo/detectFlag';
import { formatUsd, PASS_PRICE } from '@/lib/offers/format';
import { canSayToast } from '@/lib/toast/season';
import { useTimeSource } from '@/lib/time/TimeProvider';
import { tierBenefits, TOAST_MAX, TOAST_TIERS, type ToastTier } from '@/lib/toast/tiers';
import { signatureReady, useToastStore } from '@/stores/toast';
import { ToastBubble, ToastPill } from './ToastBubble';
import s from './toastWindow.module.css';
import { profileActions, useHasPass, useProfile } from '@/lib/api/hooks/auth';

export const TOAST_WINDOW_ID = 'O-TOAST';

/** Емодзі рівня (фірмові значки). */
export const TIER_EMOJI: Record<ToastTier, string> = { 2: '🥂', 5: '🍾', 10: '🎆' };
const PHRASES = ['one', 'two', 'three', 'four'] as const;

const flagOptions = () => getData().countries.map((c) => ({ code: c.flagCode, name: c.name.uk }));

/**
 * Плитки рівнів: радіогрупа «$2 · келих», «$5 · пляшка ігристого», «$10 · феєрверк». Без `onChange` — лише показ
 * (список, нічого не обрано): «Тости світу» до свята, коли тост ще не сказати (рішення власника 2026-11-13).
 */
export function ToastTiers({ value, onChange, phone }: { value?: ToastTier; onChange?: (v: ToastTier) => void; phone?: boolean }) {
  const t = useTranslations('toast');
  if (!onChange) {
    return (
      <ul aria-label={t('tiersLabel')} className={s.tiers} data-phone={phone || undefined} data-readonly="">
        {TOAST_TIERS.map((tier) => (
          <li key={tier} className={s.tier} data-tier={tier}>
            <Emoji char={TIER_EMOJI[tier]} size={19} />
            <b className={s.tierPrice}>{formatUsd(tier)}</b>
            <span className={s.tierName}>{t(`tiers.${tier}`)}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div role="radiogroup" aria-label={t('chooseTitle')} className={s.tiers} data-phone={phone || undefined}>
      {TOAST_TIERS.map((tier) => (
        <button
          key={tier}
          type="button"
          role="radio"
          aria-checked={tier === value}
          aria-label={t('tierLabel', { price: formatUsd(tier), name: t(`tiers.${tier}`) })}
          onClick={() => onChange(tier)}
          className={cn('t2f-focus', s.tier)}
          data-tier={tier}
        >
          <Emoji char={TIER_EMOJI[tier]} size={19} />
          <b className={s.tierPrice}>{formatUsd(tier)}</b>
          <span className={s.tierName}>{t(`tiers.${tier}`)}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Що дає обраний рівень (галочки) — під плитками. `readOnly` — без обраного рівня: усі пункти з рівнем, з якого діють
 * («з $2», «з $5», «з $10»), — «Тости світу» до свята.
 */
export function ToastBenefits({ tier, hasPass, readOnly }: { tier?: ToastTier; hasPass: boolean; readOnly?: boolean }) {
  const t = useTranslations('toast.benefits');
  if (readOnly || tier === undefined) {
    return (
      <ul className={s.benefits} aria-label={t('label')} data-toast-benefits="all">
        {tierBenefits(10, false).map((b) => (
          <li key={b.key} className={s.benefit} data-on="" data-benefit={b.key}>
            <span className={s.mark} aria-hidden="true">
              <Icon name="check" size={12} strokeWidth={3} />
            </span>
            <span className={s.benefitText}>{t(b.key)}</span>
            <span className={s.from}>{t('from', { price: formatUsd(b.from) })}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className={s.benefits} aria-label={t('label')} data-toast-benefits={tier}>
      {tierBenefits(tier, hasPass).map((b) =>
        b.owned ? (
          <li key={b.key} className={s.benefit} data-owned="">
            <span className={s.ownedIcon} aria-hidden="true">
              <Icon name="ticket" size={14} />
            </span>
            <span className={s.benefitText}>{t('passOwned')}</span>
          </li>
        ) : (
          <li key={b.key} className={s.benefit} data-on={b.included || undefined} data-benefit={b.key}>
            <span className={s.mark} aria-hidden="true">
              {b.included ? <Icon name="check" size={12} strokeWidth={3} /> : null}
            </span>
            <span className={s.benefitText}>
              {t(b.key)}
              {b.key === 'pass' && b.included ? <span className={s.apart}> {t('passApart', { price: formatUsd(PASS_PRICE) })}</span> : null}
              <span className="sr-only"> — {b.included ? t('included') : t('notIncluded')}</span>
            </span>
            {b.included ? null : (
              <span className={s.from} aria-hidden="true">
                {t('from', { price: formatUsd(b.from) })}
              </span>
            )}
          </li>
        ),
      )}
    </ul>
  );
}

/** Текст із підкресленим проблемним місцем — «дзеркало» під полем (той самий кегль і перенос). */
function Mirror({ text, start, end }: { text: string; start: number; end: number }) {
  return (
    <div aria-hidden="true" className={s.mirror}>
      {text.slice(0, start)}
      <span className={s.bad} data-toast-bad="">
        {text.slice(start, end)}
      </span>
      {text.slice(end)}
      {'​'}
    </div>
  );
}

function Who({ nick, flagCode }: { nick?: string; flagCode?: string }) {
  const t = useTranslations('toast');
  return nick ? (
    <>
      {flagCode ? <Flag code={flagCode} size="xs" decorative /> : null}
      <b className={s.fieldNick}>{nick}</b>
    </>
  ) : (
    <>
      <span className={s.noFlag} aria-hidden="true" />
      <b className={s.fieldNick} data-empty="">
        {t('yourNick')}
      </b>
    </>
  );
}

/** Поле тосту: нік і прапор, «тост», лічильник, емодзі (вибір — у потоці під полем), текст до 120. */
function ToastField({ nick, flagCode }: { nick?: string; flagCode?: string }) {
  const t = useTranslations('toast');
  const tc = useTranslations('chat');
  const text = useToastStore((x) => x.text);
  const issue = useToastStore((x) => x.issue);
  const setText = useToastStore((x) => x.setText);
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
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? start;
    const next = text.slice(0, start) + symbol + text.slice(end);
    if (next.length > TOAST_MAX) return;
    setText(next);
    const caret = start + symbol.length;
    requestAnimationFrame(() => (document.getElementById(id) as HTMLTextAreaElement | null)?.setSelectionRange(caret, caret));
  };
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Esc закриває вибір емодзі
    <div
      onKeyDown={(e) => {
        if (e.key === 'Escape' && picker) {
          e.preventDefault();
          e.stopPropagation();
          closePicker({ restoreFocus: true });
        }
      }}
      className="flex flex-col gap-2"
    >
      <div className={s.field} data-error={issue ? '' : undefined} data-toast-field="">
        <div className={s.fieldHead}>
          <Who nick={nick} flagCode={flagCode} />
          <ToastPill />
          <span className="flex-1" />
          <span className={s.counter} aria-hidden="true">
            {text.length} / {TOAST_MAX}
          </span>
          <IconButton
            id={emojiBtnId}
            icon="smile"
            compact
            aria-label={tc('emojiButton')}
            aria-haspopup="dialog"
            aria-expanded={picker !== null}
            aria-controls={picker ? pickerId : undefined}
            data-emoji-trigger=""
            onClick={(e) => setPicker((p) => (p ? null : { kb: e.detail === 0 }))}
            className={s.emojiBtn}
          />
        </div>
        <div className={s.area}>
          {issue ? <Mirror text={text} start={issue.start} end={issue.end} /> : null}
          <label htmlFor={id} className="sr-only">
            {t('field')}
          </label>
          <textarea
            id={id}
            value={text}
            maxLength={TOAST_MAX}
            rows={1}
            placeholder={t('placeholder')}
            aria-invalid={issue ? true : undefined}
            onChange={(e) => setText(e.target.value)}
            className={cn('t2f-focus', s.textarea)}
            data-toast-text=""
          />
        </div>
      </div>
      {picker ? (
        <div className={s.picker}>
          <EmojiPicker id={pickerId} onInsert={insertEmoji} onClose={closePicker} focusFirst={picker.kb} />
        </div>
      ) : null}
    </div>
  );
}

function Phrases() {
  const t = useTranslations('toast');
  const text = useToastStore((x) => x.text);
  const setText = useToastStore((x) => x.setText);
  return (
    <div className={s.chips} role="group" aria-label={t('ideas')}>
      {PHRASES.map((k) => {
        const p = t(`phrases.${k}`);
        return (
          <button key={k} type="button" aria-pressed={text === p} aria-label={p} onClick={() => setText(p)} className={cn('t2f-focus', s.chip)}>
            <EmojiText text={p} />
          </button>
        );
      })}
    </div>
  );
}

/** Підпис: нік і прапор (дійсний нік), або «Як підписати тост?» — гість, «Змінити». */
function Signature({
  editing,
  draftNick,
  draftFlag,
  onEdit,
  onNick,
  onFlag,
  issue,
}: {
  editing: boolean;
  draftNick: string;
  draftFlag: string;
  onEdit: () => void;
  onNick: (v: string) => void;
  onFlag: (v: string) => void;
  issue: NickIssue | null;
}) {
  const t = useTranslations('toast');
  const tc = useTranslations('chat.nick');
  const w = useTranslations('windows.nick');
  const detected = useProfile()?.detectedFlag ?? undefined;
  const [flagOpen, setFlagOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const flags = useMemo(() => flagOptions(), []);
  const id = useId();
  if (!editing) {
    return (
      <div className={s.sig} data-toast-signature="">
        <Flag code={draftFlag} diameter={28} decorative />
        <span className={s.sigText}>
          <span className={s.sigLabel}>{t('signature')}</span>
          <b className={s.sigNick}>{draftNick}</b>
        </span>
        <button type="button" onClick={onEdit} className={cn('t2f-focus', s.textLink)}>
          {t('change')}
        </button>
      </div>
    );
  }
  const shown = touched && draftNick.length > 0 ? issue : null;
  const err = shown
    ? shown === 'taken'
      ? w('taken')
      : shown === 'forbidden'
        ? w('forbidden')
        : shown === 'link'
          ? tc('errors.link')
          : shown === 'long'
            ? tc('errors.long')
            : tc('errors.short')
    : null;
  return (
    <section className={s.guest} aria-labelledby={`${id}-t`} data-toast-guest="">
      <h4 id={`${id}-t`} className={s.guestTitle}>
        {t('guest.title')}
      </h4>
      <p className={s.guestSub}>{t('guest.sub')}</p>
      <div className={s.guestRow}>
        <button
          type="button"
          aria-label={t('guest.flag')}
          aria-expanded={flagOpen}
          onClick={() => setFlagOpen((v) => !v)}
          className={cn('t2f-focus', s.flagBtn)}
        >
          <Flag code={draftFlag} diameter={24} decorative />
          <Icon name="chevron-down" size={14} />
        </button>
        <span className={s.nickBox} data-error={err ? '' : undefined}>
          <label htmlFor={`${id}-n`} className="sr-only">
            {t('guest.nick')}
          </label>
          <input
            id={`${id}-n`}
            type="text"
            value={draftNick}
            autoComplete="nickname"
            maxLength={NICK_MAX + 5}
            aria-invalid={err ? true : undefined}
            aria-describedby={`${id}-h`}
            onChange={(e) => onNick(e.target.value)}
            onBlur={() => setTouched(true)}
            className={s.nickInput}
            data-toast-nick=""
          />
          <span className={s.counter} aria-hidden="true">
            {draftNick.length} / {NICK_MAX}
          </span>
        </span>
      </div>
      {flagOpen ? (
        <div className={s.flagPick}>
          <FlagField
            value={draftFlag}
            onChange={(code) => {
              onFlag(code);
              setFlagOpen(false);
            }}
            detectedFlag={detected}
            undetected={!detected}
            openIfUnknown
            flags={flags}
          />
        </div>
      ) : null}
      {err ? (
        <p className={s.guestErr} role="alert">
          {err}
        </p>
      ) : null}
      <p id={`${id}-h`} className={s.guestHint}>
        {detected ? t('guest.hint') : t('guest.hintUndetected')}
      </p>
    </section>
  );
}

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

function Foot({ children }: { children: ReactNode }) {
  return <div className={s.foot}>{children}</div>;
}

/** Ніки-підказки «зайнято» (сервіс чату; у `sim` — автори сценарію). */
const takenNicks = () => chatActions.takenNicks();

/** Крок 1: рівень, тост, підпис, «Оплатити $N · Скасувати». */
function Compose({ onCancel, phone }: { onCancel: () => void; phone: boolean }) {
  const t = useTranslations('toast');
  const tier = useToastStore((x) => x.tier);
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
  const blocked = !text.trim() || !!issue || !nickOk;
  const ref = useRef<HTMLDivElement>(null);
  const pay = () => {
    if (blocked) return;
    // Нік і прапор — профіль (шов, залишки E5); у `sim` запис синхронний — оплата нижче бачить новий підпис.
    if (editing) void profileActions.update({ nick: draftNick.trim(), flagCode: draftFlag });
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
        />
        <PayNote />
      </div>
      <Foot>
        <div className={s.footRow}>
          <button type="button" disabled={blocked} onClick={pay} className={cn('t2f-focus', s.coral)} data-action="toast-pay" title={!nickOk ? t('payNeedsNick') : undefined}>
            {t('pay', { price: formatUsd(tier) })}
          </button>
          <button type="button" onClick={onCancel} className={cn('t2f-focus', s.line)}>
            {t('cancel')}
          </button>
        </div>
      </Foot>
    </div>
  );
}

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

function Paying({ onCancel }: { onCancel: () => void }) {
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

function Failed({ onCancel, offline }: { onCancel: () => void; offline?: boolean }) {
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

/** Подарунок до тосту за $10: «Пас активний» (увійшов) чи «Увійти й активувати пас» (гість). */
function PassGiftCard() {
  const t = useTranslations('toast');
  const gift = useToastStore((x) => x.gift);
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
  return (
    <div className={s.passCard} data-toast-gift="pending">
      <div className={s.passHead}>
        <span className={s.passIcon} aria-hidden="true">
          <Icon name="ticket" size={18} />
        </span>
        <p className={cn(s.passTitle, 'flex-1')}>{t('passGift.title')}</p>
      </div>
      <p className={s.passText}>{t('passGift.text')}</p>
      <button
        type="button"
        onClick={() => openAuth('signin', { afterSignIn: openPass })}
        className={cn('t2f-focus', s.coral, s.passAction)}
        data-action="toast-gift-signin"
      >
        {t('passGift.action')}
      </button>
    </div>
  );
}

function Done({ onClose, phone }: { onClose: () => void; phone: boolean }) {
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

export function ToastWindowContent({ onClose }: { onClose: () => void }) {
  const phase = useToastStore((x) => x.phase);
  // Шторка (телефон, планшет-портрет): плитки 92 px, успіх $10 — компактний (дошка `Phone-Toast-New`).
  const phone = !useChatColumn();
  const ref = useRef<HTMLDivElement>(null);
  // Новий крок — вміст з початку, а не з місця, до якого прокрутили попередній.
  useEffect(() => {
    for (let el = ref.current?.parentElement; el; el = el.parentElement) {
      if (el.scrollTop > 0) el.scrollTop = 0;
      if (el.hasAttribute('data-chat-slot-panel')) break;
    }
  }, [phase]);
  return (
    <div ref={ref} data-window={TOAST_WINDOW_ID} data-phase={phase} className="flex min-h-full flex-col">
      {phase === 'paying' ? (
        <Paying onCancel={() => useToastStore.getState().toForm()} />
      ) : phase === 'failed' || phase === 'offline' ? (
        <Failed onCancel={onClose} offline={phase === 'offline'} />
      ) : phase === 'success' ? (
        <Done onClose={onClose} phone={phone} />
      ) : (
        <Compose onCancel={onClose} phone={phone} />
      )}
    </div>
  );
}

/** Відкрити вікно тосту з цим рівнем ($10 — з «Скажи тост за $10»), без — $5 за замовчуванням. */
export type OpenToastWindow = (opts?: { tier?: ToastTier }) => void;

/**
 * Відкрити «Сказати тост» — одна дія для всіх входів: смуга тостів, келих у полі чату, «Сказати тост» у шапці й на
 * «Тостах світу» (`/support/`), «Скажи тост за $10» у пасі, картка штампа. Оплата вже йде — вікно покаже її, а не почне нову.
 * Лише поки свято йде (`canSayToast`, рішення власника 2026-11-13): до й після свята — нічого не робить, щоб застаріле
 * посилання (`/support/?toast=10`) чи кнопка, що не встигла зникнути, не відкрили оплату. Час — у мить дотику.
 */
export function useOpenToastWindow(): OpenToastWindow {
  const overlay = useOverlay();
  const time = useTimeSource();
  const t = useTranslations('toast');
  const defaultText = t('phrases.one');
  return useCallback(
    (opts) => {
      if (!canSayToast(time.now(), getData())) return;
      useToastStore.getState().prepare(opts?.tier, defaultText);
      const close = () => overlay.close(TOAST_WINDOW_ID);
      overlay.open({
        id: TOAST_WINDOW_ID,
        kind: 'form',
        chrome: 'board',
        coral: true,
        title: (
          <span className={s.windowTitle}>
            <Icon name="glass" size={20} />
            {t('title')}
          </span>
        ),
        onClose: () => useToastStore.getState().closed(),
        content: <ToastWindowContent onClose={close} />,
      });
    },
    [overlay, time, t, defaultText],
  );
}
