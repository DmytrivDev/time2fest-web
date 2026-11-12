import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthorPanel, type AuthorPanelProps } from '@/components/live/AuthorPanel';
import chatScript from '@/data/chat-script.json';
import zonemap from '@/data/zonemap.json';
import { buildAuthorPath } from '@/lib/chat-sim/authorPath';
import { getData } from '@/lib/data/load';
import type { Author, ChatMessage, ChatScriptFile } from '@/lib/data/types';
import { renderApp, stubBrowserApis } from '../us1/render';

const script = chatScript as unknown as ChatScriptFile;
const data = getData();
const geometry = zonemap as unknown as NonNullable<AuthorPanelProps['geometry']>;

const KARIM: Author = { id: 'u_karim', nick: 'Karim', flagCode: 'EG', badges: ['pass'] };
const BOHDAN: Author = { id: 'u_bohdan', nick: 'Богдан', flagCode: 'UA', badges: ['pass'] };
const AMIRA: Author = { id: 'u_amira', nick: 'Аміра', flagCode: 'CA', badges: ['pass'] };
const TARAS: Author = { id: 'u_taras', nick: 'Тарас', flagCode: 'UA', badges: [] };
const OLENA: Author = { id: 'u_olena', nick: 'Олена', flagCode: 'UA', badges: ['pass'] };

const msg = (author: Author): ChatMessage => ({
  id: 'm1',
  room: 'world',
  kind: 'regular',
  createdAt: Date.parse('2027-01-01T01:37:00Z'),
  author,
  text: 'Привіт!',
  moderation: 'ok',
});

function show(author: Author, extra: Partial<AuthorPanelProps> = {}) {
  const hasPass = author.badges.length > 0;
  const props: AuthorPanelProps = {
    author,
    countryName: 'Україна',
    message: msg(author),
    hasPass,
    path: buildAuthorPath(author, script, data),
    geometry,
    onReport: vi.fn(),
    onPassInfo: vi.fn(),
    onGetPass: vi.fn(),
    ...extra,
  };
  renderApp(<AuthorPanel {...props} />);
  return props;
}

describe('панель автора O-AUTHOR (C13)', () => {
  beforeAll(stubBrowserApis);
  afterEach(cleanup);

  it('пас і зустрічі: шапка з бейджем, підсумок, картка зі списком — зустрінуті, потім заплановані, без часу', async () => {
    const user = userEvent.setup();
    show(KARIM, { countryName: 'Єгипет' });
    expect(screen.getByRole('heading', { name: 'Karim' })).toBeInTheDocument();
    expect(document.querySelector('[data-badge="pass"]')).toHaveTextContent('Новорічний пас');
    expect(document.querySelector('[data-row="message"]')).toBeNull();
    expect(screen.queryByText('Реакція на повідомлення')).not.toBeInTheDocument();
    expect(screen.getByText('2 країни · ще 1 у графіку')).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: /Переглянути шлях/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('3');
    await user.click(trigger);
    const rows = Array.from(document.querySelectorAll('[data-row="rows"] li'));
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.hasAttribute('data-planned'))).toEqual([false, false, true]);
    expect(rows[0]).toHaveTextContent('Окленд · Нова Зеландія');
    expect(rows[2]).toHaveTextContent('У графіку');
    expect(document.querySelector('[data-row="rows"] time')).toBeNull();
    expect(screen.queryByText('Ще ніде не зустрів Новий рік')).not.toBeInTheDocument();
  });

  it('«Першого ряду» немає (прибрано 2026-11-12): ні позначки, ні «місце N» у списку — лише позначка пасу', async () => {
    const user = userEvent.setup();
    show(OLENA);
    expect(document.querySelector('[data-badge="first-row"]')).toBeNull();
    expect(document.querySelector('[data-badge="pass"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: /Переглянути шлях/ }));
    expect(document.querySelector('[data-row="rows"]')).not.toHaveTextContent(/Перший ряд|місце/);
  });

  it('довга назва країни — в один рядок з трикрапкою (повна — у підказці), позначка ціла', () => {
    show(OLENA, { countryName: 'Демократична Республіка Конго' });
    const country = document.querySelector('[data-row="country"]')!;
    expect(country).toHaveClass('truncate');
    expect(country).toHaveAttribute('title', 'Демократична Республіка Конго');
    expect(document.querySelector('[data-badge="pass"]')).toHaveClass('shrink-0');
  });

  it('пас, але нічого не зустрів: «Зустрічей ще нема · ще 2 у графіку», у списку порожній рядок і графік', async () => {
    const user = userEvent.setup();
    show(BOHDAN);
    expect(screen.getByText('Зустрічей ще нема · ще 2 у графіку')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Переглянути шлях/ }));
    expect(screen.getByText('Ще ніде не зустрів Новий рік')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-row="rows"] li[data-planned]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-point="met"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-point="planned"]')).toHaveLength(2);
  });

  it('пас, ні зустрічей, ні графіка: «Зустрічей ще нема», картка порожня', async () => {
    const user = userEvent.setup();
    show(AMIRA, { path: [] });
    expect(screen.getByText('Зустрічей ще нема')).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: /Переглянути шлях/ });
    expect(trigger).toHaveTextContent('0');
    await user.click(trigger);
    expect(screen.getByText('Ще ніде не зустрів Новий рік')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-row="rows"] li')).toHaveLength(0);
  });

  it('автор без пасу: картки немає, мапа затемнена й недоступна, плашка з ніком', () => {
    show(TARAS);
    expect(screen.queryByRole('button', { name: /Переглянути шлях/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Шлях Тарас' })).toBeInTheDocument();
    const locked = document.querySelector('[data-row="locked"]') as HTMLElement;
    expect(locked.querySelector('[inert]')).not.toBeNull();
    expect(within(locked).getByText(/поки не може показати шлях: це можливість Новорічного пасу/)).toBeInTheDocument();
    expect(within(locked).getByText('Тарас', { selector: 'b' })).toBeInTheDocument();
    expect(document.querySelector('[data-badge="pass"]')).toBeNull();
  });

  it('кнопки: лише «Поскаржитись» («Відповісти» і «Згадати» — у меню «⋯»)', async () => {
    const user = userEvent.setup();
    const props = show(KARIM);
    const actions = document.querySelector('[data-row="actions"]') as HTMLElement;
    expect(within(actions).getAllByRole('button')).toHaveLength(1);
    await user.click(within(actions).getByRole('button', { name: 'Поскаржитись' }));
    expect(props.onReport).toHaveBeenCalledOnce();
    // Підтвердження — на місці кнопки, як у меню повідомлення (2026-11-10).
    expect(within(actions).getByRole('status')).toHaveTextContent('Дякуємо, скаргу передано');
    expect(within(actions).queryByRole('button', { name: 'Поскаржитись' })).toBeNull();
  });

  it('«Поскаржитись» без повідомлення й обробника теж дає підтвердження', async () => {
    const user = userEvent.setup();
    show(OLENA, { message: undefined, onReport: undefined });
    const actions = document.querySelector('[data-row="actions"]') as HTMLElement;
    await user.click(within(actions).getByRole('button', { name: 'Поскаржитись' }));
    expect(document.querySelector('[data-row="reported"]')).toHaveTextContent('Дякуємо, скаргу передано');
  });

  it('плашка пасу для глядача без пасу: «Оформити пас» і «Що ще дає пас?»; з пасом — плашки немає', async () => {
    const user = userEvent.setup();
    const props = show(KARIM, { viewerHasPass: false });
    const promo = document.querySelector('[data-row="promo"]') as HTMLElement;
    expect(promo).toHaveTextContent('Хочеш, щоб інші бачили твій шлях? Оформи Новорічний пас.');
    await user.click(within(promo).getByRole('button', { name: 'Що ще дає пас?' }));
    expect(props.onPassInfo).toHaveBeenCalledOnce();
    await user.click(within(promo).getByRole('button', { name: 'Оформити пас' }));
    expect(props.onGetPass).toHaveBeenCalledOnce();
    cleanup();
    show(KARIM, { viewerHasPass: true });
    expect(document.querySelector('[data-row="promo"]')).toBeNull();
  });

  it('свій нік: «Ти» в рядку ніка, мапа й «Переглянути шлях» навіть без пасу, без «Поскаржитись»', async () => {
    const user = userEvent.setup();
    show({ id: 'me', nick: 'Мирон', flagCode: 'UA', badges: [], isMine: true }, { hasPass: false, path: [], viewerHasPass: true });
    const nick = screen.getByRole('heading', { name: 'Мирон' });
    expect(nick.parentElement).toHaveTextContent('Ти');
    expect(document.querySelector('[data-row="path"]')).not.toBeNull();
    expect(document.querySelector('[data-row="locked"]')).toBeNull();
    expect(screen.getByText('Зустрічей ще нема')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Переглянути шлях/ }));
    expect(screen.getByText('Ще ніде не зустрів Новий рік')).toBeInTheDocument();
    expect(document.querySelector('[data-row="actions"]')).toBeNull();
  });
});
