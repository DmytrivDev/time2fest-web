import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatHiddenButton } from '@/components/chat/parts/ChatHiddenButton';
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

    // Поки людина вперше вводить — помилки немає; вперше з’являється на blur, далі — наживо.
    await user.type(nick, 'М');
    expect(within(dialog).queryByText('Мінімум 2 символи')).not.toBeInTheDocument();
    await user.tab();
    expect(within(dialog).getByText('Мінімум 2 символи')).toBeInTheDocument();
    expect(nick).toHaveAttribute('aria-invalid', 'true');
    await user.type(nick, 'и');
    expect(within(dialog).queryByText('Мінімум 2 символи')).not.toBeInTheDocument();
    await user.clear(nick);
    await user.type(nick, 'М');
    expect(within(dialog).getByText('Мінімум 2 символи')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Готово' }));
    expect(screen.getByRole('dialog', { name: /Як тебе підписати/ })).toBeInTheDocument();

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

  it('нік: понад 20 — «Максимум 20 символів», посилання — «Без посилань», «заборонений» і «зайнятий» показують причину', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(field(), 'Привіт');
    await user.click(screen.getByRole('button', { name: 'Надіслати' }));
    const dialog = await screen.findByRole('dialog', { name: /Як тебе підписати/ });
    const nick = within(dialog).getByRole('textbox', { name: /Нік/ });
    // Підпис без «від 2 до 20 символів»; лічильник N/20 справа.
    expect(within(dialog).queryByText(/від 2 до 20/)).not.toBeInTheDocument();
    fireEvent.change(nick, { target: { value: 'www.example.com' } });
    expect(within(dialog).queryByText('Без посилань', { selector: 'p' })).not.toBeInTheDocument(); // ще не було blur
    fireEvent.blur(nick);
    expect(within(dialog).getByText('Без посилань', { selector: 'p' })).toBeInTheDocument();
    fireEvent.change(nick, { target: { value: 'а'.repeat(25) } });
    expect(within(dialog).getByText('Максимум 20 символів')).toBeInTheDocument();
    expect(within(dialog).getByText('25/20')).toBeInTheDocument();
    fireEvent.change(nick, { target: { value: 'www.example.com' } });
    expect(within(dialog).getByText('Без посилань', { selector: 'p' })).toBeInTheDocument();
    fireEvent.change(nick, { target: { value: 'Олег' } });
    expect(within(dialog).queryByText('Без посилань', { selector: 'p' })).not.toBeInTheDocument();
    fireEvent.change(nick, { target: { value: 'Аміра' } });
    expect(within(dialog).getByText('Цей нік уже зайнято')).toBeInTheDocument();
    fireEvent.change(nick, { target: { value: 'Admin' } });
    expect(within(dialog).getByText('Цей нік не пройшов модерацію')).toBeInTheDocument();
  });
});

describe('O-NICK — прапор: пошук замість поля, список, клавіатура', () => {
  async function openNick(user: ReturnType<typeof userEvent.setup>) {
    setup();
    await user.type(field(), 'Привіт');
    await user.click(screen.getByRole('button', { name: 'Надіслати' }));
    return screen.findByRole('dialog', { name: /Як тебе підписати/ });
  }

  it('«Змінити» замінює поле прапора пошуком і відкриває список з групами; фільтр, ↓ + Enter обирають, Esc повертає на «Змінити»', async () => {
    const user = userEvent.setup();
    const dialog = await openNick(user);
    const change = within(dialog).getByRole('button', { name: /^Прапор: .*Змінити$/ });
    await user.click(change);
    expect(within(dialog).queryByRole('button', { name: /^Прапор: .*Змінити$/ })).not.toBeInTheDocument();
    const search = within(dialog).getByRole('combobox');
    expect(search).toHaveFocus();
    expect(search).toHaveAttribute('aria-expanded', 'true');
    const list = within(dialog).getByRole('listbox', { name: 'Прапори' });
    expect(within(list).getByText('Особливі прапори')).toBeInTheDocument();
    expect(within(list).getByText('Усі країни')).toBeInTheDocument();
    expect(within(list).getByRole('option', { name: /Без країни/ })).toBeInTheDocument();
    expect(within(list).getByRole('option', { name: /Європейський Союз/ })).toBeInTheDocument();
    expect(within(list).getByRole('option', { name: /Англія/ })).toBeInTheDocument();
    expect(within(list).getByRole('option', { name: /Прайд-прапор ЛГБТ/ })).toBeInTheDocument();

    await user.type(search, 'Єгип');
    const found = within(list).getAllByRole('option');
    expect(found).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(within(dialog).queryByRole('listbox')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Прапор: Єгипет. Змінити' })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Прапор: Єгипет. Змінити' }));
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(within(dialog).getByRole('combobox').getAttribute('aria-activedescendant')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: /Як тебе підписати/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('listbox')).not.toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Прапор: Єгипет. Змінити' })).toHaveFocus());
  });

  it('прев’ю «У чаті:» з довгим ніком; «Оформити пас» без заглушки оплати; посилання на правила', async () => {
    const user = userEvent.setup();
    const dialog = await openNick(user);
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Нік/ }), { target: { value: 'ШШШШШШШШШШШШШШШШШШШШ' } });
    expect(within(dialog).getByText('У чаті:')).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: /ШШШШШШШШШШШШШШШШШШШШ/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Оформити пас' })).toBeInTheDocument();
    expect(within(dialog).queryByText('Оплата буде на наступному етапі')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Умови й правила чату' })).toHaveAttribute('href', '/rules/');
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
    expect(document.querySelector('[data-row="slow-hint"]')?.textContent).toMatch(/Повільний режим: можна писати через 8 с/);
    await user.type(field(), 'ще одне');
    await user.click(screen.getByRole('button', { name: /зачекай/ }));
    expect(useGuestStore.getState().chat.sentAt).toHaveLength(1);
    expect(field()).toHaveValue('ще одне');
  });

  it('кнопка-емодзі: вибір над полем, вставка в позицію курсора, відкритий для нових, закриває Esc / повторний клік / клік поза ним', async () => {
    const user = userEvent.setup();
    setup();
    const input = field() as HTMLTextAreaElement;
    await user.type(input, 'Аб');
    input.setSelectionRange(1, 1);
    const btn = screen.getByRole('button', { name: 'Емодзі' });
    await user.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    const picker = screen.getByRole('group', { name: 'Вибір емодзі' });
    // Без кнопок дій меню повідомлення.
    expect(within(picker).queryByText('Відповісти')).not.toBeInTheDocument();
    expect(within(picker).getAllByRole('button')).toHaveLength(24);
    await user.click(within(picker).getByRole('button', { name: 'Вставити Хлопавка' }));
    expect(input).toHaveValue('А🎉б');
    await waitFor(() => expect(input.selectionStart).toBe(3));
    expect(input).toHaveFocus();
    await user.click(within(picker).getByRole('button', { name: 'Вставити Серце' }));
    expect(input).toHaveValue('А🎉❤️б');
    expect(screen.getByRole('group', { name: 'Вибір емодзі' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Вибір емодзі' })).not.toBeInTheDocument();
    await waitFor(() => expect(btn).toHaveFocus());

    await user.click(btn);
    expect(screen.getByRole('group', { name: 'Вибір емодзі' })).toBeInTheDocument();
    await user.click(btn);
    expect(screen.queryByRole('group', { name: 'Вибір емодзі' })).not.toBeInTheDocument();

    await user.click(btn);
    await user.click(document.body);
    expect(screen.queryByRole('group', { name: 'Вибір емодзі' })).not.toBeInTheDocument();
  });

  it('кнопка-емодзі: з клавіатури — фокус на першу клітинку, стрілки, Enter вставляє, ліміт 200 діє', async () => {
    const user = userEvent.setup();
    setup();
    const btn = screen.getByRole('button', { name: 'Емодзі' });
    btn.focus();
    await user.keyboard('{Enter}');
    const picker = screen.getByRole('group', { name: 'Вибір емодзі' });
    const cells = within(picker).getAllByRole('button');
    expect(cells[0]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(cells[1]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(field()).toHaveValue('🥂');
    fireEvent.change(field(), { target: { value: 'а'.repeat(200) } });
    await user.click(cells[0]!);
    expect(field()).toHaveValue('а'.repeat(200));
  });

  it('чат недоступний: повідомлення замість стрічки, поля введення немає', () => {
    useTestControls.setState({ chatAvailable: false });
    setup();
    expect(screen.getByText('Чат тимчасово недоступний, повернемося за хвилину')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('десктоп: «Сховати чат» у недоступному стані; пілюля без лічильника, після повернення — нові відтоді', async () => {
    const user = userEvent.setup();
    useTestControls.setState({ chatAvailable: false });
    const onHide = vi.fn(() => useChatUi.getState().markHidden(QUIET - 10_000));
    setup(
      QUIET,
      <>
        <ChatPanel onHide={onHide} />
        <ChatHiddenButton room="world" onShow={() => undefined} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Сховати чат' }));
    expect(onHide).toHaveBeenCalled();
    act(() => useChatFeed.getState().append([message('n1', TARAS, 'нове', QUIET - 5_000)]));
    expect(screen.getByRole('button', { name: 'Показати чат' })).toBeInTheDocument();
    act(() => useTestControls.setState({ chatAvailable: true }));
    // Повернувся: рахунок іде відтепер, раніше пропущене не рахуємо.
    expect(useChatUi.getState().hiddenAt).toBe(QUIET);
    expect(screen.getByRole('button', { name: 'Показати чат' })).toBeInTheDocument();
    act(() => useChatFeed.getState().append([message('n2', TARAS, 'ще', QUIET + 1_000)]));
    expect(await screen.findByRole('button', { name: 'Показати чат, нових повідомлень: 1' })).toBeInTheDocument();
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

  it('своє повідомлення: замість «⋯» — «×», один клік видаляє без підтвердження', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getAllByRole('button', { name: /Дії з повідомленням · Karim/ })[0]!);
    await user.click(await screen.findByRole('menuitem', { name: 'Відповісти' }));
    await user.type(field(), 'Видали мене');
    await user.click(screen.getByRole('button', { name: 'Надіслати' }));
    const log = screen.getByRole('log');
    const own = log.querySelector<HTMLElement>('[data-own="true"][data-kind="regular"]')!;
    expect(own.querySelector('[data-msg-trigger]')).toBeNull();
    await user.click(within(own).getByRole('button', { name: 'Видалити повідомлення' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(within(log).queryByText('Видали мене')).not.toBeInTheDocument();
    expect(log.querySelector('[data-kind="deleted"][data-own="true"]')).toHaveTextContent('Твоє повідомлення видалено');
  });

  it('нік з пасом відкриває панель автора зі «Шлях Karim», нік без пасу — лише нік і прапор', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /Karim, Єгипет/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Автор повідомлення' });
    expect(within(dialog).getByRole('heading', { name: 'Шлях Karim' })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getAllByRole('button', { name: /· Зустріли ·/ }).length).toBeGreaterThan(0));
    // У графіку Karim — Ріо-де-Жанейро (північ ще попереду о 00:20 UTC); минулі заплановані точки не показуються (2026-11-09).
    expect(within(dialog).getAllByRole('button', { name: /· У графіку ·/ }).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: 'Поскаржитись' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Переглянути шлях/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Автор повідомлення' })).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Тарас, Україна/ }));
    const plain = await screen.findByRole('dialog', { name: 'Автор повідомлення' });
    expect(within(plain).getByRole('heading', { name: 'Тарас' })).toBeInTheDocument();
    expect(within(plain).queryByRole('button', { name: /Переглянути шлях/ })).not.toBeInTheDocument();
    expect(within(plain).getByText(/поки не може показати шлях: це можливість Новорічного пасу/)).toBeInTheDocument();
    expect(within(plain).getByRole('button', { name: 'Поскаржитись' })).toBeInTheDocument();
    expect(within(plain).queryByRole('button', { name: /Згадати|Відповісти/ })).not.toBeInTheDocument();
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

  it('меню «⋯» (варіант А): 7 емодзі й «Усі реакції» → 24, дії колонками, «Згадати» вставляє @нік, Esc повертає фокус на «⋯», клік поза меню закриває', async () => {
    const user = userEvent.setup();
    setup();
    const more = screen.getAllByRole('button', { name: /Дії з повідомленням · Karim/ })[0]!;
    await user.click(more);
    const menu = await screen.findByRole('menu', { name: 'Дії з повідомленням' });
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(within(menu).getAllByRole('menuitemcheckbox')).toHaveLength(7);
    expect(within(menu).getByRole('menuitem', { name: 'Поскаржитись' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Відповісти' })).toHaveFocus();
    await user.click(within(menu).getByRole('menuitem', { name: 'Усі реакції' }));
    expect(within(menu).getAllByRole('menuitemcheckbox')).toHaveLength(24);
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

    // Повторне натискання «⋯» закриває меню.
    await user.click(more);
    await screen.findByRole('menu');
    await user.click(more);
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


  it('одна зупинка Tab у стрічці: лише найновіший нік tabindex=0', () => {
    setup();
    const nicks = within(screen.getByRole('log')).getAllByRole('button', { name: /, (Єгипет|Україна)$/ });
    expect(nicks.filter((b) => b.getAttribute('tabindex') === '0')).toHaveLength(1);
  });
});

describe('ChatHiddenButton — чат сховано на десктопі (FR-053)', () => {
  it('рахує нові чужі повідомлення й показує «99+» від ста', async () => {
    const user = userEvent.setup();
    let shown = false;
    renderApp(<ChatHiddenButton room="world" onShow={() => (shown = true)} />, QUIET);
    expect(screen.getByRole('button', { name: 'Показати чат' })).toBeInTheDocument();
    act(() => {
      useChatUi.getState().markHidden(QUIET);
      useChatFeed.getState().append(Array.from({ length: 120 }, (_, i) => message(`n${i}`, TARAS, `m${i}`, QUIET + 1_000 + i)));
    });
    const button = await screen.findByRole('button', { name: 'Показати чат, нових повідомлень: 120' });
    expect(button).toHaveTextContent('99+');
    await user.click(button);
    expect(shown).toBe(true);
  });

  it('без нових лічильника немає', () => {
    renderApp(<ChatHiddenButton room="world" onShow={() => undefined} />, QUIET);
    expect(screen.getByRole('button', { name: 'Показати чат' })).not.toHaveTextContent(/\d/);
  });
});
