'use client';

/**
 * «Як збирати штампи» — інформаційний блок унизу паспорта (варіант A дошки `Desk-Passport-Info`, рішення власника
 * 2026-11-07): чотири кроки з мініатюрами — опівночі → штамп автоматично → поділитися листівкою → шлях і серії (пас).
 * Десктоп — кроки в ряд зі стрілкою-лінією, телефон — стовпчиком. Гостю знизу — «Паспорт збережено на цьому пристрої · Увійди».
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/primitives/Icon';
import s from './passport.module.css';

const STEPS = ['midnight', 'auto', 'share', 'path'] as const;

function Mini({ step }: { step: (typeof STEPS)[number] }) {
  if (step === 'midnight') return <span className={s.howMini} data-mini="midnight">00:00</span>;
  if (step === 'auto')
    return (
      <span className={s.howMini} data-mini="auto">
        <span className={s.howSeal}>
          01.01
          <br />
          2027
        </span>
      </span>
    );
  if (step === 'share')
    return (
      <span className={s.howMini} data-mini="share">
        <span className={s.howShare}>
          <Icon name="share" size={16} />
        </span>
        Stories · 9:16
      </span>
    );
  return (
    <span className={s.howMini} data-mini="path">
      <svg viewBox="0 0 100 72" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="16,47 38,31 59,40 82,24" />
      </svg>
      {/* Точки — окремо від розтягнутої лінії, щоб лишались круглими. */}
      {[
        [16, 47],
        [38, 31],
        [59, 40],
        [82, 24],
      ].map(([x, y]) => (
        <span key={x} className={s.howDot} style={{ left: `${x}%`, top: `${(y! / 72) * 100}%` }} />
      ))}
    </span>
  );
}

export function PassportHowTo({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations('passport.howTo');
  return (
    <section aria-labelledby="passport-howto" className={s.how} data-passport-howto="">
      <h2 id="passport-howto" className={s.h2}>
        {t('title')}
      </h2>
      <ol className={s.howSteps}>
        {STEPS.map((k, i) => (
          <li key={k} className={s.howStep}>
            <span aria-hidden="true" className={s.howNumRow}>
              <span className={s.howNum}>{i + 1}</span>
              {i < STEPS.length - 1 ? <span className={s.howLine} /> : null}
            </span>
            <div className={s.howBody}>
              <Mini step={k} />
              <b className={s.howTitle}>{t(`${k}Title`)}</b>
              <span className={s.howText}>{t(`${k}Text`)}</span>
            </div>
          </li>
        ))}
      </ol>
      {signedIn ? null : (
        <p className={s.howFoot}>
          <Icon name="user" size={16} />
          <span>
            {t.rich('saved', {
              signIn: (chunks) => (
                <NextLink href="/login/" className="t2f-focus rounded-sm font-semibold text-text underline underline-offset-2">
                  {chunks}
                </NextLink>
              ),
            })}
          </span>
        </p>
      )}
    </section>
  );
}
