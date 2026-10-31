'use client';

/**
 * O-MORE-ACTIONS «Ще дії» за дошкою `Desk-ActionRow` (рішення власника 2026-11-01).
 * - Десктоп («⋯» поруч з «Кімната перегляду» й «Режим вечірки») — на місці чату: посилання з «Копіювати»,
 *   «Поділитися…» (системне вікно, без нього — копіює) і WhatsApp; нижче — «Повідомити про проблему»: причина й
 *   «Надіслати» («Інше» — ще й поле «Напишіть про вашу проблему»), після — «Дякуємо! Ми перевіримо трансляцію».
 * - Телефон («⋯» праворуч від «Обрати трансляцію») — шторка без затемнення сайту: «Кімната перегляду», «Режим вечірки»,
 *   «Поділитися трансляцією» (одразу системне вікно телефона), «Повідомити про проблему» — наступний екран шторки
 *   (зверху «‹ Назад» і «×», нижче назва, причини й «Надіслати»), далі — «Дякуємо» і «Закрити».
 * Надсилання поки імітоване (бекенду скарг немає): лише стан «Дякуємо».
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { Textarea } from '@/components/primitives/Textarea';
import s from './streamPicker.module.css';

export const MORE_ACTIONS_ID = 'O-MORE-ACTIONS';
export const REPORT_ID = 'O-REPORT-PROBLEM';

const PROBLEMS = ['noSound', 'stopped', 'wrongEvent', 'other'] as const;
type Problem = (typeof PROBLEMS)[number];

/** Логотип WhatsApp (зелене коло з трубкою) — впізнавана кнопка. */
function WhatsAppMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path fill="#25D366" d="M12 2.2A9.8 9.8 0 0 0 3.6 17l-1.3 4.8 4.9-1.3A9.8 9.8 0 1 0 12 2.2Z" />
      <path
        fill="#fff"
        d="M17.3 14.4c-.3-.2-1.7-.8-2-.9-.3-.1-.5-.2-.7.2l-.9 1.1c-.2.2-.3.2-.6.1a8 8 0 0 1-3.9-3.4c-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6a1.1 1.1 0 0 0-.8.4 3.4 3.4 0 0 0-1 2.5 5.9 5.9 0 0 0 1.2 3.1 13.5 13.5 0 0 0 5.2 4.6c1.9.8 2.7.9 3.6.7a3.1 3.1 0 0 0 2-1.4 2.5 2.5 0 0 0 .2-1.4c-.1-.2-.3-.2-.6-.4Z"
      />
    </svg>
  );
}

export interface ShareTarget {
  /** Повна адреса сторінки, якою ділимося. */
  url: string;
  /** Видима адреса без протоколу. */
  shortUrl: string;
  /** Текст для системного шерингу й WhatsApp («Лондон · Біг-Бен — наживо на Time2Fest»). */
  text: string;
}

/** Системне вікно «Поділитися» телефона; без нього — копіює посилання. Повертає `true`, якщо скопійовано. */
export async function nativeShare(target: ShareTarget): Promise<boolean> {
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title: target.text, text: target.text, url: target.url });
      return false;
    }
    await navigator.clipboard.writeText(target.url);
    return true;
  } catch {
    return false; // людина закрила системне вікно — не помилка
  }
}

function ShareBlock({ target }: { target: ShareTarget }) {
  const t = useTranslations('player.more');
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(target.url);
      setCopied(true);
    } catch {
      // буфер недоступний — адресу видно в рядку, її можна виділити
    }
  };
  return (
    <div className="flex flex-col gap-2" data-row="share">
      <div className={s.linkRow}>
        <Icon name="link" size={16} />
        <span className={s.linkText}>{target.shortUrl}</span>
        <Button variant="ghost" compact iconLeft={copied ? 'check' : undefined} data-action="copy" onClick={copy}>
          {copied ? t('copied') : t('copy')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="tonal" compact iconLeft="share" data-action="share" onClick={() => void nativeShare(target).then((c) => c && setCopied(true))}>
          {t('shareSystem')}
        </Button>
        <Button variant="tonal" compact asChild>
          <a href={`https://wa.me/?text=${encodeURIComponent(`${target.text} ${target.url}`)}`} target="_blank" rel="noopener noreferrer" data-action="whatsapp">
            <WhatsAppMark />
            WhatsApp
          </a>
        </Button>
      </div>
    </div>
  );
}

/** «Повідомити про проблему»: причина («Інше» — з текстом), «Надіслати», далі — «Дякуємо». `center` — телефон. */
export function ReportProblem({ onClose, center = false }: { onClose?: () => void; center?: boolean }) {
  const t = useTranslations('player.more');
  const name = useId();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [details, setDetails] = useState('');
  const [sent, setSent] = useState(false);
  const ready = problem !== null && (problem !== 'other' || details.trim().length > 0);
  if (sent) {
    return (
      <div role="status" data-row="report-sent" className={cn(s.sent, center && s.sentCenter)}>
        <span aria-hidden="true" className={s.sentIcon}>
          <Icon name="check" size={22} />
        </span>
        <p className={s.sentTitle}>{t('sentTitle')}</p>
        <p className={s.sentText}>{t('sentText')}</p>
        {center && onClose ? (
          <Button variant="secondary" data-action="close" onClick={onClose} className="mt-1 w-full">
            {t('close')}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-2"
      data-row="report"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) setSent(true);
      }}
    >
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="sr-only">{t('reportTitle')}</legend>
        {PROBLEMS.map((p) => (
          <label key={p} className={s.problem}>
            <input type="radio" name={name} value={p} checked={problem === p} onChange={() => setProblem(p)} />
            {t(`problem.${p}`)}
          </label>
        ))}
      </fieldset>
      {problem === 'other' ? (
        <Textarea
          label={t('detailsLabel')}
          hideLabel
          placeholder={t('detailsLabel')}
          maxRows={4}
          maxLength={300}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          data-row="report-details"
        />
      ) : null}
      <Button type="submit" variant="secondary" disabled={!ready} data-action="send" className={cn('mt-1', center ? 'w-full' : 'self-start')}>
        {t('send')}
      </Button>
    </form>
  );
}

/** Десктоп: усе в одній панелі на місці чату. */
export function MoreActionsDesk({ target }: { target: ShareTarget }) {
  const t = useTranslations('player.more');
  return (
    <section data-window={MORE_ACTIONS_ID} className="flex flex-col gap-2 px-4 pb-4 pt-0">
      <ShareBlock target={target} />
      <div className={s.divider} />
      <p className={s.eyebrow}>{t('reportTitle')}</p>
      <ReportProblem />
    </section>
  );
}

function Item({ icon, title, sub, muted, ...rest }: { icon: IconName; title: string; sub: string; muted?: boolean } & ({ href: string } | { onClick(): void })) {
  const body = (
    <>
      <span aria-hidden="true" className={cn(s.itemTile, muted && s.itemTileMuted)}>
        <Icon name={icon} size={20} />
      </span>
      <span className={s.itemText}>
        <span className={s.itemTitle}>{title}</span>
        <span className={s.itemSub}>{sub}</span>
      </span>
      <Icon name="chevron-right" size={16} className="shrink-0 text-text-muted" />
    </>
  );
  if ('href' in rest)
    return (
      <NextLink href={rest.href} className={cn('t2f-focus t2f-transition', s.item)}>
        {body}
      </NextLink>
    );
  return (
    <button type="button" onClick={rest.onClick} className={cn('t2f-focus t2f-transition', s.item)}>
      {body}
    </button>
  );
}

/** Телефон: список дій; «Поділитися» — системне вікно, «Повідомити» — наступний екран (`onReport`). */
export function MoreActionsList({ target, onReport }: { target: ShareTarget; onReport(): void }) {
  const t = useTranslations('player.more');
  const tp = useTranslations('player');
  return (
    <ul data-window={MORE_ACTIONS_ID} className="m-0 flex list-none flex-col px-3 pb-4 pt-1">
      <li>
        <Item href="/room/" icon="grid4" title={tp('roomOpen')} sub={t('roomSub')} />
      </li>
      <li>
        <Item href="/tv/" icon="monitor" title={tp('partyMode')} sub={t('partySub')} />
      </li>
      <li aria-hidden="true" className={s.divider} />
      <li>
        <Item onClick={() => void nativeShare(target)} icon="share" title={tp('shareStream')} sub={t('shareSub')} muted />
      </li>
      <li>
        <Item onClick={onReport} icon="flag" title={t('reportTitle')} sub={t('reportSub')} muted />
      </li>
    </ul>
  );
}
