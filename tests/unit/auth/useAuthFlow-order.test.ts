/**
 * Вхід кодом: сесія з’являється раніше, ніж `finish` розв’язує «новий акаунт чи ні». Ефект «інша вкладка увійшла» не має
 * вистрілити за наш власний код — інакше `/login/` перекидає на `/`, вікно закривається, а крок «Акаунт створено» пропущено.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthFlow } from '@/components/auth/useAuthFlow';
import { authActions } from '@/lib/api/hooks/auth';
import { useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';

beforeEach(() => {
  useAuthStore.setState({ user: null, accounts: [], code: null, sends: [], passes: {}, devicePass: null, pendingPassGift: null });
  useGuestStore.getState().resetGuest();
});

async function openCodeStep(email: string, onSignedIn: () => void) {
  await authActions.requestCode(email, 'signup');
  return renderHook(() => useAuthFlow({ mode: 'signup', initialStep: { kind: 'code' }, initialEmail: email, onSignedIn }));
}

describe('useAuthFlow: порядок сесії і finish', () => {
  it('нова адреса: після коду — крок «welcome», onSignedIn не викликано', async () => {
    const onSignedIn = vi.fn();
    const { result } = await openCodeStep('olena@example.com', onSignedIn);
    await act(async () => {
      result.current.setCode(useAuthStore.getState().code!.code);
    });
    await waitFor(() => expect(result.current.step.kind).toBe('welcome'));
    expect(useAuthStore.getState().user?.email).toBe('olena@example.com');
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('наявна адреса: одразу onSignedIn, один раз', async () => {
    useAuthStore.setState({ accounts: ['anna@example.com'] });
    const onSignedIn = vi.fn();
    const { result } = await openCodeStep('anna@example.com', onSignedIn);
    await act(async () => {
      result.current.setCode(useAuthStore.getState().code!.code);
    });
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(onSignedIn).toHaveBeenCalledWith({ ok: true, isNew: false, email: 'anna@example.com' });
  });

  it('вхід в іншій вкладці, поки чекаємо код тут, — onSignedIn', async () => {
    const onSignedIn = vi.fn();
    const { result } = await openCodeStep('olena@example.com', onSignedIn);
    expect(result.current.step.kind).toBe('code');
    act(() => useAuthStore.getState().signInVerified('olena@example.com', Date.now()));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
  });
});
