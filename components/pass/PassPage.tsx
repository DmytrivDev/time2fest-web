'use client';

/**
 * S-PASS — сторінка Новорічного пасу `/pass/` за дошками `S-PASS · …` (розділ «Купівля Новорічного пасу», v100):
 * «На головну» (сторінка пасу — не трансляція, правка власника 2026-10-30), герой з квитком і ціною, картка оформлення
 * (усі стани — `PassBuy`), «Що вмикається одразу після оплати» (плитки), «Питання й відповіді».
 * Телефон — одна колонка; десктоп (≥ 1024, дошки v102) — ліва колонка (герой, плитки, питання) і оформлення
 * в закріпленому сайдбарі праворуч, як чат на головній.
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { authStyles as a } from '@/components/auth/AuthParts';
import { AuthIcon } from '@/components/auth/icons';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import { currentPath, rememberLetterSent, rememberReturn } from '@/lib/auth/returnTo';
import { formatUsd, PASS_PRICE } from '@/lib/offers/format';
import { useAuthTabSync } from '@/stores/auth';
import { PassBuy, usePassView } from './PassBuy';
import { PassPerksShowcase } from './PassPerks';
import s from './pass.module.css';

/** Квиток пасу (той самий малюнок, що на дошках): небо з феєрверками, місто, корінець «СЕЗОН 2026/27». */
function TicketArt() {
  return (
    <svg viewBox="0 0 320 150" className={s.heroArt} aria-hidden="true" focusable="false">
      <defs>
        <g id="pass-fw">
          <circle r="15" fill="none" stroke="currentColor" strokeWidth="13" strokeDasharray="1.4 6.5" />
          <circle r="26" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="0.1 6.7" />
          <circle r="2.6" fill="currentColor" />
        </g>
        <linearGradient id="pass-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1B2142" />
          <stop offset="1" stopColor="#5A3F5E" />
        </linearGradient>
        <clipPath id="pass-art">
          <rect x="10" y="10" width="208" height="130" rx="8" />
        </clipPath>
      </defs>
      <path
        d="M12 0 H218 a12 12 0 0 0 24 0 H308 a12 12 0 0 1 12 12 V138 a12 12 0 0 1 -12 12 H242 a12 12 0 0 0 -24 0 H12 a12 12 0 0 1 -12 -12 V12 a12 12 0 0 1 12 -12 Z"
        fill="#EFE7D6"
      />
      <g clipPath="url(#pass-art)">
        <rect x="10" y="10" width="208" height="130" fill="url(#pass-sky)" />
        <g fill="#F2EBDD" opacity="0.7">
          <circle cx="30" cy="24" r="1" />
          <circle cx="120" cy="18" r="1.1" />
          <circle cx="196" cy="40" r="0.9" />
          <circle cx="60" cy="70" r="0.8" />
        </g>
        <use href="#pass-fw" transform="translate(60 52) scale(0.8)" style={{ color: '#E8C872' }} />
        <use href="#pass-fw" transform="translate(150 40) scale(0.65)" style={{ color: '#E8837F' }} />
        <use href="#pass-fw" transform="translate(194 84) scale(0.5)" style={{ color: '#8CC7C2' }} />
        <use href="#pass-fw" transform="translate(108 22) scale(0.35)" style={{ color: '#F2EBDD' }} />
        <g fill="#2C3454">
          {[
            [10, 118, 18, 22],
            [30, 110, 12, 30],
            [44, 120, 16, 20],
            [62, 104, 10, 36],
            [74, 116, 20, 24],
            [96, 108, 14, 32],
            [112, 98, 8, 42],
            [122, 114, 18, 26],
            [142, 106, 12, 34],
            [156, 118, 20, 22],
            [178, 110, 12, 30],
            [192, 120, 26, 20],
          ].map(([x, y, w, h]) => (
            <rect key={x} x={x} y={y} width={w} height={h} />
          ))}
        </g>
      </g>
      <text x="24" y="40" fontFamily="Manrope, sans-serif" fontSize="9" fontWeight="700" letterSpacing="1.6" fill="#F2EBDD" opacity="0.85">
        TIME2FEST · 2026/27
      </text>
      <text x="24" y="132" fontFamily="Manrope, sans-serif" fontSize="17" fontWeight="700" fill="#FCE286">
        НОВОРІЧНИЙ ПАС
      </text>
      <path d="M230 18 V132" stroke="#B9AE9C" strokeWidth="1.6" strokeDasharray="3 4" />
      <path d="M275 44 l5.5 12 l13 1.5 l-9.8 8.8 l2.8 12.8 l-11.5 -6.6 l-11.5 6.6 l2.8 -12.8 l-9.8 -8.8 l13 -1.5 Z" fill="#D93A41" />
      <text x="275" y="102" textAnchor="middle" fontFamily="Manrope, sans-serif" fontSize="11" fontWeight="700" letterSpacing="1" fill="#2A2620">
        СЕЗОН
      </text>
      <text x="275" y="118" textAnchor="middle" fontFamily="Manrope, sans-serif" fontSize="9" fontWeight="600" fill="#6A6254">
        2026/27
      </text>
    </svg>
  );
}

function Hero({ active }: { active: boolean }) {
  const t = useTranslations('pass.page');
  return (
    <section aria-labelledby="pass-title" className={cn(s.gold, s.hero)}>
      <TicketArt />
      <div className={s.heroText}>
        <h1 id="pass-title" className={s.title}>
          {t('title')}
        </h1>
        {active ? (
          <span className={s.activePill} data-row="active">
            ✓ {t('active')}
          </span>
        ) : (
          <span className={s.price}>{formatUsd(PASS_PRICE)}</span>
        )}
        <span className={s.priceNote}>{active ? t('activeNote') : t('priceNote')}</span>
        <p className={s.lead}>{t('lead')}</p>
      </div>
    </section>
  );
}

const FAQ = [1, 2, 3, 4] as const;

function Faq() {
  const t = useTranslations('pass.faq');
  const uid = useId();
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section aria-labelledby={`${uid}-faq`} className={s.faq}>
      <h2 id={`${uid}-faq`} className={s.faqTitle}>
        {t('title')}
      </h2>
      <div className={s.faqGrid}>
        {FAQ.map((n) => {
          const expanded = open === n;
          return (
            <div key={n} className={s.faqItem}>
              <h3>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`${uid}-a${n}`}
                  className={cn('t2f-focus', s.faqBtn)}
                  onClick={() => setOpen(expanded ? null : n)}
                >
                  <span>{t(`q${n}`)}</span>
                  <Icon name="chevron-down" size={18} strokeWidth={2} />
                </button>
              </h3>
              <p id={`${uid}-a${n}`} hidden={!expanded} className={s.faqAnswer}>
                {t(`a${n}`)}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function PassPage() {
  useAuthTabSync();
  const t = useTranslations('pass.page');
  const router = useRouter();
  const view = usePassView();
  // Після оплати змінюється лише картка оформлення (v102): герой — «✓ Активний», плитки й питання лишаються.
  const done = view === 'success' || view === 'active';
  const toLogin = () => {
    rememberReturn(currentPath());
    router.push('/login/');
  };
  return (
    <main id="content" tabIndex={-1} className={cn(s.main, 'focus:outline-none')} data-page="S-PASS" data-view={view}>
      <NextLink href="/" className={cn('t2f-focus', a.back)}>
        <AuthIcon name="chevron-left" size={16} />
        {t('back')}
      </NextLink>
      <Hero active={done} />
      <section aria-label={t('buyTitle')} className={s.card} data-block="pass-buy">
        <PassBuy
          variant="page"
          onSignIn={toLogin}
          onLetterSent={() => {
            rememberLetterSent();
            toLogin();
          }}
        />
      </section>
      <PassPerksShowcase />
      <Faq />
    </main>
  );
}
