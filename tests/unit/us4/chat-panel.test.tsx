import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatHiddenButton } from '@/components/chat/ChatHiddenButton';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { OverlayManager } from '@/components/shell/OverlayManager';
import { useChatFeed } from '@/lib/chat-sim/store';
import type { Author, ChatMessage } from '@/lib/data/types';
import { CoralProvider } from '@/lib/overlay/coral';
import { useChatUi } from '@/stores/chat';
import { createDefaultGuest, useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';
import { renderApp, stubBrowserApis } from '../us1/render';

stubBrowserApis();

/** 2027-01-01 00:20 UTC: повільний режим сценарію (00:00–00:10) уже скінчився. */
const QUIET = Date.parse('2027-01-01T00:20:00Z');
/** 00:05 UTC: повільний режим «Світу» діє. */
const SLOW = Date.parse('2027-01-01T00:05:00Z');

const KARIM: Author = { id: 'u_karim', nick: 'Karim', flagCode: 'EG', badges: ['pass'] };
const TARAS: Author = { id: 'u_taras', nick: 'Тарас', flagCode: 'UA', badges: [] };

const message = (id: string, author: Author, text: string, at = QUIET - 60_000): ChatMessage => ({
  id,
  room: 'world',
  kind: 'regular',
  createdAt: at,
  author,
  text,
  moderation: 'ok',
});

function setup(now = QUIET, ui = <ChatPanel />) {
  return renderApp(
    <CoralProvider>
      <OverlayManager>{ui}</OverlayManager>
    </CoralProvider>,
    now,
  );
}

/** Поле чату; під модальним вікном (Sheet) решта сторінки схована від зчитувача, тож `hidden: true`. */
const field = () => screen.getByRole('textbox', { name: /Повідомлення в чат/, hidden: true });

beforeEach(() => {
  useChatFeed.getState().reset();
  useChatUi.getState().reset();
  useGuestStore.setState({ ...createDefaultGuest(), nick: undefined, flagCode: undefined, detectedFlag: undefined });
  useTestControls.setState({ chatAvailable: true, offlineSimulated: false });
  useChatFeed.getState().append([message('m1', KARIM, 'Привіт з Каїра!'), message('m2', TARAS, 'У нас уже святкують', QUIET - 30_000)]);
});
afterEach(cleanup);

// Вікна й userEvent у jsdom повільні: запас на кожен тест.
vi.setConfig({ testTimeout: 20_000 });

describe('ChatPanel — вікно ніка на першому власному повідомленні (FR-051)', () => {
  it('гість: «Надіслати» відкриває O-NICK, текст лишається в полі', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(field(), 'З Новим роком!');
    await user.click(screen.getByRole('button', { name: 'Надіслати' }));
    expect(await screen.findByRole('dialog', { name: /Як тебе підписати/ })).toBeInTheDocument();
    expect(field()).toHaveValue('З Новим роком!');
  });

  it('нік 1 символ не проходить; 2–20 проходить, повідомлення надсилається й з’являється як «це ти»', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(field(), 'Привіт усім');
    await user.click(screen.getByRole('button', { name: 'Надіслати' }));
    const dialog = await screen.findByRole('dialog', { name: /Як тебе підписати/ });
    const nick = within(dialog).getByRole('textbox', { name: /Нік/ });

    await user.type(nick, 'М');
    await user.click(within(dialog).getByRole('button', { name: 'Готово' }));
    expect(screen.getByRole('dialog', { name: /Як тебе підписати/ })).toBeInTheDocument();
    expect(within(dialog).getByText(/від 2 до 20 символів/)).toBeInTheDocument();

    await user.type(nick, 'ирон');
    await user.click(within(dialog).getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Як тебе підписати/ })).not.toBeInTheDocument());

    const log = screen.getByRole('log');
    expect(within(log).getByText('Привіт усім')).toBeInTheDocument();
    expect(log.querySelector('[data-own="true"]')).not.toBeNull();
    expect(field()).toHaveValue('');
    expect(useGuestStore.getState().nick).toBe('Мирон');
    expect(useGuestStore.getState().chat.sentAt).toHaveLength(1);
  });

  it('нік понад 20 символів не вводиться (maxLength 20), «заборонений» і «зайнятий» показують причину', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(field(), 'Привіт');
    await user.click(screen.getByRole('button', { name: 'Надіслати' }));
    const dialog = await screen.findByRole('dialog', { name: /Як тебе підписати/ });
    const nick = within(dialog).getByRole('textbox', { name: /Нік/ });
    await user.type(nick, 'а'.repeat(30));
    expect((nick as HTMLInputElement).value).toHaveLength(20);
    fireEvent.change(nick, { target: { value: 'Аміра' } });
    expect(within(dialog).getByText('Цей нік уже зайнято')).toBeInTheDocument();
    fireEvent.change(nick, { target: { value: 'Admin' } });
    expect(within(dialog).getByText('Цей нік не пройшов модерацію')).toBeInTheDocument();
  });
});

describe('ChatPanel — ліміти й режими (FR-052)', () => {
  beforeEach(() => useGuestStore.setState({ nick: 'Мирон', flagCode: 'UA' }));

  it('посилання не надсилається, текст лишається', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(field(), 'дивись www.example.com');
    await user.click(screen.getByRole('button', { name: 'Надіслати' }));
    expect(screen.getByText(/Посилання в чаті не надсилаються — прибери його, текст лишиться/)).toBeInTheDocument();
    expect(field()).toHaveValue('дивись www.example.com');
    expect(useGuestStore.getState().chat.sentAt).toHaveLength(0);
  });

  it('лічильник з’являється від 180 з 200 і на межі показує «Досить»', async () => {
    setup();
    fireEvent.change(field(), { target: { value: 'а'.repeat(179) } });
    expect(screen.queryByText('179/200')).not.toBeInTheDocument();
    fireEvent.change(field(), { target: { value: 'а'.repeat(184) } });
    expect(screen.getByText('184/200')).toBeInTheDocument();
    fireEvent.change(field(), { target: { value: 'а'.repeat(200) } });
    expect(screen.getByText('200/200')).toHaveAttribute('data-state', 'limit');
    expect(screen.getByText(/Досить/)).toBeInTheDocument();
  });

  it('повільний режим: після відправлення кнопка неактивна з причиною, підказка «можна писати через N с»', async () => {
    const user = userEvent.setup();
    setup(SLOW);
    useGuestStore.setState({ chat: { lastRoom: 'world', sentAt: [SLOW - 7_000] } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Надіслати — зачекай 8 с/ })).toHaveAttribute('aria-disabled', 'true'));
    expect(screen.getByText(/Повільний режим: можна писати через 8 с/)).toBeInTheDocument();
    await user.type(field(), 'ще одне');
    await user.click(screen.getByRole('button', { name: /зачекай/ }));
    expect(useGuestStore.getState().chat.sentAt).toHaveLength(1);
    expect(field()).toHaveValue('ще одне');
  });

  it('«Готові привітання» надсилають одним дотиком', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Готові привітання' }));
    await user.click(await screen.findByRole('button', { name: /З Новим роком!/ }));
    expect(within(screen.getByRole('log')).getByText('З Новим роком!')).toBeInTheDocument();
  });

  it('чат недоступний: повідомлення замість стрічки, поля введення немає', () => {
    useTestControls.setState({ chatAvailable: false });
    setup();
    expect(screen.getByText('Чат тимчасово недоступний, повернемося за хвилину')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('немає з’єднання: смуга й неактивна кнопка', () => {
    useTestControls.setState({ offlineSimulated: true });
    setup();
    expect(screen.getByText(/Немає з’єднання/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Надіслати' })).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('ChatPanel — пауза, реакції, відповідь, автор', () => {
  beforeEach(() => useGuestStore.setState({ nick: 'Мирон', flagCode: 'UA' }));

  it('пауза: нові повідомлення не з’являються у стрічці, але рахуються у «Нові повідомлення N ↓»', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Пауза чату' }));
    expect(screen.getByText('Стрічку зупинено — читай у своєму темпі')).toBeInTheDocument();
    act(() => useChatFeed.getState().append([message('m3', TARAS, 'Нове 1', QUIET), message('m4', TARAS, 'Нове 2', QUIET + 1_000)]));
    const pill = await screen.findByRole('button', { name: /Нові повідомлення 2/ });
    await user.click(pill);
    expect(screen.queryByText('Стрічку зупинено — читай у своєму темпі')).not.toBeInTheDocument();
  });

  it('реакція: ставиться з меню дій і показується під текстом як «Реакція Хлопавка: 1, твоя. Прибрати»', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getAllByRole('button', { name: /Дії з повідомленням · Karim/ })[0]!);
    // Меню «⋯»: сітка емодзі, клітинка з підписом лише для зчитувача
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Реакція Хлопавка' }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: 'Реакція Хлопавка: 1, твоя. Прибрати' })).toBeInTheDocument();
  });

  it('відповідь: цитата в полі, «Скасувати відповідь»; відправлене повідомлення несе replyTo', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getAllByRole('button', { name: /Дії з повідомленням · Karim/ })[0]!);
    await user.click(await screen.findByRole('menuitem', { name: 'Відповісти' }));
    expect(await screen.findByText(/Відповідь · Karim/)).toBeInTheDocument();
    await user.type(field(), 'Дякую!');
    await user.click(screen.getByRole('button', { name: 'Надіслати' }));
    const own = screen.getByRole('log').querySelector('[data-own="true"]')!;
    expect(own.querySelector('[data-row="reply"]')).toHaveTextContent('Karim');
    expect(screen.queryByRole('button', { name: 'Скасувати відповідь' })).not.toBeInTheDocument();
  });

  it('нік з пасом відкриває панель автора зі «Шлях Karim», нік без пасу — лише нік і прапор', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /Karim, Єгипет/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Автор повідомлення' });
    expect(within(dialog).getByRole('heading', { name: 'Шлях Karim' })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getAllByRole('button', { name: /· Зустріли ·/ }).length).toBeGreaterThan(0));
    expect(within(dialog).getAllByRole('button', { name: /· У графіку ·/ }).length).toBeGreaterThan(0);
    expect(within(dialog).getByText('Згадати @Karim')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Автор повідомлення' })).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Тарас, Україна/ }));
    const plain = await screen.findByRole('dialog', { name: 'Автор повідомлення' });
    expect(within(plain).queryByRole('heading', { name: /Шлях/ })).not.toBeInTheDocument();
    expect(within(plain).getByText('Тарас')).toBeInTheDocument();
    expect(within(plain).getByText('Згадати @Тарас')).toBeInTheDocument();
  });

  it('клік по рядку повідомлення (текст) і Enter на рядку відкривають панель автора; ⋯ — лише меню дій', async () => {
    const user = userEvent.setup();
    setup();
    const row = screen.getByText('Привіт з Каїра!').closest('li')!;
    await user.click(screen.getByText('Привіт з Каїра!'));
    const dialog = await screen.findByRole('dialog', { name: 'Автор повідомлення' });
    expect(dialog).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Автор повідомлення' })).not.toBeInTheDocument());
    row.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Автор повідомлення' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Автор повідомлення' })).not.toBeInTheDocument());
    await user.click(screen.getAllByRole('button', { name: /Дії з повідомленням · Karim/ })[0]!);
    expect(await screen.findByRole('menuitem', { name: 'Відповісти' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Автор повідомлення' })).not.toBeInTheDocument();
  });

  it('меню «⋯»: 24 емодзі без підписів, «Згадати» вставляє @нік, Esc повертає фокус на «⋯», клік поза меню закриває', async () => {
    const user = userEvent.setup();
    setup();
    const more = screen.getAllByRole('button', { name: /Дії з повідомленням · Karim/ })[0]!;
    await user.click(more);
    const menu = await screen.findByRole('menu', { name: 'Дії з повідомленням' });
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(within(menu).getAllByRole('menuitemcheckbox')).toHaveLength(24);
    expect(within(menu).getByRole('menuitem', { name: 'Поскаржитись' })).toBeInTheDocument();
    // Перша клітинка сітки; стрілка вправо — наступна клітинка, вниз — той самий стовпець наступного ряду.
    const first = within(menu).getAllByRole('menuitemcheckbox')[0]!;
    first.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitemcheckbox')[1]);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(more);

    await user.click(more);
    await user.click(await screen.findByRole('menuitem', { name: 'Згадати' }));
    await waitFor(() => expect(field()).toHaveValue('@Karim '));

    await user.click(more);
    await screen.findByRole('menu');
    await user.click(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('меню «⋯»: «Поскаржитись» і повторний клік по «⋯» закривають меню', async () => {
    const user = userEvent.setup();
    setup();
    const more = screen.getAllByRole('button', { name: /Дії з повідомленням · Karim/ })[0]!;
    await user.click(more);
    await user.click(await screen.findByRole('menuitem', { name: 'Поскаржитись' }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await user.click(more);
    await screen.findByRole('menu');
    await user.click(more);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('«Згадати @нік» вставляє згадку в поле і закриває панель', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /Тарас, Україна/ }));
    await user.click(await screen.findByText('Згадати @Тарас'));
    await waitFor(() => expect(field()).toHaveValue('@Тарас '));
  });

  it('одна зупинка Tab у стрічці: лише найновіший нік tabindex=0', () => {
    setup();
    const nicks = within(screen.getByRole('log')).getAllByRole('button', { name: /, (Єгипет|Україна)$/ });
    expect(nicks.filter((b) => b.getAttribute('tabindex') === '0')).toHaveLength(1);
  });
});

describe('ChatHiddenButton — чат сховано (FR-053)', () => {
  it('рахує нові чужі повідомлення й показує «99+» від ста', async () => {
    const user = userEvent.setup();
    let shown = false;
    renderApp(<ChatHiddenButton placement="phone" room="world" onShow={() => (shown = true)} />, QUIET);
    expect(screen.getByRole('button', { name: 'Відкрити чат' })).toBeInTheDocument();
    act(() => {
      useChatUi.getState().markHidden(QUIET);
      useChatFeed.getState().append(Array.from({ length: 120 }, (_, i) => message(`n${i}`, TARAS, `m${i}`, QUIET + 1_000 + i)));
    });
    const button = await screen.findByRole('button', { name: /Відкрити чат/ });
    expect(button).toHaveTextContent('99+');
    expect(button).toHaveTextContent('Нових повідомлень: 120');
    await user.click(button);
    expect(shown).toBe(true);
  });

  it('desktop-варіант називається «Показати чат»', () => {
    renderApp(<ChatHiddenButton placement="desktop" room="world" onShow={() => undefined} />, QUIET);
    expect(screen.getByRole('button', { name: 'Показати чат' })).toBeInTheDocument();
  });
});
