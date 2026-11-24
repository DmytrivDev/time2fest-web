/** Налаштування моніторингу (SPEC-13b, AC-66): стелі витрат, ціни Cloudflare, час пульсу й дайджесту. Власник читає; запис — через слайс (W33). */
import type { GlobalConfig } from 'payload';
import { ownerOnly } from '../access/policies';

const never = () => false;
const ro = { readOnly: true } as const;

export const opsSettings: GlobalConfig = {
  slug: 'ops-settings',
  label: 'Моніторинг',
  admin: { group: 'Моніторинг' },
  access: { read: ownerOnly, update: never, readVersions: ownerOnly },
  fields: [
    { name: 'serverCeilingUsd', type: 'number', label: 'Стеля сервера за місяць, USD', defaultValue: 12, admin: ro },
    { name: 'cloudflareCeilingUsd', type: 'number', label: 'Стеля Cloudflare за місяць, USD', defaultValue: 10, admin: ro },
    { name: 'mailCeilingUsd', type: 'number', label: 'Стеля пошти за місяць, USD', defaultValue: 10, admin: ro },
    { name: 'priceStoragePerGbUsd', type: 'number', label: 'Ціна сховища R2, USD/ГБ', defaultValue: 0.015, admin: ro },
    { name: 'priceClassAPerMillionUsd', type: 'number', label: 'Ціна операцій класу A, USD/млн', defaultValue: 4.5, admin: ro },
    { name: 'priceClassBPerMillionUsd', type: 'number', label: 'Ціна операцій класу B, USD/млн', defaultValue: 0.36, admin: ro },
    { name: 'freeClassA', type: 'number', label: 'Безплатно: клас A', defaultValue: 1000000, admin: ro },
    { name: 'freeClassB', type: 'number', label: 'Безплатно: клас B', defaultValue: 10000000, admin: ro },
    { name: 'freeStorageGb', type: 'number', label: 'Безплатно: сховище, ГБ', defaultValue: 10, admin: ro },
    { name: 'heartbeatMinute', type: 'number', label: 'Хвилина щогодинного пульсу', defaultValue: 0, min: 0, max: 59, admin: ro },
    { name: 'digestTime', type: 'text', label: 'Час дайджесту (Київ, ГГ:ХХ)', defaultValue: '09:00', admin: ro },
    { name: 'version', type: 'number', label: 'Версія', defaultValue: 0, admin: ro },
  ],
};
