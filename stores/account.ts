/**
 * Налаштування кабінету (`/account/`, дошки `Desk-Cabinet-New2` / `New3`, рішення власника 2026-11-08). Окремо від стору
 * гостя, щоб не міняти його схему: формат часу, країна й пояс, видимість, підказки паспорта, тихий режим,
 * підключений Google. Пароля немає (вхід кодом з листа або Google); зміна пошти — кодом, його тримає `stores/auth` (`code`).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeJsonStorage } from '@/lib/storage/safe';

export const ACCOUNT_STORAGE_KEY = 't2f:account:v1';

export interface AccountSettings {
  /** 12-годинний формат часу (за замовчуванням 24). */
  hour12: boolean;
  /** Країна (ISO) і пояс, обрані людиною; немає — визначаємо автоматично. */
  homeCountry: string | null;
  homeZoneId: string | null;
  /** Інші бачать мій паспорт у профілі з чату. */
  showPassport: boolean;
  /** Мій шлях біля ніка в чаті (з пасом). */
  showPath: boolean;
  /** Блоки про штампи під плеєром (головна, країни, кімната). */
  passportHints: boolean;
  /** Тихий режим чату за замовчуванням (з пасом). */
  quietDefault: boolean;
  /** Google підключено до акаунта з поштою (імітація). */
  googleLinked: boolean;
}

interface AccountActions {
  set<K extends keyof AccountSettings>(key: K, value: AccountSettings[K]): void;
  reset(): void;
}

export const DEFAULT_ACCOUNT: AccountSettings = {
  hour12: false,
  homeCountry: null,
  homeZoneId: null,
  showPassport: true,
  showPath: true,
  passportHints: true,
  quietDefault: false,
  googleLinked: false,
};

export const useAccountStore = create<AccountSettings & AccountActions>()(
  persist(
    (setState) => ({
      ...DEFAULT_ACCOUNT,
      set: (key, value) => setState({ [key]: value } as Partial<AccountSettings>),
      reset: () => setState({ ...DEFAULT_ACCOUNT }),
    }),
    {
      name: ACCOUNT_STORAGE_KEY,
      version: 1,
      storage: safeJsonStorage<AccountSettings>('local'),
      partialize: (s) => {
        const out = {} as Record<string, unknown>;
        for (const k of Object.keys(DEFAULT_ACCOUNT)) out[k] = s[k as keyof AccountSettings];
        return out as unknown as AccountSettings;
      },
      // Лише відомі налаштування: старі `firstRowHidden` («Перший ряд» прибрано 2026-11-12) і `pendingEmail` (зміна пошти
      // листом, до кодів 2026-11-14) не потрапляють у стан.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        const known: Record<string, unknown> = {};
        for (const k of Object.keys(DEFAULT_ACCOUNT)) if (k in p) known[k] = p[k];
        return { ...current, ...(known as Partial<AccountSettings>) };
      },
    },
  ),
);
