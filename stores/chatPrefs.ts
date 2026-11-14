/**
 * Налаштування чату (меню «⋯», рішення власника 2026-10-30, дошки `O-CHAT-MENU · …`, v110): тихий режим, переклад,
 * сповіщення про відповіді, показ свого шляху. Усе — можливості пасу: без пасу діють як вимкнені, хоч би що збережено.
 * «Показувати мій шлях» з пасом увімкнений одразу (`null` — ще не міняли). Зберігається на пристрої.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useHasPass } from '@/lib/api/hooks/auth';

export type ChatPrefKey = 'quiet' | 'translate' | 'notifyReplies' | 'showRoute';

export interface ChatPrefsState {
  quiet: boolean;
  translate: boolean;
  notifyReplies: boolean;
  /** `null` — за замовчуванням (з пасом — увімкнено). */
  showRoute: boolean | null;
  set(key: ChatPrefKey, value: boolean): void;
  reset(): void;
}

const DEFAULTS = { quiet: false, translate: false, notifyReplies: false, showRoute: null } as const;

export const useChatPrefs = create<ChatPrefsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (key, value) => set({ [key]: value } as Partial<ChatPrefsState>),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: 't2f:chat-prefs',
      version: 1,
      partialize: (s) => ({ quiet: s.quiet, translate: s.translate, notifyReplies: s.notifyReplies, showRoute: s.showRoute }),
    },
  ),
);

/** Чинне значення з урахуванням пасу: без пасу все вимкнено. */
export function effectivePref(prefs: Pick<ChatPrefsState, ChatPrefKey>, key: ChatPrefKey, hasPass: boolean): boolean {
  if (!hasPass) return false;
  return key === 'showRoute' ? prefs.showRoute ?? true : prefs[key];
}

/** Хук: чинне значення одного налаштування для гостя. */
export function useChatPref(key: ChatPrefKey): boolean {
  const hasPass = useHasPass();
  const value = useChatPrefs((s) => (key === 'showRoute' ? s.showRoute : s[key]));
  return effectivePref({ quiet: false, translate: false, notifyReplies: false, showRoute: null, [key]: value } as Pick<ChatPrefsState, ChatPrefKey>, key, hasPass);
}
