/**
 * Тестова збірка: «Сповіщення (лічильник)» у тестовій панелі й `window.__t2f.setNotifications(n)` — підкласти N нових
 * сповіщень усіх типів (замість лише числа на дзвіночку), щоб побачити список, «Нові · N» і «Позначити все прочитаним».
 */
import { useNotifStore, type Notif } from '@/stores/notifications';

const SAMPLES: Omit<Notif, 'id' | 'read' | 'createdAt'>[] = [
  { kind: 'live', params: { city: 'Париж', country: 'Франція', time: '01:00' }, href: '/country/frantsiia/', flag: 'FR' },
  { kind: 'reply', params: { nick: 'Hiro', text: 'Happy New Year from Tokyo! And to you!' }, href: '/', flag: 'JP' },
  { kind: 'stamp', params: { country: 'Японія', city: 'Токіо' }, href: '/passport/', flag: 'JP' },
  { kind: 'goal', params: { count: 5, what: 'countries' }, href: '/passport/' },
  { kind: 'streak', params: { count: 3 }, href: '/passport/' },
];

/** Час машини часу (тестова збірка), інакше справжній — щоб «щойно / 7 хв» рахувались від того самого «зараз». */
function machineNow(): number {
  const api = (globalThis as { __t2f?: { timeMachine?: { get(): { at: string | number } } } }).__t2f;
  const at = api?.timeMachine?.get().at;
  const ms = typeof at === 'string' ? Date.parse(at) : at;
  return ms && Number.isFinite(ms) ? ms : Date.now();
}

export function seedDemoNotifications(n: number, now = machineNow()): void {
  const st = useNotifStore.getState();
  st.clear();
  const items: Notif[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = SAMPLES[i % SAMPLES.length]!;
    items.push({ ...x, id: `demo:${i}`, read: false, createdAt: now - i * 7 * 60_000 });
  }
  useNotifStore.setState({ items });
}
