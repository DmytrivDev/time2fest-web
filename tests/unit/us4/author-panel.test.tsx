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
const OLENA: Author = { id: 'u_olena', nick: 'Олена', flagCode: 'UA', badges: ['pass', 'first-row'] };

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
    roomLabel: 'Світ',
    hasPass,
    path: buildAuthorPath(author, script, data),
    geometry,
    onReply: vi.fn(),
    onReport: vi.fn(),
    onMention: vi.fn(),
    onPassInfo: vi.fn(),
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
    expect(screen.getByText(/^Повідомлення · \d\d:\d\d · чат «Світ»$/)).toBeInTheDocument();
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

  it('місце «Першого ряду» — примітка в рядку списку', async () => {
    const user = userEvent.setup();
    show(OLENA);
    await user.click(screen.getByRole('button', { name: /Переглянути шлях/ }));
    expect(document.querySelector('[data-row="rows"]')).toHaveTextContent(/Перший ряд · місце \d+/);
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
    expect(within(locked).getByText(/не ділиться шляхом: у нього немає Новорічного пасу/)).toBeInTheDocument();
    expect(within(locked).getByText('Тарас', { selector: 'b' })).toBeInTheDocument();
    expect(document.querySelector('[data-badge="pass"]')).toBeNull();
  });

  it('кнопки: «Відповісти» і «Згадати» поруч (без ніка в підписі, є в aria-label), «Поскаржитись» нижче; дії викликаються', async () => {
    const user = userEvent.setup();
    const props = show(KARIM);
    const actions = document.querySelector('[data-row="actions"]') as HTMLElement;
    const mention = within(actions).getByRole('button', { name: 'Згадати Karim' });
    expect(mention).toHaveTextContent(/^Згадати$/);
    const reply = within(actions).getByRole('button', { name: 'Відповісти' });
    const report = within(actions).getByRole('button', { name: 'Поскаржитись' });
    expect(reply.parentElement).toBe(mention.parentElement);
    expect(report.parentElement).not.toBe(mention.parentElement);
    await user.click(reply);
    await user.click(mention);
    await user.click(report);
    expect(props.onReply).toHaveBeenCalledOnce();
    expect(props.onMention).toHaveBeenCalledWith(KARIM);
    expect(props.onReport).toHaveBeenCalledOnce();
  });

  it('плашка пасу для глядача без пасу: «Оформити пас» і «Що ще дає пас?»; з пасом — плашки немає', async () => {
    const user = userEvent.setup();
    const props = show(KARIM, { viewerHasPass: false });
    const promo = document.querySelector('[data-row="promo"]') as HTMLElement;
    expect(promo).toHaveTextContent('Хочеш, щоб інші бачили твій шлях? Оформи Новорічний пас.');
    await user.click(within(promo).getByRole('button', { name: 'Що ще дає пас?' }));
    expect(props.onPassInfo).toHaveBeenCalledOnce();
    await user.click(within(promo).getByRole('button', { name: 'Оформити пас' }));
    expect(within(promo).getByRole('status')).toHaveTextContent('Оплата буде на наступному етапі');
    cleanup();
    show(KARIM, { viewerHasPass: true });
    expect(document.querySelector('[data-row="promo"]')).toBeNull();
  });

  it('свій нік: без шляху й дій', () => {
    show({ id: 'me', nick: 'Мирон', flagCode: 'UA', badges: [], isMine: true }, { hasPass: false, path: [], viewerHasPass: true });
    expect(document.querySelector('[data-row="path"]')).toBeNull();
    expect(document.querySelector('[data-row="actions"]')).toBeNull();
  });
});
