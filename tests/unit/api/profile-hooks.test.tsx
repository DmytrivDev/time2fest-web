/** Шов, залишки E5: профіль (нік, прапор, графік) і пас через сервіси — хуки `useProfile`, `useSchedule`, `useHasPass`. */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { currentProfile, hasPassNow, profileActions, useHasPass, useProfile, useSchedule } from '@/lib/api/hooks/auth';
import { createSimProfile } from '@/lib/api/sim/profile';
import { useGuestStore } from '@/stores/guest';
import { grantTestPass, revokeTestPass } from '@/tests/unit/_support/pass';

describe('профіль через сервіс', () => {
  it('peek: нік і графік видно в першому ж кадрі; запис через profileActions оновлює підписників', () => {
    useGuestStore.getState().setNick('Олена', 'UA');
    useGuestStore.getState().setSchedule(['evt_kyiv_2027']);
    const { result } = renderHook(() => ({ profile: useProfile(), schedule: useSchedule() }));
    expect(result.current.profile).toMatchObject({ nick: 'Олена', flagCode: 'UA' });
    expect(result.current.schedule).toEqual(['evt_kyiv_2027']);
    act(() => void profileActions.update({ nick: 'Оля', flagCode: 'PL' }));
    expect(result.current.profile).toMatchObject({ nick: 'Оля', flagCode: 'PL' });
    expect(useGuestStore.getState().nick).toBe('Оля');
    expect(currentProfile()?.nick).toBe('Оля');
  });

  it('знімок сталий, поки поля профілю не змінились (інші зміни стану гостя профіль не будять)', () => {
    const svc = createSimProfile();
    const a = svc.peek!();
    useGuestStore.getState().setLastRoom('country:UA');
    expect(svc.peek!()).toBe(a);
    useGuestStore.getState().setNick('Нове');
    expect(svc.peek!()).not.toBe(a);
  });
});

describe('пас — лише з сесії', () => {
  it('гість без входу паса не має; вхід з пасом — є; поза React — hasPassNow', () => {
    const { result } = renderHook(() => useHasPass());
    expect(result.current).toBe(false);
    act(() => grantTestPass());
    expect(result.current).toBe(true);
    expect(hasPassNow()).toBe(true);
    act(() => revokeTestPass());
    expect(result.current).toBe(false);
  });

  it('повторне монтування після змін без слухачів бачить свіже значення в тому ж кадрі', () => {
    const first = renderHook(() => useHasPass());
    expect(first.result.current).toBe(false);
    first.unmount();
    grantTestPass();
    const second = renderHook(() => useHasPass());
    expect(second.result.current).toBe(true);
  });
});
