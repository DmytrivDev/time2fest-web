/**
 * Стан інтерфейсу для `offerEligibility` (`OfferContext.ui`): чи відкрите вікно, чи фокус у полі введення,
 * коли востаннє натискали клавішу. Планувальник живе поза React, тож стан тримаємо в модулі;
 * пише його `useOfferWindows` (вікно) і відстеження введення на `document`.
 */
import type { Ms } from '@/lib/data/types';

export interface OfferUiState {
  overlayOpen: boolean;
  composerFocused: boolean;
  lastKeystrokeAt?: Ms;
}

let state: OfferUiState = { overlayOpen: false, composerFocused: false };

export function getOfferUi(): OfferUiState {
  return state;
}

export function setOverlayOpen(open: boolean): void {
  if (state.overlayOpen !== open) state = { ...state, overlayOpen: open };
}

/** Для тестів. */
export function resetOfferUi(): void {
  state = { overlayOpen: false, composerFocused: false };
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/** Поле, у яке людина вводить текст (поле чату, нік, пошук). */
export function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type);
  return el.isContentEditable;
}

/**
 * Стежить за фокусом і натисканнями в полях введення. `now` — спільний годинник сайту
 * (під «машиною часу» вікно «~10 с після останнього натискання» рахується у віртуальному часі).
 */
export function installTypingTracking(now: () => Ms): () => void {
  const onFocusIn = (e: FocusEvent) => {
    if (isTextField(e.target)) state = { ...state, composerFocused: true };
  };
  const onFocusOut = (e: FocusEvent) => {
    if (isTextField(e.target)) state = { ...state, composerFocused: false };
  };
  const onKey = (e: Event) => {
    if (isTextField(e.target)) state = { ...state, lastKeystrokeAt: now() };
  };
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  document.addEventListener('keydown', onKey);
  document.addEventListener('input', onKey);
  // Поле вже у фокусі до встановлення стеження.
  if (isTextField(document.activeElement)) state = { ...state, composerFocused: true };
  return () => {
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', onFocusOut);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('input', onKey);
    state = { ...state, composerFocused: false };
  };
}
