'use client';

/**
 * Кроки входу й реєстрації (S-AUTH) — спільні для сторінки (`/login/`, `/signup/`) і вікна під час трансляції.
 * Пароля немає, тож вхід і реєстрація — один процес; різниця лише в текстах (`mode`).
 * Google — головна кнопка; пошта — код із 6 цифр (рішення власника 2026-11-13): пошта → «надсилаємо…» → крок `code`
 * (одне поле, вставка 6 цифр, вхід на 6-й цифрі) → «перевіряємо…» → новий акаунт — «Акаунт створено», наявний — `onSignedIn`.
 * Однаково для нової адреси й наявної; входу без коду немає.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authCodeError, type AuthIntent } from '@/lib/api/contracts/auth';
import { authActions, useSession } from '@/lib/api/hooks/auth';
import { isEmail } from '@/lib/auth/email';
import { currentPath, returnPath } from '@/lib/auth/returnTo';
import { useTestControls } from '@/stores/testControls';

/** Вхід відбувся (`isNew` — акаунт створено цим входом). */
export type SignInResult = { ok: true; isNew: boolean; email: string };

export type AuthStep =
  | { kind: 'form' }
  /** Вікно під трансляцією: «Що дає акаунт» (і пас) замість форми. */
  | { kind: 'perks' }
  | { kind: 'google' }
  /** Код надіслано — поле коду. */
  | { kind: 'code' }
  /** Забагато кодів за 10 хвилин. */
  | { kind: 'toomany'; until: number }
  | { kind: 'unavailable' }
  | { kind: 'welcome'; email: string };

export type EmailIssue = 'empty' | 'invalid' | null;

/** Стан поля коду. */
export type CodeState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'wrong'; left: number }
  /** 5 невдалих спроб — код згорів, потрібен новий. */
  | { kind: 'too-many' }
  /** Код діє 10 хвилин (або його вже використано) — потрібен новий. */
  | { kind: 'expired' }
  /** Немає зв’язку — код не перевірено, можна повторити. */
  | { kind: 'network' };

/** Що сталося з «Надіслати ще раз». */
export type ResendState = { kind: 'idle' } | { kind: 'sent'; at: number } | { kind: 'network' } | { kind: 'limited'; until: number };

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

export const CODE_DIGITS = 6;

export function useAuthFlow({ mode, initialStep, initialEmail = '', onSignedIn }: AuthFlowOptions) {
  const [step, setStep] = useState<AuthStep>(initialStep ?? { kind: 'form' });
  const [email, setEmail] = useState(initialEmail);
  const [emailIssue, setEmailIssue] = useState<EmailIssue>(null);
  const [googleFailed, setGoogleFailed] = useState(false);
  /** Немає мережі: введене лишається, надішлемо, щойно мережа повернеться. */
  const [offlinePending, setOfflinePending] = useState(false);
  /** Запит коду в дорозі — «Надсилаємо…» (повторне натискання ігнорується). */
  const [sending, setSending] = useState(false);
  /** Сервіс не відповів на запит коду (мережа впала посеред запиту) — рядок помилки, повтор — кнопкою. */
  const [sendFailed, setSendFailed] = useState(false);
  const [code, setCodeValue] = useState('');
  const [codeState, setCodeState] = useState<CodeState>({ kind: 'idle' });
  const [resend, setResend] = useState<ResendState>({ kind: 'idle' });

  // Сесія й код — із сервісу входу; дії асинхронні.
  const { session } = useSession();
  const codeInfo = session?.code ?? null;
  const user = session?.user ?? null;
  const signedInSelf = useRef(false);
  const inFlight = useRef(false);
  const checking = useRef(false);

  const finish = useCallback(
    (res: SignInResult) => {
      signedInSelf.current = true;
      if (res.isNew) setStep({ kind: 'welcome', email: res.email });
      else onSignedIn(res);
    },
    [onSignedIn],
  );

  // Інша вкладка увійшла (код введено там) — і ця вже увійшла.
  const hadUser = useRef(user !== null);
  useEffect(() => {
    const was = hadUser.current;
    hadUser.current = user !== null;
    const waiting = step.kind === 'code';
    if (!was && user && !signedInSelf.current && waiting) {
      signedInSelf.current = true;
      onSignedIn({ ok: true, isNew: false, email: user.email });
    }
  }, [user, step.kind, onSignedIn]);

  /** Пошта, на яку чекаємо код. */
  const codeEmail = codeInfo?.email ?? email.trim();

  /** Надіслати код на `to` (форма, «Надіслати ще раз», «Надіслати новий код»). */
  const send = useCallback(
    async (to: string, opts: { resend?: boolean } = {}) => {
      const fromCode = opts.resend === true;
      if (isOffline()) {
        if (fromCode) setResend({ kind: 'network' });
        else setOfflinePending(true);
        return;
      }
      setOfflinePending(false);
      setSendFailed(false);
      if (inFlight.current) return;
      inFlight.current = true;
      setSending(true);
      const now = Date.now();
      const res = await authActions.requestCode(to, mode).finally(() => {
        inFlight.current = false;
        setSending(false);
      });
      if (!res.ok) {
        const kind = authCodeError(res.error);
        const until = now + (res.error.retryAfterMs ?? 0);
        if (kind === 'unavailable') setStep({ kind: 'unavailable' });
        else if (kind === 'network') {
          // Не автоповтор (як для «немає мережі» в браузері): сервер міг упасти — людина повторює сама.
          if (fromCode) setResend({ kind: 'network' });
          else setSendFailed(true);
        } else if (kind === 'rate-limited') {
          if (fromCode) setResend({ kind: 'limited', until });
          else setStep({ kind: 'toomany', until });
        } else if (kind === 'cooldown') {
          // Код на цю адресу щойно йшов — той самий крок з відліком до нового.
          setStep({ kind: 'code' });
        }
        return;
      }
      setCodeValue('');
      setCodeState({ kind: 'idle' });
      setResend(fromCode ? { kind: 'sent', at: now } : { kind: 'idle' });
      setStep({ kind: 'code' });
    },
    [mode],
  );

  const submitEmail = useCallback(() => {
    const value = email.trim();
    const issue: EmailIssue = !value ? 'empty' : isEmail(value) ? null : 'invalid';
    setEmailIssue(issue);
    if (issue) return false;
    void send(value);
    return true;
  }, [email, send]);

  /** Перевірити код (6-та цифра чи «Увійти»). */
  const verify = useCallback(
    async (value: string) => {
      const digits = value.replace(/\D/g, '');
      if (digits.length !== CODE_DIGITS || checking.current) return;
      if (isOffline()) {
        setCodeState({ kind: 'network' });
        return;
      }
      checking.current = true;
      setCodeState({ kind: 'checking' });
      const res = await authActions.verifyCode(codeEmail, digits).finally(() => {
        checking.current = false;
      });
      if (res.ok) {
        setCodeState({ kind: 'idle' });
        finish({ ok: true, isNew: res.value.isNew, email: res.value.email });
        return;
      }
      const kind = authCodeError(res.error);
      if (kind === 'wrong-code') {
        setCodeValue('');
        setCodeState({ kind: 'wrong', left: res.error.attemptsLeft ?? 0 });
      } else if (kind === 'too-many-attempts') setCodeState({ kind: 'too-many' });
      else if (kind === 'expired') setCodeState({ kind: 'expired' });
      else if (kind === 'unavailable') setStep({ kind: 'unavailable' });
      else setCodeState({ kind: 'network' });
    },
    [codeEmail, finish],
  );

  const setCode = useCallback(
    (v: string) => {
      const digits = v.replace(/\D/g, '').slice(0, CODE_DIGITS);
      setCodeValue(digits);
      // Помилку «не підходить» прибираємо, щойно людина знову друкує; згорілий і прострочений код лишаються.
      setCodeState((st) => (st.kind === 'wrong' || st.kind === 'network' ? { kind: 'idle' } : st));
      if (digits.length === CODE_DIGITS) void verify(digits);
    },
    [verify],
  );

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
    // Куди Google поверне (у `http` — повний перехід): зі сторінки входу — туди, звідки прийшли входити; з вікна — на ту ж сторінку.
    const back = /^\/(login|signup)(\/|$)/.test(window.location.pathname) ? returnPath() : currentPath();
    const res = await authActions.google({ returnPath: back, signal: run.signal });
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

  /** «Змінити пошту»: назад до форми з тією ж адресою в полі. */
  const changeEmail = useCallback(() => {
    if (codeInfo && !email) setEmail(codeInfo.email);
    setCodeValue('');
    setCodeState({ kind: 'idle' });
    setResend({ kind: 'idle' });
    setStep({ kind: 'form' });
  }, [codeInfo, email]);

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
    sendFailed,
    sending,
    code,
    setCode,
    codeState,
    resend,
    codeInfo,
    codeEmail,
    send,
    verify,
    submitEmail,
    startGoogle,
    cancelGoogle,
    changeEmail,
    finish,
  };
}

export type AuthFlow = ReturnType<typeof useAuthFlow>;
