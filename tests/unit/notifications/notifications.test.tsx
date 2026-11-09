/** Сповіщення (рішення власника 2026-11-09): стор (одне на подію, вимкнені типи, «прочитати все») і вікно (нові / раніше, порожньо). */
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsBody, NotifSettings } from '@/components/notifications/NotificationsBody';
import messages from '@/messages/uk.json';
import { TimeProvider } from '@/lib/time/TimeProvider';
import { TimeMachine } from '@/lib/time/timeMachine';
import { useNotifStore } from '@/stores/notifications';

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="uk" messages={messages}>
      <TimeProvider source={new TimeMachine({ at: Date.parse('2027-01-01T01:00:00+02:00'), speed: 0 })}>{ui}</TimeProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  useNotifStore.setState({ items: [], enabled: true, kinds: { live: true, stamp: true, reply: true, goal: true, seat: true, streak: true } });
});

describe('стор сповіщень', () => {
  it('одне сповіщення на подію; вимкнений тип і «усі» вимкнено — не додаються', () => {
    const st = useNotifStore.getState();
    st.push({ id: 'stamp:e1', kind: 'stamp', params: { country: 'Японія', city: 'Токіо' }, href: '/passport/' });
    st.push({ id: 'stamp:e1', kind: 'stamp', params: { country: 'Японія', city: 'Токіо' }, href: '/passport/' });
    expect(useNotifStore.getState().items).toHaveLength(1);
    st.setKind('reply', false);
    st.push({ id: 'reply:m1', kind: 'reply', params: { nick: 'Hiro', text: 'hi' }, href: '/' });
    expect(useNotifStore.getState().items).toHaveLength(1);
    st.setEnabled(false);
    st.push({ id: 'goal:countries:3', kind: 'goal', params: { count: 3, what: 'countries' }, href: '/passport/' });
    expect(useNotifStore.getState().items).toHaveLength(1);
  });
});

describe('вікно сповіщень', () => {
  it('порожньо — «Поки тихо»', () => {
    wrap(<NotificationsBody onSettings={() => undefined} />);
    expect(screen.getByText('Поки тихо')).toBeTruthy();
  });

  it('нові зверху з лічильником, «Позначити все прочитаним» переносить у «Раніше»; «Налаштувати» викликає другий рівень', () => {
    const st = useNotifStore.getState();
    st.push({ id: 'stamp:e1', kind: 'stamp', params: { country: 'Японія', city: 'Токіо' }, href: '/passport/', flag: 'JP' });
    st.push({ id: 'goal:countries:5', kind: 'goal', params: { count: 5, what: 'countries' }, href: '/passport/' });
    const onSettings = vi.fn();
    wrap(<NotificationsBody onSettings={onSettings} />);
    expect(screen.getByRole('heading', { name: 'Нові · 2' })).toBeTruthy();
    expect(screen.getByText('5 країн за свято!')).toBeTruthy();
    expect(screen.getByText('Штамп «Японія» у паспорті')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Позначити все прочитаним' }));
    expect(screen.getByRole('heading', { name: 'Раніше' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Нові/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Налаштувати' }));
    expect(onSettings).toHaveBeenCalled();
  });

  it('налаштування: «Усі сповіщення» вимикає й блокує типи', () => {
    wrap(<NotifSettings />);
    fireEvent.click(screen.getByRole('switch', { name: 'Відповіді в чаті' }));
    expect(useNotifStore.getState().kinds.reply).toBe(false);
    fireEvent.click(screen.getByRole('switch', { name: 'Усі сповіщення' }));
    expect(useNotifStore.getState().enabled).toBe(false);
    expect(screen.getByRole('switch', { name: 'Штамп у паспорті' })).toBeDisabled();
  });
});
