import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useChatVisibility } from '@/components/chat/hooks/useChatVisibility';
import { OverlayManager, useOverlay } from '@/components/shell/OverlayManager';
import chatScript from '@/data/chat-script.json';
import { authorHasPass, buildAuthorPath, pathSummary, routeCities } from '@/lib/chat/authorPath';
import { getData } from '@/lib/data/load';
import type { ChatScriptFile } from '@/lib/data/types';
import { detectFlagFrom } from '@/lib/geo/detectFlag';
import { CoralProvider } from '@/lib/overlay/coral';
import { createDefaultGuest, useGuestStore } from '@/stores/guest';
import { wrap } from '../us1/render';

const script = chatScript as unknown as ChatScriptFile;

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

describe('сховано чат на десктопі (FR-053)', () => {
  beforeEach(() => {
    useGuestStore.setState({ ...createDefaultGuest() });
    document.body.innerHTML = '<aside id="chat"><div id="chat-slot"></div></aside>';
  });
  afterEach(cleanup);

  it('колонка отримує data-chat-hidden, поки чат сховано; «показати» знімає', () => {
    mockColumn(true);
    const { result } = renderHook(() => useChatVisibility(), { wrapper: ({ children }: { children: ReactNode }) => wrap(<>{children}</>) });
    const aside = document.getElementById('chat')!;
    expect(aside.hasAttribute('data-chat-hidden')).toBe(false);
    act(() => result.current.hide());
    expect(aside.getAttribute('data-chat-hidden')).toBe('true');
    expect(useGuestStore.getState().chatHidden).toBe(true);
    act(() => result.current.show());
    expect(aside.hasAttribute('data-chat-hidden')).toBe(false);
  });

  it('на телефоні колонки немає — атрибута не ставимо', () => {
    mockColumn(false);
    useGuestStore.setState({ chatHidden: true });
    renderHook(() => useChatVisibility(), { wrapper: ({ children }: { children: ReactNode }) => wrap(<>{children}</>) });
    expect(document.getElementById('chat')!.hasAttribute('data-chat-hidden')).toBe(false);
  });

  it('вікно з полем введення тимчасово відкриває колонку (data-chat-forced), закриття повертає', () => {
    mockColumn(true);
    useGuestStore.setState({ chatHidden: true });
    let api!: ReturnType<typeof useOverlay>;
    function Probe() {
      api = useOverlay();
      return null;
    }
    render(
      <CoralProvider>
        <OverlayManager>
          <Probe />
        </OverlayManager>
      </CoralProvider>,
    );
    const aside = document.getElementById('chat')!;
    act(() => api.open({ id: 'O-NICK', kind: 'form', title: 'Нік', content: <input aria-label="Нік" /> }));
    expect(aside.getAttribute('data-chat-forced')).toBe('true');
    act(() => api.close('O-NICK'));
    expect(aside.hasAttribute('data-chat-forced')).toBe(false);
  });
});

describe('шлях автора (C13)', () => {
  const data = getData();

  it('Karim з пасом: три точки за часом, зустрінуті перед запланованою; Taras без пасу — порожньо', () => {
    const karim = { id: 'u_karim', nick: 'Karim', badges: ['pass' as const] };
    const path = buildAuthorPath(karim, script, data);
    expect(path.map((p) => p.planned)).toEqual([false, false, true]);
    expect(path.map((p) => p.midnightMs)).toEqual([...path.map((p) => p.midnightMs)].sort((a, b) => a - b));
    expect(path.every((p) => p.city && p.country && p.flagCode)).toBe(true);
    expect(buildAuthorPath({ id: 'u_taras', nick: 'Тарас', badges: [] }, script, data)).toEqual([]);
    expect(authorHasPass({ badges: ['vip'] })).toBe(true);
    expect(authorHasPass({ badges: [] })).toBe(false);
  });

  it('шлях Олени зі сценарію: підсумок і маршрут', () => {
    const olena = { id: 'u_olena', nick: 'Олена', badges: ['pass' as const] };
    const path = buildAuthorPath(olena, script, data);
    expect(path.length).toBeGreaterThan(1);
    const summary = pathSummary(path);
    expect(summary.met).toBeGreaterThan(0);
    expect(summary.planned).toBeGreaterThan(0);
    const route = routeCities(path);
    expect(route.met.length).toBeGreaterThan(0);
    expect(route.planned.length).toBe(summary.planned);
  });

  it('довгий маршрут скорочується: перше, «+N», останнє', () => {
    const point = (i: number) => ({ id: `e${i}`, city: `М${i}`, country: 'К', flagCode: 'UA', x: 0, y: 0, midnightMs: i, planned: false });
    const route = routeCities(Array.from({ length: 8 }, (_, i) => point(i)));
    expect(route.met).toEqual(['М0', '+6', 'М7']);
  });
});

describe('прапор за розташуванням (без IP)', () => {
  it('мова з регіоном, потім часовий пояс, потім мова без регіону', () => {
    expect(detectFlagFrom({ languages: ['en-GB'], timeZone: 'Europe/Kyiv' })).toBe('GB');
    expect(detectFlagFrom({ languages: ['xx'], timeZone: 'Europe/Kyiv' })).toBe('UA');
    expect(detectFlagFrom({ languages: ['uk'], timeZone: 'Asia/Nowhere' })).toBe('UA');
    expect(detectFlagFrom({ languages: ['en'], timeZone: 'Asia/Nowhere' })).toBeUndefined();
    expect(detectFlagFrom({ languages: [] })).toBeUndefined();
  });
});
