import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { CoralProvider, useCoralClaim, useCoralWindowOpen, useRegisterCoral } from '@/lib/overlay/coral';

function SoundButton() {
  const neutral = useCoralWindowOpen();
  return <button data-variant={neutral ? 'neutral' : 'coral'}>Звук</button>;
}

function OfferCard() {
  useRegisterCoral();
  return <button data-variant="coral">Отримати пас</button>;
}

function ClaimProbe({ label, active = true }: { label: string; active?: boolean }) {
  const { hasForeignCoral } = useCoralClaim(active);
  return <span data-testid={label}>{String(hasForeignCoral)}</span>;
}

function Screen() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SoundButton />
      <button onClick={() => setOpen((v) => !v)}>toggle</button>
      {open && <OfferCard />}
    </>
  );
}

const corals = () => document.querySelectorAll('[data-variant="coral"]').length;

describe('правило однієї коралової кнопки', () => {
  it('поки відкрите вікно з власною кораловою кнопкою, кнопка звуку нейтральна', () => {
    render(
      <CoralProvider>
        <Screen />
      </CoralProvider>,
    );
    expect(screen.getByText('Звук')).toHaveAttribute('data-variant', 'coral');
    expect(corals()).toBe(1);

    act(() => screen.getByText('toggle').click());
    expect(screen.getByText('Звук')).toHaveAttribute('data-variant', 'neutral');
    expect(corals()).toBe(1);

    act(() => screen.getByText('toggle').click());
    expect(screen.getByText('Звук')).toHaveAttribute('data-variant', 'coral');
  });

  it('hasForeignCoral бачить лише чужі реєстрації', () => {
    const { rerender } = render(
      <CoralProvider>
        <ClaimProbe label="a" />
      </CoralProvider>,
    );
    expect(screen.getByTestId('a').textContent).toBe('false');
    rerender(
      <CoralProvider>
        <ClaimProbe label="a" />
        <ClaimProbe label="b" />
      </CoralProvider>,
    );
    expect(screen.getByTestId('a').textContent).toBe('true');
    expect(screen.getByTestId('b').textContent).toBe('true');
    rerender(
      <CoralProvider>
        <ClaimProbe label="a" />
        <ClaimProbe label="b" active={false} />
      </CoralProvider>,
    );
    expect(screen.getByTestId('a').textContent).toBe('false');
  });

  it('без провайдера — нічого не падає, вікон немає', () => {
    render(
      <>
        <SoundButton />
        <OfferCard />
      </>,
    );
    expect(screen.getByText('Звук')).toHaveAttribute('data-variant', 'coral');
  });
});
