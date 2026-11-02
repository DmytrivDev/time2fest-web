import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_MS, OverlayInFlowOutlet, OverlayManager, placementFor, useOverlay, type OverlaySpec } from '@/components/shell/OverlayManager';
import { clearAllHandlers, emit } from '@/lib/events/bus';
import { CoralProvider, useCoralWindowOpen } from '@/lib/overlay/coral';
import { useGuestStore } from '@/stores/guest';

const holder: { current: ReturnType<typeof useOverlay> | null } = { current: null };
/** Поточний API менеджера (оновлюється ефектом після кожного рендеру). */
const api = new Proxy({} as ReturnType<typeof useOverlay>, {
  get: (_t, key: keyof ReturnType<typeof useOverlay>) => holder.current![key],
});
function Probe() {
  const value = useOverlay();
  useEffect(() => {
    holder.current = value;
  });
  return null;
}
function Sound() {
  return <span data-testid="sound">{useCoralWindowOpen() ? 'neutral' : 'coral'}</span>;
}

function mockColumn(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

function setup() {
  return render(
    <CoralProvider>
      <aside id="chat">
        <div id="chat-slot" />
      </aside>
      <OverlayManager>
        <Probe />
        <Sound />
        <OverlayInFlowOutlet />
      </OverlayManager>
    </CoralProvider>,
  );
}

const spec = (over: Partial<OverlaySpec> = {}): OverlaySpec => ({
  id: 'O-NICK',
  kind: 'form',
  title: 'Нік',
  content: <button>Готово</button>,
  ...over,
});

afterEach(() => {
  clearAllHandlers();
  useGuestStore.setState({ chatHidden: false });
});

describe('placementFor', () => {
  it('форма й немодальне: Sheet без колонки чату, панель з нею; inflow — завжди під плеєром', () => {
    expect(placementFor('form', false)).toBe('sheet');
    expect(placementFor('nonmodal', false)).toBe('sheet');
    expect(placementFor('form', true)).toBe('panel');
    expect(placementFor('accent', true)).toBe('panel');
    expect(placementFor('inflow', false)).toBe('inflow');
    expect(placementFor('inflow', true)).toBe('inflow');
    // Телефон з вікном чату: покупка «Першого ряду» — шаром поверх чату, вікна чату — у ньому.
    expect(placementFor('accent', false, false, true)).toBe('seat');
    expect(placementFor('form', false, true, true)).toBe('dock');
    expect(placementFor('accent', true, false, true)).toBe('panel');
  });
});

describe('OverlayManager', () => {
  it('телефон: вікно з введенням відкривається аркушем', () => {
    mockColumn(false);
    setup();
    act(() => api.open(spec()));
    expect(document.querySelector('[data-sheet]')).not.toBeNull();
    expect(document.querySelector('[data-chat-slot-panel]')).toBeNull();
  });

  it('десктоп: те саме вікно — панель на місці чату', () => {
    mockColumn(true);
    setup();
    act(() => api.open(spec()));
    expect(document.querySelector('#chat-slot [data-chat-slot-panel="form"]')).not.toBeNull();
    expect(document.querySelector('[data-sheet]')).toBeNull();
  });

  it('вікно без введення стає в InFlowSlot на будь-якій ширині', () => {
    mockColumn(true);
    setup();
    act(() => api.open(spec({ id: 'O-ACHIEVEMENT', kind: 'inflow', title: 'Штамп', content: <p>Штамп у паспорті</p> })));
    expect(screen.getByText('Штамп у паспорті').closest('[data-in-flow-slot]')?.getAttribute('data-in-flow-slot')).toBe('occupied');
    expect(document.querySelector('[data-sheet]')).toBeNull();
    expect(document.querySelector('[data-chat-slot-panel]')).toBeNull();
  });

  it('одне вікно за раз: нове замінює відкрите й закриває старе', () => {
    mockColumn(false);
    setup();
    const onClose = vi.fn();
    act(() => api.open(spec({ id: 'A', title: 'Перше', onClose })));
    act(() => api.open(spec({ id: 'B', title: 'Друге', content: <i>Друге вікно</i> })));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('[data-sheet]')).toHaveLength(1);
    expect(screen.getByText('Друге вікно')).toBeInTheDocument();
  });

  it('close(id) не чіпає інше вікно; close() закриває', () => {
    mockColumn(false);
    setup();
    act(() => api.open(spec({ id: 'A' })));
    act(() => api.close('B'));
    expect(api.current?.id).toBe('A');
    vi.useFakeTimers();
    try {
      act(() => api.close());
      expect(api.current).toBeNull();
      // Шторка ще їде вниз (рішення 2026-11-02), потім зникає.
      expect(document.querySelector('[data-sheet]')).toHaveAttribute('data-closing', 'true');
      expect(api.closing?.id).toBe('A');
      act(() => vi.advanceTimersByTime(CLOSE_MS + 50));
      expect(document.querySelector('[data-sheet]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('чат сховано на десктопі: колонка тимчасово відкривається і закривається разом з панеллю', () => {
    mockColumn(true);
    useGuestStore.setState({ chatHidden: true });
    setup();
    const aside = document.getElementById('chat')!;
    act(() => api.open(spec()));
    expect(aside.getAttribute('data-chat-forced')).toBe('true');
    act(() => api.close());
    expect(aside.hasAttribute('data-chat-forced')).toBe(false);
  });

  it('на телефоні колонку не відкриває', () => {
    mockColumn(false);
    useGuestStore.setState({ chatHidden: true });
    setup();
    act(() => api.open(spec()));
    expect(document.getElementById('chat')!.hasAttribute('data-chat-forced')).toBe(false);
  });

  it('вікно з кораловою кнопкою робить звук нейтральним, доки відкрите', () => {
    mockColumn(false);
    setup();
    expect(screen.getByTestId('sound')).toHaveTextContent('coral');
    act(() => api.open(spec({ coral: true })));
    expect(screen.getByTestId('sound')).toHaveTextContent('neutral');
    act(() => api.close());
    expect(screen.getByTestId('sound')).toHaveTextContent('coral');
  });

  it('closeOn: подія шини закриває вікно', () => {
    mockColumn(false);
    setup();
    act(() => api.open(spec({ id: 'O-RATE', kind: 'inflow', closeOn: ['moment:rate-close'], content: <p>Оцінка</p> })));
    expect(screen.getByText('Оцінка')).toBeInTheDocument();
    act(() => emit('moment:rate-close', { eventKey: 'k', at: 0, eventIds: [], reason: 'timeout' }));
    expect(screen.queryByText('Оцінка')).toBeNull();
  });
});
