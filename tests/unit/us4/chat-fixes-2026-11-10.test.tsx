/**
 * Правки власника 2026-11-10 (чат і картка автора): шлях автора без шляху в сценарії, підказки сусідніх
 * точок мапи шляху (зона — найближча точка), копії бігучого рядка клікабельні, вікно «Переклад повідомлень» без пасу.
 * Згенерований шлях учасника «Першого ряду» прибрано разом із рядом (2026-11-12).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TranslateGate, translateExample } from '@/components/chat/parts/TranslateGate';
import { hitSizes, nearestPoint } from '@/components/map/PathMap';
import { Marquee } from '@/components/primitives/Marquee';
import chatScript from '@/data/chat-script.json';
import { buildAuthorPath } from '@/lib/chat/authorPath';
import { getData } from '@/lib/data/load';
import type { Author, ChatMessage, ChatScriptFile } from '@/lib/data/types';
import { renderApp, stubBrowserApis } from '../us1/render';

const script = chatScript as unknown as ChatScriptFile;
const data = getData();
const LONDON_MIDNIGHT = Date.parse('2027-01-01T00:00:00Z');

describe('шлях автора без шляху в сценарії', () => {
  it('buildAuthorPath: шлях зі сценарію лишається; без нього — порожньо (згенерованого шляху учасника ряду більше немає)', () => {
    const hiro: Author = { id: 'u_hiro', nick: 'Hiro', flagCode: 'JP', badges: ['pass'] };
    expect(buildAuthorPath(hiro, script, data).map((p) => p.id)).toContain('evt_tokyo_2027');
    const amira: Author = { id: 'u_amira', nick: 'Аміра', flagCode: 'CA', badges: ['pass'] };
    expect(buildAuthorPath(amira, script, data, LONDON_MIDNIGHT + 60_000)).toEqual([]);
    expect(buildAuthorPath({ id: 'x', nick: 'Хтось', badges: ['pass'] }, script, data)).toEqual([]);
    expect(buildAuthorPath({ id: 'u_mike', nick: 'Mike', badges: [] }, script, data)).toEqual([]);
  });
});

describe('мапа шляху: сусідні точки', () => {
  const pos = [
    { left: 80, top: 30 }, // Сеул
    { left: 81, top: 31 }, // Токіо поруч
    { left: 20, top: 50 }, // окремо
  ];

  it('зони сусідів не перекриваються, окрема точка — без обмеження', () => {
    const [a, b, c] = hitSizes(pos, 0.5);
    expect(a).toBeCloseTo(Math.hypot(1, 0.5));
    expect(b).toBeCloseTo(a!);
    expect(c).toBeGreaterThan(50);
  });

  it('мишка — найближча до курсора точка в межах радіуса', () => {
    // Мапа 300 × 150: Сеул (240, 45), Токіо (243, 46.5).
    expect(nearestPoint(pos, 300, 150, 239, 45, 22)).toBe(0);
    expect(nearestPoint(pos, 300, 150, 245, 47, 22)).toBe(1);
    expect(nearestPoint(pos, 300, 150, 150, 10, 22)).toBe(-1);
  });
});

describe('бігуча стрічка: копії', () => {
  beforeAll(stubBrowserApis);
  afterEach(cleanup);

  it('копії aria-hidden, без inert; кнопки в них поза Tab, але клікабельні', () => {
    const onClick = vi.fn();
    // Стрічка «не влазить»: jsdom має нульові розміри, тож перевіряємо першу копію й правило для інших через атрибути.
    const { container } = render(
      <Marquee label="Ряд">
        <button type="button" onClick={onClick}>
          Олена
        </button>
      </Marquee>,
    );
    container.querySelectorAll('[data-copy]').forEach((copy) => expect(copy.hasAttribute('inert')).toBe(false));
    container.querySelectorAll('[data-copy="2"] button, [data-copy="3"] button').forEach((b) => expect(b).toHaveAttribute('tabindex', '-1'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Олена', hidden: true })[0]!);
    expect(onClick).toHaveBeenCalled();
  });
});

describe('вікно «Переклад повідомлень» без пасу', () => {
  beforeAll(stubBrowserApis);
  afterEach(cleanup);

  const mehmet: ChatMessage = {
    id: 'm1',
    room: 'world',
    kind: 'regular',
    createdAt: 0,
    author: { id: 'u_mehmet', nick: 'Mehmet', flagCode: 'TR', badges: ['pass'] },
    text: 'Yeni yılınız kutlu olsun!',
    moderation: 'ok',
  };

  it('приклад — повідомлення, яке хотіли перекласти; невідомий текст — привітання Hiro', () => {
    expect(translateExample(mehmet)).toMatchObject({ nick: 'Mehmet', lang: 'tr', translated: 'З Новим роком вас!' });
    expect(translateExample({ ...mehmet, text: 'Something unknown' })).toMatchObject({ nick: 'Hiro', lang: 'ja', translated: 'З Новим роком!' });
  });

  it('оригінал і переклад, «Оформити пас · $5» і «Що дає пас»', () => {
    const onGetPass = vi.fn();
    const onPassInfo = vi.fn();
    renderApp(<TranslateGate message={mehmet} onGetPass={onGetPass} onPassInfo={onPassInfo} />);
    const ex = document.querySelector('[data-row="example"]') as HTMLElement;
    expect(ex).toHaveTextContent('Yeni yılınız kutlu olsun!');
    expect(ex).toHaveTextContent('З Новим роком вас!');
    expect(ex).toHaveTextContent('Перекладено з турецької');
    fireEvent.click(screen.getByRole('button', { name: 'Оформити пас · $5' }));
    expect(onGetPass).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Що дає пас' }));
    expect(onPassInfo).toHaveBeenCalledOnce();
  });
});
