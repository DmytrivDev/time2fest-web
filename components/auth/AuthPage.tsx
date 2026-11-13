'use client';

/**
 * S-AUTH сторінкою: `/login/` («Увійти») і `/signup/` («Створити акаунт») за дошками `Phone-Auth*` / `Desk-Auth*`.
 * Телефон — одна колонка; десктоп (≥ 1024) — ліворуч «Навіщо акаунт», праворуч картка кроку. Пас на вході й реєстрації —
 * однаково, карткою «Ще немає Новорічного пасу?» під формою (правка власника 2026-10-29). Посилання з листа відкривається тут же: `/login/?link=<токен>` → «Акаунт створено»
 * (новий акаунт), «Вхід виконано на цьому пристрої» (наявний) або «Посилання вже не діє».
 * Після входу в наявний акаунт — повернення туди, звідки прийшли (`lib/auth/returnTo`).
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/components/primitives/cn';
import type { AuthIntent } from '@/lib/api/contracts/auth';
import { authActions, currentSession, useSession } from '@/lib/api/hooks/auth';
import { returnPath, takeLetterSent } from '@/lib/auth/returnTo';
import { AuthSteps } from './AuthSteps';
import { AuthIcon, type AuthIconName } from './icons';
import { useAuthFlow, type AuthStep, type SignInResult } from './useAuthFlow';
import s from './auth.module.css';

interface Start {
  step?: AuthStep;
  email?: string;
}

/** Розбір `?link=` один раз після монтування (статичний експорт не знає параметрів на збиранні). */
async function resolveStart(): Promise<Start> {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('link');
  if (!token) {
    // Лист уже надіслано з іншої сторінки (пас) — одразу «Лист надіслано».
    const letter = currentSession()?.link;
    if (takeLetterSent() && letter && !letter.used) return { step: { kind: 'sent' }, email: letter.email };
    return {};
  }
  window.history.replaceState(null, '', window.location.pathname);
  const res = await authActions.openLink(token);
  // Сервіс не відповів — показуємо як прострочене посилання (окремого вигляду «не вдалося перевірити» немає).
  if (!res.ok) return { step: { kind: 'expired' } };
  const out = res.value;
  if (out.kind === 'signed-in') return { step: out.isNew ? { kind: 'welcome', email: out.email } : { kind: 'otherDevice', email: out.email } };
  const email = out.kind === 'expired' ? out.email : undefined;
  return { step: { kind: 'expired', email }, email };
}

export function AuthPage({ mode }: { mode: AuthIntent }) {
  // Підписка на сесію (і синхронізація вкладок у `sim`) — поки сторінка відкрита.
  useSession();
  const router = useRouter();
  const [exitHref, setExitHref] = useState('/');
  const [start, setStart] = useState<Start | null>(null);

  // Посилання з листа одноразове: розбираємо раз (StrictMode запускає ефект двічі).
  const resolved = useRef<Promise<Start> | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- одноразово після монтування: sessionStorage і `?link=` (статичний експорт)
    setExitHref(returnPath());
    let alive = true;
    const pending = resolved.current ?? (resolved.current = resolveStart());
    void pending.then((next) => {
      // Уже увійшов і прийшов не з листа — сторінка входу не потрібна.
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
      // Поки не розібрано `?link=` (статичний HTML до гідратації) — той самий маркер, що в `loading.tsx` (2026-11-10).
      data-skeleton={start ? undefined : mode === 'signup' ? 'signup' : 'login'}
    >
      <BackLink href={exitHref} />
      {/* Поки не розібрано `?link=`, показуємо форму (той самий вигляд, що в статичному HTML). */}
      <Flow key={start ? 'ready' : 'boot'} mode={mode} start={start ?? {}} onSignedIn={onSignedIn} onExit={onExit} exitHref={exitHref} />
    </main>
  );
}

function BackLink({ href }: { href: string }) {
  const t = useTranslations('auth');
  return (
    <NextLink href={href} className={cn('t2f-focus', s.back)}>
      <AuthIcon name="chevron-left" size={16} />
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

const WHY: { icon: AuthIconName; key: 'passport' | 'schedule' | 'purchases' }[] = [
  { icon: 'stamp', key: 'passport' },
  { icon: 'calendar', key: 'schedule' },
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
              <AuthIcon name={w.icon} size={22} />
            </span>
            <span>
              <span className={s.whyName}>{t(w.key)}</span>
              <span className={s.whyText}>{t(`${w.key}Text`)}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className={s.whyFree}>
        <AuthIcon name="chat" size={18} />
        {t('free')}
      </p>
    </section>
  );
}
