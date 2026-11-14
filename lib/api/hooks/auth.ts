'use client';

/**
 * Хуки доменів «Вхід» і «Профіль» (`docs/backend/frontend-seam.md`, E3) — єдине, що бачать компоненти.
 * Сесія — ресурс кешу з `peek`: перший клієнтський кадр після гідратації вже бачить того, хто увійшов (як раніше
 * `hydrated && useAuthStore.user`), а сервіс тихо оновлює. Пас — лише `session.hasPass` (не окремий стан гостя).
 * Дії асинхронні й повертають `ApiResult` — крок вікна вирішує компонент (`useAuthFlow`).
 */
import { useSyncExternalStore } from 'react';
import type { AuthIntent, DevLetter, Session } from '../contracts/auth';
import type { Profile, ProfilePatch } from '../contracts/profile';
import { createResource, useResource } from '../resource';
import { getService } from '../services';

export const authSession = createResource<Session, Session>(() => {
  const svc = getService('auth');
  return { load: () => svc.session(), subscribe: (cb) => svc.subscribe(cb), reduce: (_, s) => s, peek: () => svc.peek() };
});

export interface SessionView {
  /** `false` — на сервері, під час гідратації й до першої відповіді сервісу (показуємо як гостя). */
  ready: boolean;
  session: Session | null;
}

export function useSession(): SessionView {
  const st = useResource(authSession);
  return { ready: st.data !== undefined, session: st.data ?? null };
}

/** Пас того, хто увійшов (до готовності сесії — `false`, як раніше до гідратації). */
export function useHasPass(): boolean {
  return useSession().session?.hasPass ?? false;
}

/** Остання відома сесія поза React (обробники, перевірки після дії). */
export function currentSession(): Session | null {
  // Спершу — локальний кеш адаптера (свіжий навіть тоді, коли ресурс зараз ніхто не слухає), далі — кеш ресурсу.
  return getService('auth').peek() ?? authSession.getSnapshot().data ?? null;
}

/** Пас того, хто увійшов, поза React (обробники, правила пропозицій). Джерело — сесія, а не стан гостя. */
export function hasPassNow(): boolean {
  return currentSession()?.hasPass ?? false;
}

export const authActions = {
  emailSignIn: (email: string, intent: AuthIntent) => getService('auth').emailSignIn(email, intent),
  sendLink: (email: string, intent: AuthIntent) => getService('auth').sendLink(email, intent),
  openLink: (token: string) => getService('auth').openLink(token),
  google: (opts: { returnPath: string; signal?: AbortSignal }) => getService('auth').google(opts),
  signOut: () => getService('auth').signOut(),
  /** Свіжа сесія від сервісу (сторінка входу: «уже увійшов — далі»). */
  session: () => getService('auth').session(),
} as const;

const noMailbox = () => () => undefined;
const nullLetter = () => null;

/** Тестова пошта (лише `sim`): останній «лист» і «зробити простроченим». У `http` — `null`. */
export function useDevMailbox(): { letter: DevLetter | null; expire: () => void } | null {
  const box = getService('auth').devMailbox;
  const letter = useSyncExternalStore(box?.subscribe ?? noMailbox, box?.get ?? nullLetter, nullLetter);
  return box ? { letter, expire: box.expire } : null;
}

export const profileResource = createResource<Profile, Profile>(() => {
  const svc = getService('profile');
  return { load: () => svc.get(), subscribe: svc.subscribe ? (cb) => svc.subscribe!(cb) : undefined, reduce: (_, p) => p, peek: () => svc.peek?.() };
});

/** Профіль (нік, прапор, графік, налаштування кабінету). На сервері й під час гідратації — `null`. */
export function useProfile(): Profile | null {
  return useResource(profileResource).data ?? null;
}

const NO_SCHEDULE: readonly string[] = [];

/** «Мій графік» (профіль). */
export function useSchedule(): readonly string[] {
  return useProfile()?.schedule ?? NO_SCHEDULE;
}

/** Профіль поза React (обробники) — свіжий кеш адаптера. */
export function currentProfile(): Profile | null {
  return getService('profile').peek?.() ?? profileResource.getSnapshot().data ?? null;
}

export const profileActions = {
  update: (patch: ProfilePatch) => getService('profile').update(patch),
  /** «Мій графік» (профіль, шов E5b): у `sim` зміна синхронна в сторі гостя — наступний рядок уже бачить новий графік. */
  setSchedule: (eventIds: readonly string[]) => getService('profile').setSchedule(eventIds),
  toggleSchedule: (eventId: string) => getService('profile').toggleSchedule(eventId),
  replaceSchedule: (outIso: string, eventId: string) => getService('profile').replaceSchedule(outIso, eventId),
  changeEmail: (email: string) => getService('profile').changeEmail(email),
  cancelEmailChange: () => getService('profile').cancelEmailChange(),
  linkGoogle: () => getService('profile').linkGoogle(),
  unlinkGoogle: () => getService('profile').unlinkGoogle(),
  exportData: () => getService('profile').exportData(),
  deleteAccount: () => getService('profile').deleteAccount(),
  /** Тестова збірка: «лист підтвердження відкрито». */
  devConfirmEmail: () => getService('profile').devConfirmEmail?.(),
} as const;
