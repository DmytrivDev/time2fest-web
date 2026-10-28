'use client';

/**
 * C8 O-PAY і суміжні стани вікна «Перший ряд»: очікування підтвердження (`pending`), успіх із квитком (`success`),
 * «місце щойно зайняли» (`soldout`), зміна напису й емоції (`edit`), а також тонкі обгортки над формою
 * для `declined` і `expired`. Лише тіло вікна (заголовок і «Закрити» дає контейнер).
 */
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
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { Link } from '@/components/primitives/Link';
import { TextField } from '@/components/primitives/TextField';
import { Textarea } from '@/components/primitives/Textarea';
import { FirstRowEmojiPick, FirstRowForm, FirstRowHeaderLines, FirstRowPreview } from '@/components/windows/FirstRowForm';
import { PostcardArt, StampMark } from '@/components/windows/StampArt';
import type { Ms } from '@/lib/data/types';
import { GREETING_MAX, NAME_MAX } from '@/lib/firstrow/pay';
import { formatClock } from '@/lib/i18n/time';

function TermsLink() {
  const t = useTranslations('firstRow');
  return (
    <Link href="/legal/terms" variant="footer">
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

export function FirstRowPending({ city, midnightMs, freeCount, total, preview, holdUntil, email, onClose, onHelp, className }: FirstRowPendingProps) {
  const t = useTranslations('firstRow');
  return (
    <section
      data-window="O-PAY"
      data-phase="pending"
      aria-label={t('heading', { city })}
      className={cn('flex flex-col gap-4', className)}
    >
      <FirstRowHeaderLines midnightMs={midnightMs} freeCount={freeCount} total={total} />
      <div role="status" className="flex flex-col gap-1" data-row="pending-status">
        <h3 className="flex items-center gap-2 text-headline-sm text-text">
          <Icon name="clock" size={22} className="shrink-0 text-highlight" />
          {t('pending.title')}
        </h3>
        <p className="text-body text-text-secondary">{t('pending.body')}</p>
      </div>
      <FirstRowPreview name={preview.name} emojiId={preview.emojiId} />
      <p className="text-body-strong text-text" data-row="hold-until">
        {t('holdUntil', { time: formatClock(holdUntil) })}
      </p>
      <p className="text-body text-text-secondary">{t('pending.closeNote', { email })}</p>
      <Button type="button" variant="secondary" size="lg" className="w-full" onClick={onClose}>
        {t('pending.close')}
      </Button>
      <p className="flex flex-wrap items-center gap-1 text-caption text-text-muted">
        {t('pending.problem')}
        {onHelp ? (
          <Button type="button" variant="ghost" compact onClick={onHelp}>
            {t('form.help')}
          </Button>
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

/** Квиток «Перший ряд»: листівка зі штемпелем, ім’я, емоція, привітання та корінець із рядом, місцем і датою. */
function Ticket({ city, cityId, seat, name, flagCode, emojiId, greeting, ticketCode }: TicketProps) {
  const t = useTranslations('firstRow');
  return (
    <div
      role="img"
      aria-label={t('ticket.label', { city, n: seat, name })}
      data-ticket=""
      className="flex overflow-hidden rounded-lg bg-text text-background"
    >
      <div aria-hidden="true" className="flex min-w-0 flex-1 flex-col gap-2 p-2">
        <div className="relative">
          <PostcardArt illustrationId={cityId} className="block w-full rounded-md" />
          <StampMark text={`${t('ticket.brand')} · ${city}`.toUpperCase()} className="absolute end-1 top-1 size-20 -rotate-12 text-highlight" />
          <span className="absolute start-2 top-2 rounded-sm bg-background/70 px-2 py-0.5 text-label-badge text-text uppercase">
            {t('ticket.brand')} · {t('ticket.cityYear', { city })}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1 px-1.5">
          <p className="flex min-w-0 items-center gap-2">
            <Flag code={flagCode} size="sm" decorative />
            <span className="truncate text-body-strong">{name}</span>
            <span className="leading-none">{EMOJI_SYMBOLS[canonicalEmotion(emojiId)] ?? '✨'}</span>
          </p>
          {greeting ? <p className="text-caption">«{greeting}»</p> : null}
        </div>
      </div>
      <div
        aria-hidden="true"
        className="flex w-24 shrink-0 flex-col items-center justify-between gap-3 border-s-2 border-dashed border-background/40 px-2 py-3 text-center"
      >
        <p className="flex flex-col">
          <span className="text-label-badge-chat uppercase opacity-70">{t('ticket.row')}</span>
          <span className="text-label-sm uppercase">{t('ticket.rowValue')}</span>
        </p>
        <p className="flex flex-col">
          <span className="text-label-badge-chat uppercase opacity-70">{t('ticket.seat')}</span>
          <span className="text-headline-md tabular-nums">{seat}</span>
        </p>
        <p className="flex flex-col text-label-badge-chat">
          <span className="font-semibold">{t('ticket.date')}</span>
          <span>{t('ticket.time', { city })}</span>
          <span>{t('ticket.no', { code: ticketCode })}</span>
        </p>
      </div>
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
  return (
    <section
      data-window="O-PAY"
      data-phase="success"
      aria-label={t('heading', { city })}
      className={cn('flex flex-col gap-4', className)}
    >
      <div role="status" className="flex flex-col gap-1" data-row="success-status">
        <h3 className="flex items-center gap-2 text-headline-sm text-text">
          <Icon name="check" size={22} className="shrink-0 text-highlight" />
          {t('success.title')}
        </h3>
        <p className="text-body-strong text-text">{t('success.youAre', { city })}</p>
        <p className="flex items-center gap-2 text-body text-text-secondary">
          <span>{name}</span>
          {names.has(canonicalEmotion(emojiId)) ? (
            <span role="img" aria-label={names(canonicalEmotion(emojiId))} className="leading-none">
              {EMOJI_SYMBOLS[canonicalEmotion(emojiId)] ?? '✨'}
            </span>
          ) : null}
        </p>
        <p className="text-body text-text-secondary">
          {t('success.seat')} <strong className="text-text tabular-nums">{seat}</strong>
        </p>
      </div>
      <p className="flex items-center gap-2 text-body-strong text-text" data-row="pass">
        <Icon name="ticket" size={18} className="shrink-0 text-highlight" />
        {pass === 'gifted' ? t('success.passGifted') : t('success.passDiscount')}
      </p>

      <Ticket city={city} cityId={cityId} seat={seat} name={name} flagCode={flagCode} emojiId={emojiId} greeting={greeting} ticketCode={ticketCode} />

      <div className="flex flex-col gap-2">
        {onShare ? (
          <Button type="button" variant="coral" size="lg" className="w-full" iconLeft="share" data-action="share" onClick={onShare}>
            {t('success.share')}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" className="w-full" data-action="edit" onClick={onEdit}>
          {t('success.edit')}
        </Button>
      </div>
      <p className="text-caption text-text-muted">{t('success.moderationNote')}</p>
      <p className="text-body text-text-secondary">{t('success.midnight', { time: formatClock(midnightMs) })}</p>
      <p className="text-caption text-text-muted">{t('success.mail', { email })}</p>
      <TermsLink />
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
      className={cn('flex flex-col gap-4', className)}
    >
      <div role="alert" className="flex flex-col gap-1" data-row="soldout-status">
        <h3 className="text-headline-sm text-text">{t('soldOutWin.title')}</h3>
        <p className="text-body-strong text-text">{t('soldOutWin.money')}</p>
        <p className="text-body text-text-secondary">{t('soldOutWin.city', { city })}</p>
      </div>
      <Badge variant="first-row" className="w-fit">
        {t('soldOut')}
      </Badge>
      <Button type="button" variant="coral" size="lg" className="w-full" data-action="back" onClick={onBack}>
        {t('soldOutWin.back')}
      </Button>
      <Link href={otherHref} variant="chevron">
        {t('soldOutWin.other')}
      </Link>
    </section>
  );
}

/* ───────────── edit ───────────── */

export function FirstRowEdit({ city, seat, values, onChange, emojiWaitSec, errors, onSave, onCancel, className }: FirstRowEditProps) {
  const t = useTranslations('firstRow');
  const w = useTranslations('windows.emoji');
  return (
    <form
      noValidate
      data-window="O-PAY"
      data-phase="edit"
      aria-label={t('edit.title')}
      className={cn('flex flex-col gap-4', className)}
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-headline-sm text-text">{t('edit.title')}</h3>
        <p className="text-label-sm text-text-secondary">{t('edit.seat', { n: seat, city })}</p>
      </div>
      <TextField
        label={t('form.name')}
        value={values.name}
        onChange={(e) => onChange({ name: e.target.value })}
        maxLength={NAME_MAX}
        counter
        autoComplete="nickname"
        hint={t('form.nameHint')}
        error={errors?.name ? t('form.nameError') : undefined}
      />
      <Textarea
        label={t('form.greeting')}
        value={values.greeting}
        onChange={(e) => onChange({ greeting: e.target.value })}
        maxLength={GREETING_MAX}
        counter
        hint={t('form.greetingHintEdit')}
        error={errors?.greeting ? t('moderation') : undefined}
      />
      <FirstRowEmojiPick value={values.emojiId} onValueChange={(emojiId) => onChange({ emojiId })} disabled={emojiWaitSec > 0}>
        {emojiWaitSec > 0 ? (
          <p role="status" className="text-caption text-primary" data-row="emoji-wait">
            {w('tooOften')}
          </p>
        ) : null}
      </FirstRowEmojiPick>
      <FirstRowPreview name={values.name} emojiId={values.emojiId} />
      <div className="flex flex-col gap-2">
        <Button type="submit" variant="coral" size="lg" className="w-full" data-action="save">
          {t('edit.save')}
        </Button>
        <Button type="button" variant="secondary" size="lg" className="w-full" data-action="cancel" onClick={onCancel}>
          {t('edit.cancel')}
        </Button>
      </div>
    </form>
  );
}
