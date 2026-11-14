'use client';

/**
 * S-AUTH сторінкою: `/login/` («Увійти») і `/signup/` («Створити акаунт») за дошками `Phone-Auth*` / `Desk-Auth*`.
 * Телефон — одна колонка; десктоп (≥ 1024) — ліворуч «Навіщо акаунт», праворуч картка кроку. Пас на вході й реєстрації —
 * однаково, карткою «Ще немає Новорічного пасу?» під формою (правка власника 2026-10-29). Пошта — код із 6 цифр на тій
 * самій сторінці (рішення 2026-11-13); посилань у листі немає. Код, надісланий зі сторінки пасу («На цю адресу пас уже
 * оформлено»), відкриває сторінку одразу з кроку «Введи код».
 * Після входу в наявний акаунт — повернення туди, звідки прийшли (`lib/auth/returnTo`).
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/components/primitives/cn';
import type { AuthIntent } from '@/lib/api/contracts/auth';
import { currentSession, useSession } from '@/lib/api/hooks/auth';
import { returnPath, takeCodeSent } from '@/lib/auth/returnTo';
import { AuthSteps } from './AuthSteps';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { useAuthFlow, type AuthStep, type SignInResult } from './useAuthFlow';
import s from './auth.module.css';

interface Start {
  step?: AuthStep;
  email?: string;
}

/** Старт після монтування (статичний експорт не знає стану на збиранні): код уже надіслано з іншої сторінки — крок коду. */
async function resolveStart(): Promise<Start> {
  const code = currentSession()?.code;
  if (takeCodeSent() && code && code.expiresAt > Date.now()) return { step: { kind: 'code' }, email: code.email };
  return {};
}

export function AuthPage({ mode }: { mode: AuthIntent }) {
  // Підписка на сесію (і синхронізація вкладок у `sim`) — поки сторінка відкрита.
  useSession();
  const router = useRouter();
  const [exitHref, setExitHref] = useState('/');
  const [start, setStart] = useState<Start | null>(null);

  // Старт визначаємо раз (StrictMode запускає ефект двічі).
  const resolved = useRef<Promise<Start> | null>(null);
  useEffect(() => {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- одноразово після монтування: sessionStorage (статичний експорт)
    setExitHref(returnPath());
    let alive = true;
    const pending = resolved.current ?? (resolved.current = resolveStart());
    void pending.then((next) => {
      // Уже увійшов — сторінка входу не потрібна.
      const signedIn = !next.step && !!currentSession()?.user;
      if (!alive) return;
      if (signedIn) {
        router.replace(returnPath());
        return;
      }
      setStart(next);
    });
    return () => {
      alive = false;
    };
  }, [router]);

  const onSignedIn = useCallback(() => router.push(returnPath()), [router]);
  const onExit = useCallback(() => router.push(returnPath()), [router]);

  return (
    <main
      id="main"
      tabIndex={-1}
      className={cn(s.main, 'focus:outline-none')}
      data-page={mode === 'signup' ? 'S-AUTH-signup' : 'S-AUTH'}
      // До старту (статичний HTML до гідратації) — той самий маркер, що в `loading.tsx` (2026-11-10).
      data-skeleton={start ? undefined : mode === 'signup' ? 'signup' : 'login'}
    >
      <BackLink href={exitHref} />
      {/* До старту показуємо форму (той самий вигляд, що в статичному HTML). */}
      <Flow key={start ? 'ready' : 'boot'} mode={mode} start={start ?? {}} onSignedIn={onSignedIn} onExit={onExit} exitHref={exitHref} />
    </main>
  );
}

function BackLink({ href }: { href: string }) {
  const t = useTranslations('auth');
  return (
    <NextLink href={href} className={cn('t2f-focus', s.back)}>
      <Icon name="chevron-left" size={16} strokeWidth={2} />
      {t('back')}
    </NextLink>
  );
}

function Flow({
  mode,
  start,
  onSignedIn,
  onExit,
  exitHref,
}: {
  mode: AuthIntent;
  start: Start;
  onSignedIn: (r: SignInResult) => void;
  onExit: () => void;
  exitHref: string;
}) {
  const flow = useAuthFlow({ mode, initialStep: start.step, initialEmail: start.email, onSignedIn });
  const kind = flow.step.kind;
  return (
    <div className={s.layout}>
      <div className={s.side}>
        <WhyCard />
      </div>
      <section className={cn(s.card, kind === 'welcome' && s.cardWide)}>
        <AuthSteps flow={flow} variant="page" onExit={onExit} exitHref={exitHref} />
      </section>
    </div>
  );
}

const WHY: { icon: IconName; key: 'passport' | 'schedule' | 'purchases' }[] = [
  { icon: 'rubber-stamp', key: 'passport' },
  { icon: 'calendar-time', key: 'schedule' },
  { icon: 'ticket', key: 'purchases' },
];

/** Десктоп: «Навіщо акаунт». */
function WhyCard() {
  const t = useTranslations('auth.why');
  return (
    <section aria-labelledby="auth-why" className={cn(s.gold, s.why)}>
      <h2 id="auth-why" className={s.whyTitle}>
        {t('title')}
      </h2>
      <ul className={s.whyList}>
        {WHY.map((w) => (
          <li key={w.key} className={s.whyItem}>
            <span aria-hidden="true" className={cn(s.dot, s.yel, s.badgeWhy)}>
              <Icon name={w.icon} size={22} />
            </span>
            <span>
              <span className={s.whyName}>{t(w.key)}</span>
              <span className={s.whyText}>{t(`${w.key}Text`)}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className={s.whyFree}>
        <Icon name="chat" size={18} />
        {t('free')}
      </p>
    </section>
  );
}
