'use client';

/**
 * C25 O-NICK — «Як тебе підписати в чаті?» (FR-051; макети `Desk-Nick`, `Phone-Nick`, `Desk-Chat-Hidden-Input`).
 * Вікно типу `form`: десктоп — `ChatSlotPanel` на місці колонки чату, телефон — `Sheet` під плеєром (шапку з заголовком
 * і підзаголовком дає `OverlayManager`, `chrome: 'board'`). Зверху вниз:
 * - нік: рядок «Нік» + лічильник N/20, однорядкове `<input>`, помилка лише коли нік недійсний («Мінімум 2 символи»,
 *   «Максимум 20 символів», «Без посилань»; зайнятий/заборонений — як було), під нею підказка;
 * - прапор: поле з прапором і «Змінити» (як на макеті); «Змінити» ЗАМІНЮЄ його на пошук (combobox) і відкриває список
 *   (listbox): «За твоїм розташуванням», «Особливі прапори», «Усі країни». ↑/↓ — по списку, Enter — обрати, Esc — закрити
 *   й повернутись до «Змінити». Круглі прапори. Десктоп: список лежить поверх нижньої частини, висота панелі не
 *   змінюється, зменшується лише список; телефон: список у потоці й зсуває все нижче;
 * - «У чаті:» + чип (круглий прапор і нік; чип переходить на новий рядок, але нік не переноситься й не обрізається);
 * - coral «Готово» (єдина коралова кнопка), «Увійти», «Оформити пас» (імітована оплата), «Акаунт — з 13 років (16 у ЄС) ·
 *   Умови й правила чату» (посилання на `/rules/`).
 * Текст повідомлення, заради якого відкрито вікно, лишається в полі чату — вікно про нього не знає.
 */
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { useChatColumn } from '@/components/shell/OverlayManager';
import { PaymentNotice } from '@/components/windows/OfferCard';
import { validateNick, type NickIssue } from '@/lib/chat-sim/nick';
import { NICK_MAX } from '@/lib/chat-sim/send';

export interface FlagOption {
  code: string;
  name: string;
}

export interface NickResult {
  nick: string;
  flagCode: string;
}

export interface NickProps {
  initialNick?: string;
  /** Прапор, який людина вже обрала раніше. */
  initialFlag?: string;
  /** Прапор за розташуванням; немає — «Прапор не визначено» і Земля. */
  detectedFlag?: string;
  /** Усі прапори для пошуку (країни). Особливі додаються самі. */
  flags: readonly FlagOption[];
  /** Ніки, які вже зайняті. */
  takenNicks?: readonly string[];
  /** Примусовий стан помилки (історії, сервер): `taken` / `forbidden`. */
  forcedIssue?: Extract<NickIssue, 'taken' | 'forbidden'>;
  onDone: (result: NickResult) => void;
  className?: string;
}

/** Особливі прапори, у порядку списку: Земля («Без країни»), ЄС, ООН, Англія, прайд-прапори. */
export const SPECIAL_ALL = ['earth', 'EU', 'un', 'GB-ENG', 'pride', 'trans', 'bisexual'] as const;

/** Максимальна висота списку на макеті, px. */
const LIST_MAX = 316;
/** Рамка + відступи контейнера списку (1 + 8 з кожного боку), px. */
const LIST_CHROME = 18;

interface Item {
  id: string;
  code: string;
  name: string;
  sub?: string;
}
interface Group {
  key: 'detected' | 'special' | 'all';
  label: string;
  items: Item[];
}

export function Nick({
  initialNick = '',
  initialFlag,
  detectedFlag,
  flags,
  takenNicks = [],
  forcedIssue,
  onDone,
  className,
}: NickProps) {
  const t = useTranslations('windows.nick');
  const c = useTranslations('chat.nick');
  const offers = useTranslations('offers');
  const column = useChatColumn();
  const [nick, setNick] = useState(initialNick);
  const [touched, setTouched] = useState(false);
  const initial = initialFlag ?? detectedFlag ?? 'earth';
  const [flag, setFlag] = useState(initial);
  const undetected = !initialFlag && !detectedFlag;
  const [open, setOpen] = useState(undetected);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  const [listMax, setListMax] = useState(LIST_MAX);

  const uid = useId();
  const nickId = `${uid}-nick`;
  const hintId = `${uid}-hint`;
  const countId = `${uid}-count`;
  const errId = `${uid}-err`;
  const flagHintId = `${uid}-flag-hint`;
  const flagBtnId = `${uid}-flag-btn`;
  const listId = `${uid}-list`;
  const nickRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Вікно відкрито дією людини (перше повідомлення): фокус одразу в полі ніка.
  useEffect(() => nickRef.current?.focus(), []);

  const special = (code: string) => c(`flags.${code}`);
  const trimmed = nick.trim();
  const issue: NickIssue | null = validateNick(nick, takenNicks) ?? forcedIssue ?? null;
  // Помилку вперше показуємо лише після виходу з поля (blur) або «Готово»; далі перевіряємо наживо на кожну зміну.
  // Примусовий стан (сервер, історії) видно одразу.
  const shown: NickIssue | null = touched || forcedIssue ? issue : null;
  const errorText = shown
    ? shown === 'taken'
      ? t('taken')
      : shown === 'forbidden'
        ? t('forbidden')
        : shown === 'link'
          ? c('errors.link')
          : shown === 'long'
            ? c('errors.long')
            : c('errors.short')
    : undefined;

  const nameOf = (code: string): string =>
    (SPECIAL_ALL as readonly string[]).includes(code)
      ? special(code)
      : (flags.find((f) => f.code === code)?.name ?? code);

  // Групи списку з урахуванням пошуку.
  const groups = useMemo<Group[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (name: string, sub?: string) =>
      !q || name.toLowerCase().includes(q) || (sub?.toLowerCase().includes(q) ?? false);
    const make = (key: Group['key'], code: string): Item => ({
      id: `${listId}-${key}-${code}`,
      code,
      name: (SPECIAL_ALL as readonly string[]).includes(code)
        ? c(`flags.${code}`)
        : (flags.find((f) => f.code === code)?.name ?? code),
      ...(code === 'earth' ? { sub: c('flags.earthSub') } : {}),
    });
    const out: Group[] = [];
    if (detectedFlag) {
      const items = [make('detected', detectedFlag)].filter((i) => match(i.name, i.sub));
      if (items.length) out.push({ key: 'detected', label: c('groupDetected'), items });
    }
    const spec = SPECIAL_ALL.map((code) => make('special', code)).filter((i) =>
      match(i.name, i.sub),
    );
    if (spec.length) out.push({ key: 'special', label: c('groupSpecial'), items: spec });
    const all = [...flags]
      .sort((a, b) => a.name.localeCompare(b.name, 'uk'))
      .map((f) => make('all', f.code))
      .filter((i) => match(i.name, i.sub));
    if (all.length) out.push({ key: 'all', label: c('groupAll'), items: all });
    return out;
  }, [query, flags, detectedFlag, listId, c]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const close = useCallback(
    (restoreFocus: boolean) => {
      setOpen(false);
      setQuery('');
      setActiveId(null);
      if (restoreFocus) requestAnimationFrame(() => document.getElementById(flagBtnId)?.focus());
    },
    [flagBtnId],
  );
  const pick = (item: Item) => {
    setFlag(item.code);
    close(true);
  };
  const openList = () => {
    setOpen(true);
    setActiveId(null);
  };

  // Відкрито — фокус у пошуку; активний пункт за замовчуванням — обраний прапор.
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
  }, [open]);
  const effectiveActive =
    activeId && flat.some((i) => i.id === activeId)
      ? activeId
      : (flat.find((i) => i.code === flag)?.id ?? flat[0]?.id ?? null);
  useEffect(() => {
    if (!open || !effectiveActive) return;
    document.getElementById(effectiveActive)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, effectiveActive]);

  // Esc закриває лише список (не вікно): слухач у capture на window спрацьовує раніше за Radix.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close(true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  // Десктоп: панель має незмінну висоту, список лежить поверх нижньої частини й не вищий за місце до низу панелі.
  useLayoutEffect(() => {
    if (!open || !column) return;
    const pop = popRef.current;
    const panel = formRef.current?.closest<HTMLElement>('[data-chat-slot-panel]');
    if (!pop || !panel) return;
    const measure = () => {
      const avail = panel.getBoundingClientRect().bottom - pop.getBoundingClientRect().top - 8;
      setListMax(Math.max(88, Math.min(LIST_MAX, Math.floor(avail - LIST_CHROME))));
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(panel);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [open, column, errorText]);

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      const i = flat.findIndex((x) => x.id === effectiveActive);
      const next = e.key === 'ArrowDown' ? Math.min(flat.length - 1, i + 1) : Math.max(0, i - 1);
      setActiveId(flat[next]!.id);
    } else if (e.key === 'Home' && e.ctrlKey) {
      e.preventDefault();
      if (flat.length) setActiveId(flat[0]!.id);
    } else if (e.key === 'End' && e.ctrlKey) {
      e.preventDefault();
      if (flat.length) setActiveId(flat[flat.length - 1]!.id);
    } else if (e.key === 'Enter') {
      // Enter у пошуку обирає пункт, а не надсилає форму.
      e.preventDefault();
      const item = flat.find((x) => x.id === effectiveActive);
      if (item) pick(item);
    }
  };

  const submit = () => {
    setTouched(true);
    if (issue) {
      nickRef.current?.focus();
      return;
    }
    onDone({ nick: trimmed, flagCode: flag });
  };

  const describedBy = [errorText ? errId : null, hintId, countId].filter(Boolean).join(' ');
  const overLimit = nick.length > NICK_MAX;

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      data-window="O-NICK"
      className={cn('flex min-h-full flex-col gap-4 px-4 pb-4 pt-3', className)}
    >
      {/* Верх — нік і прапор, низ (прев’ю, кнопки, футер) притиснуто до низу вікна: вільне місце між ними. */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <label htmlFor={nickId} className="text-label-sm">
              {t('field')}
            </label>
            <span
              id={countId}
              className={cn(
                'text-label-badge-chat tabular-nums',
                overLimit ? 'text-primary' : 'text-text-muted',
              )}
              data-row="nick-count"
            >
              {nick.length}/{NICK_MAX}
            </span>
          </div>
          <input
            ref={nickRef}
            id={nickId}
            type="text"
            value={nick}
            autoComplete="nickname"
            aria-invalid={errorText ? true : undefined}
            aria-describedby={describedBy}
            onChange={(e) => setNick(e.target.value)}
            onBlur={() => setTouched(true)}
            className="t2f-nk-input"
          />
          {/* Помилка — лише коли нік недійсний; ввічливе оголошення, підказка нижче зсувається. */}
          <div aria-live="polite" id={errId} data-row="nick-error">
            {errorText ? (
              <p className="flex items-center gap-1 text-caption text-primary">
                <Icon name="alert" size={16} />
                {errorText}
              </p>
            ) : null}
          </div>
          <p id={hintId} className="t2f-nk-hint">
            {t('hint')}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <span id={`${uid}-flag-label`} className="text-label-sm">
            {c('flagLabel')}
          </span>
          {open ? (
            <div ref={popRef} className="relative" data-row="flag-search">
              <label className="relative flex">
                <span className="sr-only">{c('searchLabel')}</span>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute start-3 top-3.25 flex text-text-muted"
                >
                  <Icon name="search" size={18} />
                </span>
                <input
                  ref={searchRef}
                  type="search"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-activedescendant={effectiveActive ?? undefined}
                  autoComplete="off"
                  placeholder={c('searchPlaceholder')}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveId(null);
                  }}
                  onKeyDown={onSearchKeyDown}
                  className="t2f-nk-input t2f-nk-search"
                />
              </label>
              <div className={cn('t2f-nk-pop', column && 't2f-nk-pop-float')}>
                <ul
                  ref={listRef}
                  id={listId}
                  role="listbox"
                  aria-label={c('flagList')}
                  className="t2f-nk-list"
                  style={{ maxHeight: column ? listMax : LIST_MAX }}
                >
                  {groups.length === 0 ? (
                    <li role="presentation" className="t2f-nk-empty">
                      {c('noFlags')}
                    </li>
                  ) : (
                    groups.map((g) => [
                      <li key={g.key} role="presentation" className="t2f-nk-group">
                        {g.label}
                      </li>,
                      ...g.items.map((item) => {
                        const selected = item.code === flag;
                        return (
                          // Клавіатура — через combobox (aria-activedescendant); пункт лише клікається мишею.
                          // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                          <li
                            key={item.id}
                            id={item.id}
                            role="option"
                            aria-selected={selected}
                            data-active={item.id === effectiveActive ? 'true' : undefined}
                            data-code={item.code}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pick(item)}
                            className="t2f-nk-opt"
                          >
                            <Flag round code={item.code} size="sm" decorative />
                            <span className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden whitespace-nowrap">
                              {item.name}
                              {item.sub ? (
                                <span className="text-caption text-text-muted">{item.sub}</span>
                              ) : null}
                            </span>
                            {selected ? (
                              <Icon
                                name="check"
                                size={16}
                                className="text-highlight"
                                strokeWidth={2.6}
                              />
                            ) : null}
                          </li>
                        );
                      }),
                    ])
                  )}
                </ul>
              </div>
            </div>
          ) : (
            <button
              id={flagBtnId}
              type="button"
              aria-haspopup="listbox"
              aria-expanded={false}
              aria-describedby={flagHintId}
              aria-label={c('flagButton', { name: nameOf(flag) })}
              onClick={openList}
              className="t2f-nk-input t2f-nk-flagbtn"
            >
              <Flag round code={flag} size="md" decorative />
              <span className="min-w-0 flex-1 truncate">{nameOf(flag)}</span>
              <span className="text-label-sm font-medium text-text-secondary">{c('change')}</span>
              <Icon name="chevron-down" size={16} className="text-text-secondary" />
            </button>
          )}
          <p id={flagHintId} className="t2f-nk-hint">
            {undetected ? t('flagUnknown') : c('detected')}
          </p>
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-4" data-row="bottom">
        <div className="t2f-nk-preview" data-row="preview">
          <span className="text-caption text-text-muted">{t('previewLabel')}</span>
          <span
            role="img"
            aria-label={`${trimmed || c('previewEmpty')}, ${nameOf(flag)}`}
            className="t2f-nk-chip"
            data-row="preview-chip"
          >
            <Flag round code={flag} size="xs" decorative />
            <span aria-hidden="true">{trimmed || c('previewEmpty')}</span>
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <Button type="submit" variant="coral" size="lg" className="w-full">
            {t('done')}
          </Button>
          <div className="flex gap-2">
            {/* Вхід — поза областю цієї збірки (як у шапці): кнопка на місці. */}
            <Button type="button" className="min-h-touch-min flex-1">
              {t('signIn')}
            </Button>
            <Button
              type="button"
              className="min-h-touch-min flex-1"
              aria-expanded={notice}
              onClick={() => setNotice((v) => !v)}
            >
              {t('whatPassGives')}
            </Button>
          </div>
          {notice ? <PaymentNotice>{offers('paymentLater')}</PaymentNotice> : null}
          <p className="text-center text-caption text-text-muted">
            {t('age')} ·{' '}
            <a
              href="/rules/"
              target="_blank"
              rel="noopener"
              className="t2f-focus -my-3 inline-flex min-h-touch-min items-center rounded-sm text-text-secondary underline underline-offset-2"
            >
              {c('termsLink')}
            </a>
          </p>
        </div>
      </div>
    </form>
  );
}
