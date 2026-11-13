'use client';

/**
 * «Підтримати» (`/support/`) за дошкою `Desk-Support-New`, варіант A (рішення власника 2026-11-07, концепція
 * `support-concept-2026-11-07.md`); з 2026-11-12 підтримка — це тост (головний платний продукт, дошки `Desk-Toast-New`,
 * `Phone-Toast-New`). Сторінка з чатом «Світ» праворуч:
 * - героїчний блок: два золоті тости й 🥂 ліворуч, «Скажи тост на весь світ» праворуч;
 * - «Обери тост»: рівні $2 / $5 / $10 і що дає обраний (як у вікні); «Сказати тост · $N» відкриває вікно тосту з цим
 *   рівнем — текст пишуть до оплати;
 * - «Тости світу» — ті самі тости, що в смузі під плеєром (свої; у тестовій і демо-збірці — ще й імітовані), за рівнями;
 *   «N тостів за свято · M країн»;
 * - «Хочеш більше від свята?» — Новорічний пас; «Питання й відповіді».
 * `/support/?toast=10` («Скажи тост за $10» на сторінці пасу) — вікно тосту відкривається одразу з $10.
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { PageChat } from '@/components/chat/PageChat';
import { Faq } from '@/components/live/Faq';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Emoji, EmojiText } from '@/components/primitives/Emoji';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { ToastBubble } from '@/components/toast/ToastBubble';
import { useAgo } from '@/components/toast/ToastStrip';
import { ToastBenefits, ToastTiers, useOpenToastWindow } from '@/components/toast/ToastWindow';
import { useWorldToasts } from '@/components/toast/useWorldToasts';
import { formatUsd } from '@/lib/offers/format';
import { pinnedUntil } from '@/lib/toast/feed';
import { DEFAULT_TIER, isToastTier, type ToastTier } from '@/lib/toast/tiers';
import { useGuestStore } from '@/stores/guest';
import s from './support.module.css';

const FEED = 5;

function WorldToasts() {
  const t = useTranslations('supportPage');
  const { ready, toasts, now, midnights, view } = useWorldToasts();
  const ago = useAgo();
  // Найновіші першими.
  const all = ready ? [...toasts].reverse() : [];
  const [open, setOpen] = useState(false);
  const restId = useId();
  const flags = [...new Set(all.map((m) => m.flagCode))].slice(0, 8);
  const item = (m: (typeof all)[number]) => {
    const until = pinnedUntil(m, midnights);
    return (
      <li key={m.id}>
        <ToastBubble nick={m.nick} flagCode={m.flagCode} text={m.text} tier={m.tier} pass={!!m.pass} meta={until !== null && now < until} aside={ago(now, m.createdAt)} />
      </li>
    );
  };
  return (
    <section aria-labelledby="support-toasts" className={s.box} data-world-toasts="">
      <div className={s.boxHead}>
        <h2 id="support-toasts" className={s.h2}>
          {t('toastsTitle')}
        </h2>
        <span className={s.spacer} />
        {all.length ? (
          <>
            <span aria-hidden="true" className={s.flags}>
              {flags.map((f) => (
                <Flag key={f} round code={f} diameter={18} decorative />
              ))}
            </span>
            <span className={s.meta}>{t('toastsMeta', { count: view.total, countries: view.countries })}</span>
          </>
        ) : null}
      </div>
      <p className={s.sub}>{t('toastsSub')}</p>
      {all.length ? (
        <>
          <ul className={s.feed}>{all.slice(0, FEED).map(item)}</ul>
          {/* «Переглянути всі» — решта тостів плавно розгортається (власник 2026-11-07). */}
          {all.length > FEED ? (
            <>
              <div id={restId} className={s.rest} data-open={open || undefined} inert={!open}>
                <ul className={s.feed}>{all.slice(FEED).map(item)}</ul>
              </div>
              <button type="button" aria-expanded={open} aria-controls={restId} onClick={() => setOpen((v) => !v)} className={cn('t2f-focus', s.more)} data-action="toasts-all">
                {open ? t('toastsLess') : t('toastsAll', { count: all.length })}
                <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
              </button>
            </>
          ) : null}
        </>
      ) : (
        <p className={s.empty}>{t('toastsEmpty')}</p>
      )}
    </section>
  );
}

/** «Обери тост» на сторінці: рівні й що вони дають, «Сказати тост · $N» — вікно тосту з цим рівнем. */
function ToastOffer({ onOpen }: { onOpen: (tier: ToastTier) => void }) {
  const t = useTranslations('toast');
  const hasPass = useGuestStore((g) => g.hasPass);
  const [tier, setTier] = useState<ToastTier>(DEFAULT_TIER);
  return (
    <section aria-labelledby="support-offer" className={cn(s.box, s.offer)} data-offer="toast">
      <p className={s.offerKicker}>
        <Icon name="glass" size={14} />
        {t('supportCard.kicker')}
      </p>
      <h2 id="support-offer" className={s.h2}>
        {t('chooseTitle')}
      </h2>
      <p className={s.sub}>{t('supportCard.lead')}</p>
      <div className={s.offerGrid}>
        <ToastTiers value={tier} onChange={setTier} />
        <ToastBenefits tier={tier} hasPass={hasPass} />
      </div>
      <Button variant="coral" size="lg" yieldToCoralWindow onClick={() => onOpen(tier)} className={s.offerBtn} data-action="support-toast">
        {t('supportCard.action', { price: formatUsd(tier) })}
      </Button>
    </section>
  );
}

export function SupportPage() {
  const t = useTranslations('supportPage');
  const openToast = useOpenToastWindow();
  const faq = (['subscription', 'pass', 'refund', 'check'] as const).map((k) => ({ id: k, question: t(`faq.${k}Q`), answer: t(`faq.${k}A`) }));
  // «Скажи тост за $10» зі сторінки пасу: вікно з $10 одразу, адресу — чисту.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tier = Number(params.get('toast'));
    if (!params.has('toast')) return;
    params.delete('toast');
    const rest = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
    openToast({ tier: isToastTier(tier) ? tier : undefined });
  }, [openToast]);
  return (
    <div id="content" tabIndex={-1} className={cn(s.page, 'focus:outline-none')} data-page="S-SUPPORT">
      <header className={s.hero}>
        <div aria-hidden="true" className={s.art}>
          <span className={cn(s.artBubble, s.artBack)}>
            <span className={s.who}>
              <Flag round code="JP" size="xs" decorative />
              <b>Hiro</b>
              <span className="t2f-toast-badge">тост</span>
            </span>
            Happy New Year з Токіо!
          </span>
          <span className={cn(s.artBubble, s.artFront)}>
            <span className={s.who}>
              <Flag round code="UA" size="xs" decorative />
              <b>Олена</b>
              <span className="t2f-toast-badge">тост</span>
            </span>
            <span>
              <EmojiText text="🥂 Піднімаю келих за всіх, хто зустрічає Новий рік разом!" />
            </span>
          </span>
          <span className={s.artGlass}>
            <Emoji char="🥂" size={48} />
          </span>
        </div>
        <div className={s.heroText}>
          <p className={s.kicker}>
            <Icon name="heart" size={14} />
            {t('kicker')}
          </p>
          <h1 className={s.h1}>{t('title')}</h1>
          <p className={s.lead}>{t('lead')}</p>
        </div>
      </header>

      <ToastOffer onOpen={(tier) => openToast({ tier })} />

      <WorldToasts />

      <NextLink href="/pass/" className={cn('t2f-focus', s.passCard)}>
        <span aria-hidden="true" className={s.passIcon}>
          <Icon name="ticket" size={18} />
        </span>
        <span className={s.passText}>
          <b>{t('passTitle')}</b>
          <span>{t('passText')}</span>
        </span>
        <span className={s.passLink}>
          {t('passLink')}
          <Icon name="chevron-right" size={14} />
        </span>
      </NextLink>

      <Faq items={faq} columns={2} className={s.faq} />
      <PageChat />
    </div>
  );
}
