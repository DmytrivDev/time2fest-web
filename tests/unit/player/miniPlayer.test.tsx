import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MiniPlayer } from '@/components/player/MiniPlayer';
import { PlayerSlot } from '@/components/player/PlayerSlot';
import {
  boxesOverlap,
  cornerAvoiding,
  cornerBox,
  MINI_HEIGHT,
  MINI_WIDTH,
  nextCorner,
} from '@/lib/player/miniPlayerCorners';
import { PlayerProvider, usePlayerInternals } from '@/lib/player/PlayerProvider';
import { MINI_SLOT_ATTR } from '@/lib/player/useMiniPlayerVisibility';
import { wrap } from '../_support/render';

const VIEWPORT = { width: 1440, height: 900 };

describe('кути мініплеєра', () => {
  it('розмір: відео 356×200 + смуга 44 + рамка', () => {
    expect(MINI_WIDTH).toBe(358);
    expect(MINI_HEIGHT).toBe(246);
  });

  it('типові кути ліві: колонка чату праворуч не перекривається', () => {
    const chat = { top: 80, left: 1000, width: 400, height: 700 };
    expect(boxesOverlap(cornerBox('bottom-left', VIEWPORT), chat)).toBe(false);
    expect(boxesOverlap(cornerBox('top-left', VIEWPORT), chat)).toBe(false);
    expect(boxesOverlap(cornerBox('bottom-right', VIEWPORT), chat)).toBe(true);
  });

  it('nextCorner ходить по колу', () => {
    expect(nextCorner('bottom-left')).toBe('top-left');
    expect(nextCorner('top-left')).toBe('bottom-left');
    expect(nextCorner('top-left', ['top-left', 'bottom-left', 'bottom-right'])).toBe('bottom-left');
  });

  it('фокус під мініплеєром → інший кут; без перекриття — лишається', () => {
    const under = { ...cornerBox('bottom-left', VIEWPORT), width: 100, height: 40 };
    expect(cornerAvoiding('bottom-left', ['bottom-left', 'top-left'], under, VIEWPORT)).toBe('top-left');
    const free = { top: 300, left: 600, width: 100, height: 40 };
    expect(cornerAvoiding('bottom-left', ['bottom-left', 'top-left'], free, VIEWPORT)).toBeNull();
  });

  it('усі кути заняті — null', () => {
    const everywhere = { top: 0, left: 0, width: VIEWPORT.width, height: VIEWPORT.height };
    expect(cornerAvoiding('bottom-left', ['bottom-left', 'top-left'], everywhere, VIEWPORT)).toBeNull();
  });
});

describe('MiniPlayer', () => {
  it('прихований — нічого не рендерить', () => {
    const { container } = render(wrap(<MiniPlayer title="Лондон · Біг-Бен" visible={false} />));
    expect(container.querySelector('[data-mini-player]')).toBeNull();
  });

  it('видимий: область «Мініплеєр», чотири керування у порядку Повернутися → ×', () => {
    const onReturn = vi.fn();
    const onFullscreen = vi.fn();
    const onClose = vi.fn();
    render(wrap(<MiniPlayer title="Лондон · Біг-Бен" visible onReturn={onReturn} onFullscreen={onFullscreen} onClose={onClose} />));
    expect(screen.getByRole('region', { name: 'Мініплеєр · Лондон · Біг-Бен' })).toBeInTheDocument();
    const buttons = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(buttons).toEqual(['Повернутися', 'Повний екран', 'Перемістити в інший кут', 'Закрити мініплеєр і зупинити відео']);
    fireEvent.click(screen.getByRole('button', { name: 'Повернутися' }));
    fireEvent.click(screen.getByRole('button', { name: 'Повний екран' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрити мініплеєр і зупинити відео' }));
    expect(onReturn).toHaveBeenCalledOnce();
    expect(onFullscreen).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('«Перемістити в інший кут» змінює кут (некерований)', () => {
    const onCornerChange = vi.fn();
    const { container } = render(wrap(<MiniPlayer title="Лондон" visible onCornerChange={onCornerChange} />));
    const root = container.querySelector('[data-mini-player]')!;
    expect(root).toHaveAttribute('data-corner', 'bottom-left');
    fireEvent.click(screen.getByRole('button', { name: 'Перемістити в інший кут' }));
    expect(root).toHaveAttribute('data-corner', 'top-left');
    expect(onCornerChange).toHaveBeenCalledWith('top-left');
  });

  it('фокус під мініплеєром переносить його в інший кут', () => {
    const { container } = render(
      wrap(
        <>
          <button type="button">під ним</button>
          <MiniPlayer title="Лондон" visible />
        </>,
      ),
    );
    const root = container.querySelector('[data-mini-player]')!;
    const under = screen.getByRole('button', { name: 'під ним' });
    const box = cornerBox('bottom-left', { width: window.innerWidth, height: window.innerHeight });
    under.getBoundingClientRect = () => ({ ...box, x: box.left, y: box.top, right: box.left + 10, bottom: box.top + 10, toJSON: () => ({}) }) as DOMRect;
    act(() => under.focus());
    expect(root).toHaveAttribute('data-corner', 'top-left');
  });
});

describe('MiniPlayer і єдиний хост плеєра', () => {
  let slot: HTMLElement | null = null;
  function Probe() {
    const { slotElement } = usePlayerInternals();
    useEffect(() => {
      slot = slotElement;
    });
    return null;
  }

  it('при показі хост пересідає на слот мініплеєра, при закритті повертається на основний; другого слота `main` не створюється', () => {
    const tree = (visible: boolean) =>
      wrap(
        <PlayerProvider>
          <PlayerSlot />
          <Probe />
          <MiniPlayer title="Лондон" visible={visible} />
        </PlayerProvider>,
      );
    const { rerender, container } = render(tree(false));
    const main = container.querySelector('[data-player-slot="main"]') as HTMLElement;
    expect(slot).toBe(main);

    rerender(tree(true));
    expect(slot).not.toBe(main);
    expect(slot).toHaveAttribute(MINI_SLOT_ATTR);
    expect(container.querySelectorAll('[data-player-host]')).toHaveLength(0);

    rerender(tree(false));
    expect(slot).toBe(main);
  });
});
