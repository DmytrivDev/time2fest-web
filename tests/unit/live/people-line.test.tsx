import { screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Caption, type CaptionPlace } from '@/components/live/Caption';
import { captionPhase } from '@time2fest/rules/time';
import { event, LONDON_MIDNIGHT, RIO_MIDNIGHT } from '../fixtures/data';
import { renderWithApp } from '../_support/render';

const london = event('london', LONDON_MIDNIGHT);
const rio = event('rio', RIO_MIDNIGHT, { countryIso: 'BR' });
const place: CaptionPlace = {
  midnightMs: LONDON_MIDNIGHT,
  city: { name: { uk: 'Лондон' }, landmark: { uk: 'Біг-Бен' } } as CaptionPlace['city'],
  country: { name: { uk: 'Велика Британія' }, gender: 'f' } as CaptionPlace['country'],
  href: '/country/velyka-brytaniia/',
};
const phase = captionPhase(LONDON_MIDNIGHT - 600_000, london, 'broadcast', rio);

beforeAll(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })));
});

describe('рядок «Зараз на Time2Fest N людей» під відео', () => {
  it('є люди: повне й коротке речення з назвою сайту, число згруповане', () => {
    renderWithApp(<Caption phase={phase} current={place} live timeZone="Europe/Kyiv" watchers={12480} />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/Зараз на Time2Fest 12\s?480 людей/);
    expect(text).not.toMatch(/країн/);
  });

  it('планшет-портрет (variant bar): коротке речення', () => {
    renderWithApp(<Caption variant="bar" phase={phase} current={place} live timeZone="Europe/Kyiv" watchers={12480} />);
    expect(document.querySelector('[data-bar-watchers]')?.textContent).toMatch(/^На Time2Fest 12\s?480 людей$/);
  });

  it('людей 0 або число відсутнє: рядка немає і немає «0»', () => {
    for (const people of [0, undefined]) {
      const { unmount } = renderWithApp(<Caption phase={phase} current={place} live timeZone="Europe/Kyiv" watchers={people} />);
      expect(screen.queryByText(/Time2Fest/)).toBeNull();
      expect(document.querySelector('[data-bar-watchers]')).toBeNull();
      unmount();
    }
  });
});
