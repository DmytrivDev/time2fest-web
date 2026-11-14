/**
 * Куди повернути після входу (`/login/`, `/signup/`): сторінка, з якої людина пішла входити.
 * `sessionStorage` вкладки; збій сховища → головна.
 */
import { safeGet, safeRemove, safeSet } from '@/lib/storage/safe';

const KEY = 't2f:session:authReturn';

function isAuthPath(path: string): boolean {
  return /^\/(login|signup)(\/|$|\?)/.test(path);
}

export function rememberReturn(path: string): void {
  if (!path.startsWith('/') || path.startsWith('//') || isAuthPath(path)) return;
  safeSet('session', KEY, path);
}

/** Шлях повернення (без видалення — «До трансляцій» і після входу ведуть туди ж). */
export function returnPath(): string {
  const path = safeGet('session', KEY);
  return path && path.startsWith('/') && !path.startsWith('//') && !isAuthPath(path) ? path : '/';
}

export function clearReturn(): void {
  safeRemove('session', KEY);
}

const SENT_KEY = 't2f:session:authSent';

/** Код для входу вже надіслано (напр. зі сторінки пасу: «На цю адресу пас уже оформлено») — `/login/` відкриється з кроку «Введи код». */
export function rememberCodeSent(): void {
  safeSet('session', SENT_KEY, '1');
}

/** Чи прийшли з надісланим кодом (одноразово). */
export function takeCodeSent(): boolean {
  const sent = safeGet('session', SENT_KEY) === '1';
  if (sent) safeRemove('session', SENT_KEY);
  return sent;
}

const WELCOME_KEY = 't2f:session:authWelcome';

/**
 * Новий акаунт Google повернувся на сторінку без вікон (напр. `/pass/`): `/signup/` відкриється з кроку «Акаунт
 * створено» · «Як тебе показувати» (рішення власника 2026-11-14).
 */
export function rememberWelcome(): void {
  safeSet('session', WELCOME_KEY, '1');
}

/** Чи чекає крок профілю нового акаунта (одноразово). */
export function takeWelcome(): boolean {
  const on = safeGet('session', WELCOME_KEY) === '1';
  if (on) safeRemove('session', WELCOME_KEY);
  return on;
}

/** Поточна адреса сторінки для `rememberReturn`. */
export function currentPath(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname + window.location.search;
}
