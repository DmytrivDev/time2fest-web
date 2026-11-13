/**
 * Тост — лише поки свято йде (рішення власника 2026-11-13): до й після свята немає кнопки в шапці, смуги тостів,
 * рядка тосту в пасі, а `useOpenToastWindow().open()` нічого не робить (застаріле посилання не відкриє оплату).
 */
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Header } from '@/components/shell/Header';
import { ToastGift } from '@/components/toast/ToastGift';
import { ToastStrip } from '@/components/toast/ToastStrip';
import { useOpenToastWindow } from '@/components/toast/ToastWindow';
import { useGuestStore } from '@/stores/guest';
import { useToastStore } from '@/stores/toast';
import { renderPage } from './render';

const BEFORE = '2026-12-28T12:00:00Z';
const DURING = '2026-12-31T22:40:00Z';
const AFTER = '2027-01-02T12:00:00Z';

function Opener() {
  const open = useOpenToastWindow();
  return (
    <button type="button" onClick={() => open({ tier: 10 })}>
      Відкрити тост
    </button>
  );
}

beforeEach(() => {
  useGuestStore.getState().resetGuest();
  useToastStore.getState().reset();
  useToastStore.setState({ said: [] });
});

describe('тост лише під час свята', () => {
  it('свято йде: у шапці «Сказати тост», смуга, рядок тосту в пасі, вікно відкривається', () => {
    renderPage(
      <>
        <Header />
        <ToastStrip variant="desk" />
        <ToastGift variant="window" />
        <Opener />
      </>,
      DURING,
    );
    expect(screen.getByRole('link', { name: 'Сказати тост' }).getAttribute('href')).toMatch(/^\/support\/?$/);
    expect(document.querySelector('[data-toast-strip]')).not.toBeNull();
    expect(document.querySelector('[data-row="toast-gift"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити тост' }));
    expect(screen.getByRole('dialog', { name: 'Сказати тост' })).toBeInTheDocument();
  });

  for (const [label, at] of [
    ['до свята', BEFORE],
    ['після свята', AFTER],
  ] as const) {
    it(`${label}: кнопки в шапці, смуги й рядка в пасі немає; вікно не відкривається`, () => {
      renderPage(
        <>
          <Header />
          <ToastStrip variant="desk" />
          <ToastStrip variant="phone" />
          <ToastGift variant="page" />
          <Opener />
        </>,
        at,
      );
      expect(screen.queryByRole('link', { name: 'Сказати тост' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Новорічний пас' })).toBeInTheDocument();
      expect(document.querySelector('[data-toast-strip]')).toBeNull();
      expect(document.querySelector('[data-row="toast-gift"]')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Відкрити тост' }));
      expect(screen.queryByRole('dialog', { name: 'Сказати тост' })).toBeNull();
      expect(useToastStore.getState().tier).not.toBe(10);
    });
  }

  it('шапка: обробник відкриває вікно замість переходу', () => {
    let opened = 0;
    renderPage(<Header toast onToastClick={() => (opened += 1)} />, DURING);
    fireEvent.click(screen.getByRole('link', { name: 'Сказати тост' }));
    expect(opened).toBe(1);
  });
});
