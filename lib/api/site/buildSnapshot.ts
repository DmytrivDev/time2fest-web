/**
 * Знімок `site` збірки (SPEC-08, AC-51): усе ввімкнено, ціни з PRD, `catalogVersion` вбудованого каталогу.
 * Його віддає адаптер `sim`, а `http` — коли сервер ще не відповів жодного разу і в передстартовій збірці (без мережі).
 * Окремий модуль, бо `lib/api/sim/**` у робочій збірці `http` вирізано (`simEntry.disabled.ts`).
 * Дані каталогу приходять параметром: адаптер `http` сам `lib/data` не читає — постачальника знімка впорскує `http/index.ts`.
 */
import { catalogVersionOf, type SiteState } from '../contracts/site';

/** Мета вбудованого каталогу (`getData().meta`), з якої береться `catalogVersion`. */
export type BuildCatalogMeta = Parameters<typeof catalogVersionOf>[0];

export function buildSnapshot(meta: BuildCatalogMeta): SiteState {
  const price = (amount: number) => ({ amount, currency: 'USD' as const });
  return {
    version: 1,
    at: new Date(0).toISOString(),
    switches: {
      chat: true,
      toasts: true,
      pass: true,
      passGift: true,
      payments: true,
      viewersMap: true,
      passOffer: true,
      chatRooms: {},
      toastTiers: { '2': true, '5': true, '10': true },
    },
    products: [
      { key: 'pass', price: price(500), priceVersion: 1 },
      { key: 'toast:2', price: price(200), priceVersion: 1 },
      { key: 'toast:5', price: price(500), priceVersion: 1 },
      { key: 'toast:10', price: price(1000), priceVersion: 1 },
    ],
    catalogVersion: catalogVersionOf(meta),
    eventPatches: {},
  };
}
