// Свято штампа в шапці — React: момент + новий штамп → золота шапка; повний екран відкладає; наведення — пауза;
// дзвіночок +1 лише наприкінці; оголошення один раз; клік — до картки штампу.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from '@/components/shell/Header';
import { CelebrationContent } from '@/components/shell/HeaderCelebration';
import { resetCelebration, useStampCelebration } from '@/components/shell/useStampCelebration';
import { LiveAnnouncer } from '@/components/primitives/a11y/LiveAnnouncer';
import { getData } from '@/lib/data/load';
import { buildStamp } from '@/lib/engine/presence';
import { emit } from '@/lib/events/bus';
import type { MomentStamp } from '@/lib/events/types';
import { TimeProvider } from '@/lib/time/TimeProvider';
import messages from '@/messages/uk.json';
import { useGuestStore } from '@/stores/guest';

const PARIS = 'evt_paris_2027';
const STAMP_AT = Date.parse('2026-12-31T23:00:15Z');

function Harness({ onActivate }: { onActivate?: () => void }) {
  const cel = useStampCelebration({ guest: false });
  return (
    <Header
      user={{ name: 'Олена', flag: 'UA' }}
      notifications={3}
      celebration={cel.celebration ? { celebration: cel.celebration, phase: cel.phase, reduced: cel.reduced, paused: cel.paused, guest: false, onActivate } : null}
      onCelebrationHold={cel.setHold}
      avatarGlow={cel.glow}
    />
  );
}

function renderHarness(onActivate?: () => void) {
  return render(
    <NextIntlClientProvider locale="uk" messages={messages as never}>
      <TimeProvider override={{ at: STAMP_AT, frozen: true }}>
        <LiveAnnouncer minIntervalMs={0}>
          <Harness onActivate={onActivate} />
        </LiveAnnouncer>
      </TimeProvider>
    </NextIntlClientProvider>,
  );
}

function grant(eventIds: string[]) {
  const data = getData();
  const payload = {
    eventKey: `stamp:test:${eventIds.join()}`,
    at: STAMP_AT,
    firedAt: STAMP_AT,
    slotMidnightUtc: '2026-12-31T23:00:00Z',
    eventIds,
    presentEventIds: eventIds,
    presenceSources: Object.fromEntries(eventIds.map((id) => [id, 'air'])),
    countries: [],
    announce: { cityId: '', text: 'midnight-stamp-ready' },
  } as MomentStamp;
  act(() => {
    emit('moment:stamp', payload);
    for (const id of eventIds) {
      const event = data.eventsById.get(id)!;
      useGuestStore.getState().addStamp(buildStamp({ event, country: data.countriesByIso.get(event.countryIso), city: data.citiesById.get(event.cityId), presenceSource: 'air' }));
    }
  });
  act(() => {
    vi.advanceTimersByTime(1);
  });
}

const header = () => document.querySelector('header')!;
const setFullscreen = (on: boolean) => {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => (on ? document.body : null) });
  act(() => {
    document.dispatchEvent(new Event('fullscreenchange'));
  });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  useGuestStore.getState().resetGuest();
  resetCelebration();
  document.documentElement.setAttribute('data-reduce-motion', 'false');
});
afterEach(() => {
  setFullscreen(false);
  vi.useRealTimers();
});

describe('свято в шапці', () => {
  it('штамп нараховано — шапка золота з текстом дошки; ≈ 10 с — і звичайна; оголошення одне', () => {
    renderHarness();
    expect(header()).not.toHaveAttribute('data-celebration');
    grant([PARIS]);
    expect(header()).toHaveAttribute('data-celebration', 'fill');
    expect(screen.getByRole('button', { name: /З Новим роком, Франція!.*Штамп у паспорті.*Подивитися штамп/ })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(header()).toHaveAttribute('data-celebration', 'show');
    act(() => {
      vi.advanceTimersByTime(7_600);
    });
    expect(header()).toHaveAttribute('data-celebration', 'fly');
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(header()).not.toHaveAttribute('data-celebration');
    expect(document.querySelector('[data-header-account]')).toHaveAttribute('data-glow');
    act(() => {
      vi.advanceTimersByTime(1_600);
    });
    expect(document.querySelector('[data-header-account]')).not.toHaveAttribute('data-glow');
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain('З Новим роком, Франція! Штамп у паспорті');
  });

  it('наведення мишею — пауза: поки миша на шапці, свято не закінчується', () => {
    renderHarness();
    grant([PARIS]);
    fireEvent.pointerEnter(header(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(header()).toHaveAttribute('data-celebration', 'fill');
    expect(header()).toHaveAttribute('data-celebration-paused');
    fireEvent.pointerLeave(header(), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(header()).not.toHaveAttribute('data-celebration');
  });

  it('повний екран — свята немає; вийшли — «Під час перегляду: Франція зустріла Новий рік»', () => {
    renderHarness();
    setFullscreen(true);
    grant([PARIS]);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(header()).not.toHaveAttribute('data-celebration');
    setFullscreen(false);
    expect(header()).toHaveAttribute('data-celebration');
    expect(screen.getByRole('button', { name: /Під час перегляду:.*Франція зустріла Новий рік/ })).toBeInTheDocument();
  });

  it('штамп без моменту (демо-набір, скидання стану) — свята немає', () => {
    renderHarness();
    const data = getData();
    const event = data.eventsById.get(PARIS)!;
    act(() => {
      useGuestStore.getState().addStamp(buildStamp({ event, country: undefined, city: undefined, presenceSource: 'air' }));
      vi.advanceTimersByTime(1);
    });
    expect(header()).not.toHaveAttribute('data-celebration');
  });

  it('«Зменшити рух»: одразу «show», 9 с — і звичайна шапка, без світіння аватара', () => {
    document.documentElement.setAttribute('data-reduce-motion', 'true');
    useGuestStore.setState({ reducedMotion: true });
    renderHarness();
    grant([PARIS]);
    expect(header()).toHaveAttribute('data-celebration', 'show');
    act(() => {
      vi.advanceTimersByTime(8_900);
    });
    expect(header()).toHaveAttribute('data-celebration', 'show');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(header()).not.toHaveAttribute('data-celebration');
    expect(document.querySelector('[data-header-account]')).not.toHaveAttribute('data-glow');
  });

  it('клік по золотій шапці — onActivate', () => {
    const onActivate = vi.fn();
    renderHarness(onActivate);
    grant([PARIS]);
    fireEvent.click(document.querySelector('[data-celebration-content]')!);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});

describe('CelebrationContent', () => {
  it('кілька штампів — печатки віялом і «Подивитися штампи»', () => {
    const stamps = [
      { eventId: 'a', country: 'Франція', gender: 'f' as const, flagCode: 'FR', grantedAt: STAMP_AT },
      { eventId: 'b', country: 'Німеччина', gender: 'f' as const, flagCode: 'DE', grantedAt: STAMP_AT },
      { eventId: 'c', country: 'Італія', gender: 'f' as const, flagCode: 'IT', grantedAt: STAMP_AT },
    ];
    render(
      <NextIntlClientProvider locale="uk" messages={messages as never}>
        <CelebrationContent celebration={{ id: 1, kind: 'now', stamps }} phase="show" reduced={false} paused={false} guest={false} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('button', { name: /3 нові штампи — Франція, Німеччина, Італія.*Подивитися штампи/ })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-celebration-seals]')[0]!.querySelectorAll('img')).toHaveLength(3);
  });
});
