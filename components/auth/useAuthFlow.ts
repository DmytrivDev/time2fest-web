'use client';

/**
 * Кроки входу й реєстрації (S-AUTH) — спільні для сторінки (`/login/`, `/signup/`) і вікна під час трансляції.
 * Пароля немає, тож технічно вхід і реєстрація — один процес; різниця лише в тому, що показуємо (`mode`).
 * Без коду з листа (рішення 2026-10-30): нова адреса — акаунт створено й людина увійшла одразу → «Акаунт створено»;
 * адреса, на яку вже є акаунт, — «Ми надіслали посилання» (вхід — посилання з листа) → `onSignedIn`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthIntent } from '@/lib/api/contracts/auth';
import { authActions, useSession } from '@/lib/api/hooks/auth';
import { isEmail } from '@/lib/auth/email';
import { currentPath } from '@/lib/auth/returnTo';
import { useTestControls } from '@/stores/testControls';

/** Вхід відбувся без листа (`isNew` — акаунт створено цим входом). */
export type SignInResult = { ok: true; isNew: boolean; email: string };

export type AuthStep =
  | { kind: 'form' }
  /** Вікно під трансляцією: «Що дає акаунт» (і пас) замість форми. */
  | { kind: 'perks' }
  | { kind: 'google' }
  | { kind: 'sent' }
  | { kind: 'expired'; email?: string }
  | { kind: 'toomany'; until: number }
  | { kind: 'unavailable' }
  | { kind: 'otherDevice'; email: string }
  | { kind: 'welcome'; email: string };

export type EmailIssue = 'empty' | 'invalid' | null;

export interface AuthFlowOptions {
  mode: AuthIntent;
  initialStep?: AuthStep;
  initialEmail?: string;
  /** Вхід у вже наявний акаунт (сторінка — повернення, вікно — закриття). */
  onSignedIn: (result: SignInResult) => void;
}

function isOffline(): boolean {
  if (useTestControls.getState().offlineSimulated) return true;
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function useAuthFlow({ mode, initialStep, initialEmail = '', onSignedIn }: AuthFlowOptions) {
  const [step, setStep] = useState<AuthStep>(initialStep ?? { kind: 'form' });
  const [email, setEmail] = useState(initialEmail);
  const [emailIssue, setEmailIssue] = useState<EmailIssue>(null);
  const [googleFailed, setGoogleFailed] = useState(false);
  /** Немає мережі: введене лишається, надішлемо, щойно мережа повернеться. */
  const [offlinePending, setOfflinePending] = useState(false);
  /** Лічильник «Новий лист надіслано» (для оголошення). */
  const [resentAt, setResentAt] = useState<number | null>(null);

  // Шов (E3): сесія й лист — з сервісу входу; дії асинхронні.
  const { session } = useSession();
  const letter = session?.link ?? null;
  const user = session?.user ?? null;
  const signedInSelf = useRef(false);
  /** Запит уже в дорозі — повторне натискання не шле другий лист (вигляду «зайнято» немає — див. документ шва). */
  const sending = useRef(false);

  const finish = useCallback(
    (res: SignInResult) => {
      signedInSelf.current = true;
      if (res.isNew) setStep({ kind: 'welcome', email: res.email });
      else onSignedIn(res);
    },
    [onSignedIn],
  );

  // Інша вкладка увійшла (посилання з листа відкрито там) — і ця вже увійшла.
  const hadUser = useRef(user !== null);
  useEffect(() => {
    const was = hadUser.current;
    hadUser.current = user !== null;
    // Лише поки людина чекає на лист (на інших кроках вхід робить сама ця вкладка, напр. посилання з листа тут).
    const waiting = step.kind === 'sent';
    if (!was && user && !signedInSelf.current && waiting) {
      signedInSelf.current = true;
      onSignedIn({ ok: true, isNew: false, email: user.email });
    }
  }, [user, step.kind, onSignedIn]);

  /** Увійти поштою `to` (форма, «Надіслати нове», «Надіслати ще раз»): нова адреса — одразу вхід, інакше — лист з посиланням. */
  const send = useCallback(
    async (to: string, opts: { resend?: boolean } = {}) => {
      if (isOffline()) {
        setOfflinePending(true);
        return;
      }
      setOfflinePending(false);
      if (sending.current) return;
      sending.current = true;
      const now = Date.now();
      const res = await authActions.emailSignIn(to, mode).finally(() => {
        sending.current = false;
      });
      if (!res.ok) {
        const { code, reason, retryAfterMs } = res.error;
        if (code === 'unavailable') setStep({ kind: 'unavailable' });
        else if (code === 'network') setOfflinePending(true);
        else if (code === 'rate_limited' && reason === 'too-many') setStep({ kind: 'toomany', until: now + (retryAfterMs ?? 0) });
        // 'wait': кнопка й так неактивна до кінця відліку.
        return;
      }
      if (res.value.kind === 'signed-in') {
        finish({ ok: true, isNew: res.value.isNew, email: res.value.email });
        return;
      }
      if (opts.resend) setResentAt(now);
      setStep({ kind: 'sent' });
    },
    [mode, finish],
  );

  const submitEmail = useCallback(() => {
    const value = email.trim();
    const issue: EmailIssue = !value ? 'empty' : isEmail(value) ? null : 'invalid';
    setEmailIssue(issue);
    if (issue) return false;
    void send(value);
    return true;
  }, [email, send]);

  // Мережа повернулась — надсилаємо те, що чекало.
  const offlineSim = useTestControls((s) => s.offlineSimulated);
  useEffect(() => {
    if (!offlinePending) return;
    const retry = () => {
      if (!isOffline()) submitEmail();
    };
    if (!offlineSim) retry();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [offlinePending, offlineSim, submitEmail]);

  // Google: сервіс веде перехід і повернення (у `sim` — імітована затримка; «скасовано» — з тестової панелі).
  const googleRun = useRef<AbortController | null>(null);
  const startGoogle = useCallback(async () => {
    setGoogleFailed(false);
    setStep({ kind: 'google' });
    googleRun.current?.abort();
    const run = new AbortController();
    googleRun.current = run;
    const res = await authActions.google({ returnPath: currentPath(), signal: run.signal });
    if (run.signal.aborted) return;
    googleRun.current = null;
    if (!res.ok) {
      if (res.error.code === 'unavailable') setStep({ kind: 'unavailable' });
      else {
        setGoogleFailed(true);
        setStep({ kind: 'form' });
      }
      return;
    }
    if (res.value.kind === 'redirect') {
      window.location.assign(res.value.url);
      return;
    }
    finish({ ok: true, isNew: res.value.isNew, email: res.value.email });
  }, [finish]);
  const cancelGoogle = useCallback(() => {
    googleRun.current?.abort();
    googleRun.current = null;
    setStep({ kind: 'form' });
  }, []);
  useEffect(() => () => googleRun.current?.abort(), []);

  const changeEmail = useCallback(() => {
    if (letter && !email) setEmail(letter.email);
    setStep({ kind: 'form' });
  }, [letter, email]);

  return {
    mode,
    step,
    setStep,
    email,
    setEmail: (v: string) => {
      setEmail(v);
      if (emailIssue) setEmailIssue(!v.trim() ? 'empty' : isEmail(v) ? null : 'invalid');
    },
    emailIssue,
    googleFailed,
    offlinePending,
    resentAt,
    letter,
    send,
    submitEmail,
    startGoogle,
    cancelGoogle,
    changeEmail,
    finish,
  };
}

export type AuthFlow = ReturnType<typeof useAuthFlow>;
