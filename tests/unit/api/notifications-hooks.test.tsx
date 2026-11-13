/**
 * Шов: хуки сповіщень над підміненим сервісом (`setServicesForTest`) — так само тестуватимуть кожен перенесений домен.
 * Перевіряємо: завантаження й стан, realtime-події, оптимістичні дії, відмову сервісу (перечитування), кеш між монтуваннями.
 */
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NOTIF_SETTINGS, type Notif, type NotifEvent, type NotificationsService } from '@/lib/api/contracts/notifications';
import { notifActions, useNotifications, useNotifSettings, useUnreadNotifCount } from '@/lib/api/hooks/notifications';
import { fail, ok } from '@/lib/api/result';
import { getService, setServicesForTest } from '@/lib/api/services';

const n = (id: string, read = false): Notif => ({ id, kind: 'stamp', params: { country: 'Японія', city: 'Токіо' }, href: '/passport/', read, createdAt: 1 });

/** Фейковий «сервер»: свій список, ручна розсилка подій. */
function fakeService(initial: Notif[]) {
  let items = initial;
  const listeners = new Set<(e: NotifEvent) => void>();
  const svc: NotificationsService = {
    list: vi.fn(async () => ok(items)),
    subscribe: vi.fn((cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    markRead: vi.fn(async () => ok(undefined)),
    getSettings: vi.fn(async () => ok(DEFAULT_NOTIF_SETTINGS)),
    updateSettings: vi.fn(async (patch) => ok({ ...DEFAULT_NOTIF_SETTINGS, ...patch, kinds: { ...DEFAULT_NOTIF_SETTINGS.kinds, ...patch.kinds } })),
  };
  return {
    svc,
    emit: (e: NotifEvent) => listeners.forEach((l) => l(e)),
    setServerItems: (next: Notif[]) => {
      items = next;
    },
    listeners,
  };
}

let restore: () => void = () => undefined;
afterEach(() => restore());

describe('useNotifications', () => {
  let fake: ReturnType<typeof fakeService>;
  beforeEach(() => {
    fake = fakeService([n('a'), n('b', true)]);
    restore = setServicesForTest({ notifications: fake.svc });
  });

  it('idle → ready; лічильник непрочитаних; один запит на кілька компонентів', async () => {
    const { result } = renderHook(() => ({ list: useNotifications(), unread: useUnreadNotifCount() }));
    expect(result.current.list.items).toEqual([]);
    await waitFor(() => expect(result.current.list.status).toBe('ready'));
    expect(result.current.list.items.map((x) => x.id)).toEqual(['a', 'b']);
    expect(result.current.unread).toBe(1);
    expect(fake.svc.list).toHaveBeenCalledTimes(1);
    // Два хуки над одним ресурсом — одна realtime-підписка.
    expect(fake.svc.subscribe).toHaveBeenCalledTimes(1);
  });

  it('realtime: нове сповіщення з’являється без перезапиту', async () => {
    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => fake.emit({ type: 'added', item: n('c') }));
    expect(result.current.items.map((x) => x.id)).toEqual(['c', 'a', 'b']);
    expect(fake.svc.list).toHaveBeenCalledTimes(1);
  });

  it('markAllRead — оптимістично одразу, сервіс отримує ту саму дію', async () => {
    const { result } = renderHook(() => useUnreadNotifCount());
    await waitFor(() => expect(result.current).toBe(1));
    act(() => void notifActions.markAllRead());
    expect(result.current).toBe(0);
    expect(fake.svc.markRead).toHaveBeenCalledWith('all');
  });

  it('відмова сервісу — кеш перечитується з сервера (оптимістичну зміну знято)', async () => {
    vi.mocked(fake.svc.markRead).mockResolvedValueOnce(fail('network'));
    const { result } = renderHook(() => useUnreadNotifCount());
    await waitFor(() => expect(result.current).toBe(1));
    await act(async () => {
      await notifActions.markRead('a');
    });
    expect(result.current).toBe(1);
    expect(fake.svc.list).toHaveBeenCalledTimes(2);
  });

  it('помилка першого завантаження — status error з кодом', async () => {
    vi.mocked(fake.svc.list).mockResolvedValueOnce(fail('unavailable'));
    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.code).toBe('unavailable');
    expect(result.current.items).toEqual([]);
  });

  it('кеш живе між монтуваннями: нове монтування одразу бачить дані й тихо перечитує', async () => {
    const first = renderHook(() => useNotifications());
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    first.unmount();
    expect(fake.listeners.size).toBe(0);
    fake.setServerItems([n('x')]);
    const second = renderHook(() => useNotifications());
    expect(second.result.current.items.map((x) => x.id)).toEqual(['a', 'b']);
    await waitFor(() => expect(second.result.current.items.map((x) => x.id)).toEqual(['x']));
  });
});

describe('useNotifSettings', () => {
  it('типові до завантаження; зміна типу — оптимістично й у сервіс', async () => {
    const fake = fakeService([]);
    vi.mocked(fake.svc.getSettings).mockResolvedValueOnce(ok({ enabled: true, kinds: { ...DEFAULT_NOTIF_SETTINGS.kinds, live: false } }));
    restore = setServicesForTest({ notifications: fake.svc });
    function Probe() {
      const { status, settings } = useNotifSettings();
      return <p data-testid="s">{`${status}:${settings.kinds.live}:${settings.kinds.reply}`}</p>;
    }
    render(<Probe />);
    expect(screen.getByTestId('s').textContent).toBe('loading:true:true');
    await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('ready:false:true'));
    act(() => void notifActions.setKind('reply', false));
    expect(screen.getByTestId('s').textContent).toBe('ready:false:false');
    expect(fake.svc.updateSettings).toHaveBeenCalledWith({ kinds: { reply: false } });
  });
});

describe('реєстр', () => {
  it('без підміни — адаптер sim (режим за замовчуванням)', () => {
    const svc = getService('notifications');
    expect(typeof svc.list).toBe('function');
    expect(getService('notifications')).toBe(svc);
  });

  it('неперенесений домен — зрозуміла помилка', () => {
    expect(() => getService('catalog')).toThrow(/ще не перенесено/);
  });
});
