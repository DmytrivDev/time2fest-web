/** Повернення з PayPro (`?order=`): опитування статусу, кінцеві стани, «не вдалося перевірити» після 3 відмов мережі. */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOrderReturn } from '@/lib/api/hooks/checkout';
import { fail, ok } from '@/lib/api/result';
import { getService, setServicesForTest } from '@/lib/api/services';
import type { Order } from '@/lib/api/contracts/checkout';

const order = (status: Order['status']): Order => ({ id: 'o1', clientId: 'c1', product: { kind: 'pass' }, status, createdAt: 0, updatedAt: 0 });

afterEach(() => vi.useRealTimers());

describe('useOrderReturn', () => {
  it('тестове замовлення sim: demo-paid → paid одразу', async () => {
    const { result } = renderHook(() => useOrderReturn('demo-paid'));
    await act(async () => undefined);
    expect(result.current.state.kind).toBe('paid');
  });

  it('pending → опитує далі → paid; кінцевий статус зупиняє опитування', async () => {
    vi.useFakeTimers();
    const status = vi.fn().mockResolvedValueOnce(ok(order('pending'))).mockResolvedValueOnce(ok(order('paid')));
    const restore = setServicesForTest({ checkout: { ...getService('checkout'), status, subscribe: () => () => undefined } });
    const { result } = renderHook(() => useOrderReturn('o1'));
    await act(async () => undefined);
    expect(result.current.state.kind).toBe('pending');
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.state.kind).toBe('paid');
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(status).toHaveBeenCalledTimes(2);
    restore();
  });

  it('мережа тричі поспіль — «не вдалося перевірити»; «Перевірити ще» починає знову', async () => {
    vi.useFakeTimers();
    const status = vi.fn().mockResolvedValue(fail('network'));
    const restore = setServicesForTest({ checkout: { ...getService('checkout'), status, subscribe: () => () => undefined } });
    const { result } = renderHook(() => useOrderReturn('o1'));
    await act(async () => undefined);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.state.kind).toBe('failed');
    status.mockResolvedValue(ok(order('declined')));
    await act(async () => result.current.retry());
    expect(result.current.state.kind).toBe('declined');
    restore();
  });
});
