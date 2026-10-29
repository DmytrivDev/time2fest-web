'use client';

/**
 * Кроки входу й реєстрації (S-AUTH) — спільні для сторінки (`/login/`, `/signup/`) і вікна під час трансляції.
 * Пароля немає, тож технічно вхід і реєстрація — один процес; різниця лише в тому, що показуємо (`mode`).
 * Перший вхід з новою адресою створює акаунт → крок «Акаунт створено»; вхід в наявний акаунт — `onSignedIn`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { GOOGLE_DELAY_MS, isEmail, type AuthIntent } from '@/lib/auth/sim';
import { useAuthStore, type SignInResult } from '@/stores/auth';
import { useTestControls } from '@/stores/testControls';

export type AuthStep =
  | { kind: 'form' }
  | { kind: 'google' }
  | { kind: 'sent' }
  | { kind: 'code' }
  | { kind: 'expired'; email?: string }
  | { kind: 'toomany'; until: number }
  | { kind: 'unavailable' }
  | { kind: 'otherDevice'; email: string; validUntil: number }
  | { kind: 'welcome'; email: string };

export type EmailIssue = 'empty' | 'invalid' | null;
export type CodeIssue = 'wrong' | 'expired' | 'burned' | 'incomplete' | null;

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
  const [code, setCode] = useState('');
  const [codeIssue, setCodeIssue] = useState<CodeIssue>(null);
  const [googleFailed, setGoogleFailed] = useState(false);
  /** Немає мережі: введене лишається, надішлемо, щойно мережа повернеться. */
  const [offlinePending, setOfflinePending] = useState(false);
  /** Лічильник «Новий лист надіслано» (для оголошення). */
  const [resentAt, setResentAt] = useState<number | null>(null);

  const letter = useAuthStore((s) => s.letter);
  const user = useAuthStore((s) => s.user);
  const signedInSelf = useRef(false);

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
    const waiting = step.kind === 'sent' || step.kind === 'code';
    if (!was && user && !signedInSelf.current && waiting) {
      signedInSelf.current = true;
      onSignedIn({ ok: true, isNew: false, email: user.email });
    }
  }, [user, step.kind, onSignedIn]);

  /** Надіслати лист на `to` (форма, «Надіслати нове», «Надіслати ще раз»). */
  const send = useCallback(
    (to: string, opts: { resend?: boolean } = {}) => {
      if (isOffline()) {
        setOfflinePending(true);
        return;
      }
      setOfflinePending(false);
      if (useTestControls.getState().authUnavailable) {
        setStep({ kind: 'unavailable' });
        return;
      }
      const now = Date.now();
      const res = useAuthStore.getState().sendLetter(to, mode, now);
      if (!res.ok) {
        if (res.reason === 'too-many') setStep({ kind: 'toomany', until: res.until });
        // 'wait': кнопка й так неактивна до кінця відліку.
        return;
      }
      setCode('');
      setCodeIssue(null);
      if (opts.resend) setResentAt(now);
      setStep({ kind: 'sent' });
    },
    [mode],
  );

  const submitEmail = useCallback(() => {
    const value = email.trim();
    const issue: EmailIssue = !value ? 'empty' : isEmail(value) ? null : 'invalid';
    setEmailIssue(issue);
    if (issue) return false;
    send(value);
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

  const submitCode = useCallback(
    (value = code) => {
      if (value.length < 6) {
        setCodeIssue('incomplete');
        return;
      }
      const res = useAuthStore.getState().verifyCode(value, Date.now());
      if (res.ok) {
        setCodeIssue(null);
        finish(res);
        return;
      }
      setCodeIssue(res.reason === 'none' ? 'expired' : res.reason);
    },
    [code, finish],
  );

  // Google: імітований перехід і повернення.
  const googleTimer = useRef<number | null>(null);
  const startGoogle = useCallback(() => {
    setGoogleFailed(false);
    setStep({ kind: 'google' });
    if (googleTimer.current) window.clearTimeout(googleTimer.current);
    googleTimer.current = window.setTimeout(() => {
      googleTimer.current = null;
      if (useTestControls.getState().googleCancelled) {
        setGoogleFailed(true);
        setStep({ kind: 'form' });
        return;
      }
      finish(useAuthStore.getState().signInGoogle(Date.now()));
    }, GOOGLE_DELAY_MS);
  }, [finish]);
  const cancelGoogle = useCallback(() => {
    if (googleTimer.current) window.clearTimeout(googleTimer.current);
    googleTimer.current = null;
    setStep({ kind: 'form' });
  }, []);
  useEffect(
    () => () => {
      if (googleTimer.current) window.clearTimeout(googleTimer.current);
    },
    [],
  );

  const changeEmail = useCallback(() => {
    if (letter && !email) setEmail(letter.email);
    setCodeIssue(null);
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
    code,
    setCode: (v: string) => {
      setCode(v);
      if (codeIssue === 'incomplete' || codeIssue === 'wrong') setCodeIssue(null);
    },
    codeIssue,
    googleFailed,
    offlinePending,
    resentAt,
    letter,
    send,
    submitEmail,
    submitCode,
    startGoogle,
    cancelGoogle,
    changeEmail,
    finish,
  };
}

export type AuthFlow = ReturnType<typeof useAuthFlow>;
