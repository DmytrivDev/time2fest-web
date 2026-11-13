/**
 * Демо (рішення власника 2026-11-11): людина приходить «наче дивилася ніч без реєстрації» — без акаунта й пасу,
 * але вже зустріла Новий рік у Сіднеї, Токіо, Нью-Делі, Дубаї й Києві: штампи в паспорті й сповіщення
 * про них. Один раз на пристрій (мітка `t2f:demo:v1`); «Скинути стан гостя» стирає мітку — після перезавантаження знову.
 */
import { buildStamp } from '@/lib/engine/presence';
import { getData } from '@/lib/data/load';
import { useGuestStore } from '@/stores/guest';
import { useNotifStore, type Notif } from '@/stores/notifications';

export const DEMO_SEED_KEY = 't2f:demo:v1';
/** Міста, де гість уже зустрів Новий рік до старту демо (схід → захід). */
export const DEMO_MET_EVENTS = ['evt_sydney_2027', 'evt_tokyo_2027', 'evt_new-delhi_2027', 'evt_dubai_2027', 'evt_kyiv_2027'] as const;
/** Цілі паспорта, досягнуті цими п’ятьма (як у `lib/api/sim/NotificationsGenerator`: 3 і 5 країн, 3 і 5 поясів). */
const GOALS = [3, 5] as const;

export function seedDemoOnce(storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null): boolean {
  try {
    if (!storage || storage.getItem(DEMO_SEED_KEY)) return false;
    storage.setItem(DEMO_SEED_KEY, '1');
  } catch {
    return false;
  }
  const data = getData();
  const guest = useGuestStore.getState();
  const notifs: Notif[] = [];
  let countries = 0;
  for (const eventId of DEMO_MET_EVENTS) {
    const event = data.eventsById.get(eventId);
    if (!event) continue;
    const country = data.countriesByIso.get(event.countryIso);
    const city = data.citiesById.get(event.cityId);
    const stamp = buildStamp({ event, country, city, presenceSource: 'air' });
    guest.addStamp(stamp);
    countries += 1;
    const at = stamp.grantedAt;
    notifs.push({
      id: `stamp:${eventId}`,
      kind: 'stamp',
      createdAt: at,
      read: false,
      params: { country: country?.name.uk ?? stamp.cityName, city: stamp.cityName },
      href: '/passport/',
      flag: stamp.countryIso,
    });
    for (const g of GOALS) {
      if (countries !== g) continue;
      for (const what of ['countries', 'zones'] as const) {
        notifs.push({ id: `goal:${what}:${g}`, kind: 'goal', createdAt: at + 1, read: false, params: { count: g, what }, href: '/passport/' });
      }
    }
  }
  // Нові зверху, як у списку; старші за Київ — уже прочитані (людина бачила їх «тієї ночі»).
  const newest = notifs.reduce((m, n) => Math.max(m, n.createdAt), 0);
  const items = notifs
    .map((n) => ({ ...n, read: n.createdAt < newest - 60 * 60_000 }))
    .sort((a, b) => b.createdAt - a.createdAt);
  useNotifStore.setState({ items });
  return true;
}
