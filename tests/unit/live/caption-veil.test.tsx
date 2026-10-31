import { fireEvent, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Caption, type CaptionPlace } from '@/components/live/Caption';
import { captionPhase } from '@/lib/engine/captionPhase';
import { event, LONDON_MIDNIGHT, MIN, RIO_MIDNIGHT, SEC } from '../fixtures/data';
import { renderWithApp } from '../_support/render';

const london = event('london', LONDON_MIDNIGHT);
const rio = event('rio', RIO_MIDNIGHT, { countryIso: 'BR' });
const place: CaptionPlace = {
  midnightMs: LONDON_MIDNIGHT,
  city: { name: { uk: 'Лондон' }, landmark: { uk: 'Біг-Бен' } } as CaptionPlace['city'],
  country: { name: { uk: 'Велика Британія' }, gender: 'f' } as CaptionPlace['country'],
  href: '/country/velyka-brytaniia/',
};
const phaseAt = (t: number) => captionPhase(LONDON_MIDNIGHT + t, london, 'broadcast', rio);

// Підказка (Tooltip) питає matchMedia про тип вказівника — у jsdom його немає.
beforeAll(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })));
});

describe('таймер під відео: остання хвилина розмита, лише коли йде трансляція', () => {
  it('йде відео, до півночі 30 с: цифри розмиті, «Показати»; натискання показує таймер', () => {
    renderWithApp(<Caption phase={phaseAt(-30 * SEC)} current={place} live timeZone="Europe/Kyiv" />);
    const reveal = screen.getByRole('button', { name: 'Показати таймер — до півночі менше хвилини' });
    expect(screen.getByText('Показати')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveAttribute('aria-label', 'до півночі: менше хвилини');
    fireEvent.click(reveal);
    expect(screen.queryByRole('button', { name: /Показати таймер/ })).toBeNull();
    // пігулка «Показати» гасне
    expect(screen.getByText('Показати').closest('[data-veil-hint]')).toHaveAttribute('data-veil-hint', 'gone');
  });

  it('лише відлік без відео (live=false): не розмито', () => {
    renderWithApp(<Caption phase={phaseAt(-30 * SEC)} current={place} timeZone="Europe/Kyiv" />);
    expect(screen.queryByRole('button', { name: /Показати таймер/ })).toBeNull();
  });

  it('більше хвилини до півночі: не розмито навіть з відео', () => {
    renderWithApp(<Caption phase={phaseAt(-2 * MIN)} current={place} live timeZone="Europe/Kyiv" />);
    expect(screen.queryByRole('button', { name: /Показати таймер/ })).toBeNull();
  });
});
