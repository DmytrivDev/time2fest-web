'use client';

/**
 * C8 O-PAY і суміжні стани вікна «Перший ряд»: очікування підтвердження (`pending`), успіх із квитком (`success`),
 * «місце щойно зайняли» (`soldout`), зміна напису й емоції (`edit`), а також тонкі обгортки над формою
 * для `declined` і `expired`. Лише тіло вікна (заголовок і «Закрити» дає контейнер). Вигляд — макети `Desk-FR-*` /
 * `Phone-FR-*` (`firstRowWindow.module.css`).
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import type {
  FirstRowEditProps,
  FirstRowFormProps,
  FirstRowPendingProps,
  FirstRowSoldOutProps,
  FirstRowSuccessProps,
} from '@/components/firstrow/types';
import { EMOJI_SYMBOLS } from '@/components/live/SeatPill';
import { canonicalEmotion } from '@/lib/firstrow/emotions';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { Link } from '@/components/primitives/Link';
import { FirstRowEmojiPick, FirstRowField, FirstRowForm, FirstRowPreview } from '@/components/windows/FirstRowForm';
import s from '@/components/windows/firstRowWindow.module.css';
import { PostcardArt, StampMark } from '@/components/windows/StampArt';
import type { Ms } from '@/lib/data/types';
import { GREETING_MAX, NAME_MAX } from '@/lib/firstrow/pay';
import { formatClock } from '@/lib/i18n/time';

function TermsLink() {
  const t = useTranslations('firstRow');
  return (
    <Link href="/legal/terms" className={s.terms}>
      {t('form.terms')}
    </Link>
  );
}

/* ───────────── declined / expired: та сама форма з рядком причини ───────────── */

export type FirstRowDeclinedProps = Omit<FirstRowFormProps, 'notice'>;

export function FirstRowDeclined(props: FirstRowDeclinedProps) {
  return <FirstRowForm {...props} notice={{ kind: 'declined' }} />;
}

export type FirstRowExpiredProps = Omit<FirstRowFormProps, 'notice'> & {
  /** Що змінилось після закінчення утримання: скільки місць, нова ціна, до якого часу тримаємо знову. */
  expired: { free: number; price: number; holdUntil: Ms; priceChanged: boolean };
};

export function FirstRowExpired({ expired, ...props }: FirstRowExpiredProps) {
  return <FirstRowForm {...props} notice={{ kind: 'expired', ...expired }} />;
}

/* ───────────── pending ───────────── */

export function FirstRowPending({ city, flagCode, preview, holdUntil, email, onClose, onHelp, className }: FirstRowPendingProps) {
  const t = useTranslations('firstRow');
  return (
    <section
      data-window="O-PAY"
      data-phase="pending"
      aria-label={t('heading', { city })}
      className={cn(s.body, s.pendingBody, className)}
    >
      <div role="status" aria-live="polite" className={s.status} data-row="pending-status">
        <svg className={s.spinner} width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <circle cx="24" cy="24" r="20" stroke="var(--color-border)" strokeWidth="4" />
          <path d="M24 4a20 20 0 0 1 20 20" stroke="var(--color-highlight)" strokeWidth="4" strokeLinecap="round" />
        </svg>
        <h3 className={s.statusTitle}>{t('pending.title')}</h3>
        <p className={s.statusText}>{t('pending.body')}</p>
      </div>
      <FirstRowPreview name={preview.name} emojiId={preview.emojiId} flagCode={flagCode} loose>
        <p className={s.holdLine} data-row="hold-until">
          <Icon name="clock" size={16} />
          {t('holdUntil', { time: formatClock(holdUntil) })}
        </p>
      </FirstRowPreview>
      <p className={s.smallNote}>{t('pending.closeNote', { email })}</p>
      <Button type="button" variant="secondary" size="lg" className="w-full" onClick={onClose}>
        {t('pending.close')}
      </Button>
      <p className={s.helpRow}>
        {t('pending.problem')}
        {onHelp ? (
          <button type="button" className={cn(s.helpLink, 't2f-focus')} onClick={onHelp}>
            {t('form.help')}
          </button>
        ) : null}
      </p>
    </section>
  );
}

/* ───────────── success + ticket ───────────── */

interface TicketProps {
  city: string;
  cityId: string;
  seat: number;
  name: string;
  flagCode: string;
  emojiId: string;
  greeting: string;
  ticketCode: string;
}

/** Квиток «Перший ряд»: листівка зі штемпелем, ім’я, емоція, привітання, ряд місць і корінець (макет `Desk-FR-Success`). */
function Ticket({ city, cityId, seat, name, flagCode, emojiId, greeting, ticketCode }: TicketProps) {
  const t = useTranslations('firstRow');
  return (
    <div role="img" aria-label={t('ticket.label', { city, n: seat, name })} data-ticket="" className={s.ticket}>
      <div aria-hidden="true" className={s.ticketMain}>
        <div className={s.ticketArt}>
          <PostcardArt illustrationId={cityId} />
          <StampMark text={`${t('ticket.brand')} · ${city}`.toUpperCase()} className={s.ticketStamp} />
        </div>
        <div className={s.ticketWho}>
          <p className={s.ticketName}>
            <Flag code={flagCode} size="pill" decorative />
            <span className={s.ticketNameText}>{name}</span>
            <span className={s.ticketEmoji}>{EMOJI_SYMBOLS[canonicalEmotion(emojiId)] ?? '✨'}</span>
          </p>
          {greeting ? <p className={s.ticketGreeting}>«{greeting}»</p> : null}
          <div className={s.ticketDots}>
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} data-mine={i + 1 === seat ? '' : undefined} />
            ))}
          </div>
        </div>
      </div>
      <div aria-hidden="true" className={s.ticketStub}>
        <p className={s.stubCol}>
          <span className={s.stubKey}>{t('ticket.row')}</span>
          <span className={s.stubVal}>{t('ticket.rowValue')}</span>
        </p>
        <p className={s.stubCol}>
          <span className={s.stubKey}>{t('ticket.seat')}</span>
          <span className={s.stubSeat}>{seat}</span>
        </p>
        <p className={s.stubMeta}>
          <strong>{t('ticket.date')}</strong>
          <span>{t('ticket.time')}</span>
          <span>{city}</span>
          <span>{t('ticket.no', { code: ticketCode })}</span>
        </p>
      </div>
      <span aria-hidden="true" className={cn(s.notch, s.notchTop)} />
      <span aria-hidden="true" className={cn(s.notch, s.notchBottom)} />
    </div>
  );
}

export function FirstRowSuccess({
  city,
  cityId,
  midnightMs,
  seat,
  name,
  flagCode,
  emojiId,
  greeting,
  email,
  pass,
  ticketCode,
  onShare,
  onEdit,
  className,
}: FirstRowSuccessProps) {
  const t = useTranslations('firstRow');
  const names = useTranslations('windows.emoji.names');
  const emotion = canonicalEmotion(emojiId);
  return (
    <section
      data-window="O-PAY"
      data-phase="success"
      aria-label={t('heading', { city })}
      className={cn(s.body, className)}
    >
      <p role="status" className="sr-only" data-row="success-status">
        {t('success.title')}
      </p>
      <h3 className={s.title}>{t('success.youAre', { city })}</h3>
      <div className={s.seatRow}>
        <span className={s.mine}>
          <Flag code={flagCode} size="pill" decorative />
          {name}
          {names.has(emotion) ? (
            <span role="img" aria-label={names(emotion)} className={s.pillEmoji}>
              {EMOJI_SYMBOLS[emotion] ?? '✨'}
            </span>
          ) : null}
        </span>
        <span>
          {t('success.seat')} <span className={s.seatNo}>{seat}</span>
        </span>
      </div>
      <p className={s.passLine} data-row="pass">
        <Icon name="ticket" size={18} />
        {pass === 'gifted' ? t('success.passGifted') : t('success.passDiscount')}
      </p>

      <Ticket city={city} cityId={cityId} seat={seat} name={name} flagCode={flagCode} emojiId={emojiId} greeting={greeting} ticketCode={ticketCode} />

      <div className={s.actions}>
        {onShare ? (
          <Button type="button" variant="coral" size="lg" className="w-full" iconLeft="share" data-action="share" onClick={onShare}>
            {t('success.share')}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" className="w-full" data-action="edit" onClick={onEdit}>
          {t('success.edit')}
        </Button>
        <p className={s.hint}>{t('success.moderationNote')}</p>
      </div>

      <p className={s.callout}>
        <span role="img" aria-label="Time2Fest" className={s.calloutMark}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 1l2.6 8.4L23 12l-8.4 2.6L12 23l-2.6-8.4L1 12l8.4-2.6z" />
          </svg>
        </span>
        <span>
          {t.rich('success.midnight', {
            time: formatClock(midnightMs),
            b: (chunks) => <span className={s.calloutTime}>{chunks}</span>,
          })}
        </span>
      </p>

      <div className={s.footer}>
        <span>{t('success.mail', { email })}</span>
        <TermsLink />
      </div>
    </section>
  );
}

/* ───────────── sold out ───────────── */

export function FirstRowSoldOut({ city, onBack, otherHref, className }: FirstRowSoldOutProps) {
  const t = useTranslations('firstRow');
  return (
    <section
      data-window="O-PAY"
      data-phase="soldout"
      aria-label={t('heading', { city })}
      className={cn(s.body, className)}
    >
      <span aria-hidden="true" className={s.soldIcon}>
        <Icon name="seat" size={22} />
      </span>
      <div role="alert" data-row="soldout-status" className="flex flex-col gap-3">
        <h3 className={s.soldTitle}>{t('soldOutWin.title')}</h3>
        <p className={s.soldText}>
          <strong>{t('soldOutWin.money')}</strong> {t('soldOutWin.city', { city })}
        </p>
      </div>
      <div role="img" aria-label={t('soldOutWin.none')} className={s.dots}>
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} />
        ))}
      </div>
      <p className={s.dotsNote}>{t('soldOutWin.none')}</p>
      <Button type="button" variant="coral" size="lg" className={cn('w-full', s.gapTop)} data-action="back" onClick={onBack}>
        {t('soldOutWin.back')}
      </Button>
      <Button asChild variant="secondary" size="lg" className="w-full">
        <NextLink href={otherHref}>{t('soldOutWin.other')}</NextLink>
      </Button>
    </section>
  );
}

/* ───────────── edit ───────────── */

export function FirstRowEdit({ flagCode, values, onChange, emojiWaitSec, errors, onSave, onCancel, className }: FirstRowEditProps) {
  const t = useTranslations('firstRow');
  const w = useTranslations('windows.emoji');
  return (
    <form
      noValidate
      data-window="O-PAY"
      data-phase="edit"
      aria-label={t('edit.title')}
      className={cn(s.body, className)}
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <FirstRowField
        label={t('form.name')}
        qualifier={t('form.nameHint')}
        value={values.name}
        onValueChange={(name) => onChange({ name })}
        max={NAME_MAX}
        counter
        liveCounter
        autoComplete="nickname"
        error={errors?.name ? t('form.nameError') : undefined}
      />
      <FirstRowField
        label={t('form.greeting')}
        qualifier={t('form.greetingHint')}
        value={values.greeting}
        onValueChange={(greeting) => onChange({ greeting })}
        max={GREETING_MAX}
        counter
        error={errors?.greeting ? t('moderation') : undefined}
      />
      <FirstRowEmojiPick value={values.emojiId} onValueChange={(emojiId) => onChange({ emojiId })} disabled={emojiWaitSec > 0} hint={null}>
        {emojiWaitSec > 0 ? (
          <p role="status" className={s.emoWait} data-row="emoji-wait">
            {w('tooOften')}
          </p>
        ) : null}
      </FirstRowEmojiPick>
      <FirstRowPreview name={values.name} emojiId={values.emojiId} flagCode={flagCode} />
      <p className={s.hint}>{t('edit.greetingNote')}</p>
      <Button type="submit" variant="coral" size="lg" className="w-full" data-action="save">
        {t('edit.save')}
      </Button>
      <Button type="button" variant="secondary" size="lg" className="w-full" data-action="cancel" onClick={onCancel}>
        {t('edit.cancel')}
      </Button>
    </form>
  );
}
