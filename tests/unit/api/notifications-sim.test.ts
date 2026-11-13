/** Шов: адаптер `sim` сповіщень — тонка обгортка над стором імітації (`lib/api/sim/notifications`). */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyNotifEvent, applyNotifSettingsPatch, DEFAULT_NOTIF_SETTINGS, type Notif } from '@/lib/api/contracts/notifications';
import { createSimNotifications } from '@/lib/api/sim/notifications';
import { useNotifStore } from '@/stores/notifications';

const stamp = { id: 'stamp:e1', kind: 'stamp' as const, params: { country: 'Японія', city: 'Токіо' }, href: '/passport/' };
const goal = { id: 'goal:countries:3', kind: 'goal' as const, params: { count: 3, what: 'countries' }, href: '/passport/' };

beforeEach(() => {
  useNotifStore.setState({ items: [], enabled: true, kinds: { ...DEFAULT_NOTIF_SETTINGS.kinds } });
});

describe('sim-адаптер сповіщень', () => {
  it('list і getSettings віддають стан стору', async () => {
    useNotifStore.getState().push(stamp);
    const svc = createSimNotifications();
    const list = await svc.list();
    expect(list.ok && list.value.map((x) => x.id)).toEqual(['stamp:e1']);
    const settings = await svc.getSettings();
    expect(settings).toEqual({ ok: true, value: DEFAULT_NOTIF_SETTINGS });
  });

  it('markRead: одне й усі — делегує стору', async () => {
    const st = useNotifStore.getState();
    st.push(stamp);
    st.push(goal);
    const svc = createSimNotifications();
    expect(await svc.markRead({ ids: ['stamp:e1'] })).toEqual({ ok: true, value: undefined });
    expect(useNotifStore.getState().items.find((x) => x.id === 'stamp:e1')?.read).toBe(true);
    expect(useNotifStore.getState().items.find((x) => x.id === goal.id)?.read).toBe(false);
    await svc.markRead('all');
    expect(useNotifStore.getState().items.every((x) => x.read)).toBe(true);
  });

  it('updateSettings застосовує лише передане й повертає збережене', async () => {
    const svc = createSimNotifications();
    const res = await svc.updateSettings({ kinds: { reply: false } });
    expect(res.ok && res.value.kinds.reply).toBe(false);
    expect(res.ok && res.value.enabled).toBe(true);
    await svc.updateSettings({ enabled: false });
    expect(useNotifStore.getState()).toMatchObject({ enabled: false, kinds: { reply: false, stamp: true } });
  });

  it('subscribe: знімок списку й налаштування при змінах стору; відписка зупиняє', () => {
    const svc = createSimNotifications();
    const onEvent = vi.fn();
    const off = svc.subscribe(onEvent);
    useNotifStore.getState().push(stamp);
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'snapshot', items: useNotifStore.getState().items });
    useNotifStore.getState().setKind('live', false);
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'settings', settings: { enabled: true, kinds: { ...DEFAULT_NOTIF_SETTINGS.kinds, live: false } } });
    off();
    useNotifStore.getState().push(goal);
    expect(onEvent).toHaveBeenCalledTimes(2);
  });
});

describe('чисті правила контракту', () => {
  const n = (id: string, read = false): Notif => ({ ...stamp, id, read, createdAt: 1 });

  it('applyNotifEvent: added без дубля, read — вибрані й усі, snapshot замінює', () => {
    const items = [n('a'), n('b')];
    expect(applyNotifEvent(items, { type: 'added', item: n('c') }).map((x) => x.id)).toEqual(['c', 'a', 'b']);
    expect(applyNotifEvent(items, { type: 'added', item: n('a') })).toBe(items);
    expect(applyNotifEvent(items, { type: 'read', target: { ids: ['b'] } }).map((x) => x.read)).toEqual([false, true]);
    expect(applyNotifEvent(items, { type: 'read', target: 'all' }).every((x) => x.read)).toBe(true);
    expect(applyNotifEvent(items, { type: 'snapshot', items: [n('z')] }).map((x) => x.id)).toEqual(['z']);
    expect(applyNotifEvent(items, { type: 'settings', settings: DEFAULT_NOTIF_SETTINGS })).toBe(items);
  });

  it('applyNotifSettingsPatch не губить інші типи', () => {
    const s = applyNotifSettingsPatch(DEFAULT_NOTIF_SETTINGS, { kinds: { reply: false } });
    expect(s).toEqual({ enabled: true, kinds: { ...DEFAULT_NOTIF_SETTINGS.kinds, reply: false } });
  });
});
