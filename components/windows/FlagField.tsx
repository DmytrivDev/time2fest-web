'use client';

/**
 * Поле «Прапор» для O-NICK (чат); було спільним із формою «Першого ряду» (прибрано 2026-11-12).
 * Поле з круглим прапором і «Змінити»; «Змінити» ЗАМІНЮЄ його на пошук (combobox) і відкриває список (listbox):
 * «За твоїм розташуванням», «Особливі прапори», «Усі країни». ↑/↓ — по списку, Enter — обрати, Esc — закрити й повернутись
 * до «Змінити». Десктоп (колонка чату): список лежить поверх нижньої частини панелі, висота панелі не змінюється; телефон —
 * список у потоці й зсуває все нижче.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { useChatColumn } from '@/components/shell/OverlayManager';
import { fold, matchesCountryName } from '@/lib/search/countrySearch';

export interface FlagOption {
  code: string;
  name: string;
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

/** Назва прапора мовою інтерфейсу (особливі — з `chat.nick.flags`). */
export function useFlagName(flags: readonly FlagOption[]) {
  const c = useTranslations('chat.nick');
  return useCallback(
    (code: string): string =>
      (SPECIAL_ALL as readonly string[]).includes(code) ? c(`flags.${code}`) : (flags.find((f) => f.code === code)?.name ?? code),
    [c, flags],
  );
}

export interface FlagFieldProps {
  value: string;
  onChange(code: string): void;
  /** Прапор за розташуванням; немає — «Прапор не визначено», список відкрито одразу (лише якщо `openIfUnknown`). */
  detectedFlag?: string;
  /** Людина вже обирала прапор (чи є за розташуванням) — підказка «Визначили за розташуванням»; інакше «не визначено». */
  undetected?: boolean;
  /** Відкрити список одразу, якщо прапор не визначено (O-NICK). */
  openIfUnknown?: boolean;
  flags: readonly FlagOption[];
  /** Підпис над полем; за замовчуванням «Прапор». */
  label?: string;
  className?: string;
  /** Повторне вимірювання списку на десктопі (напр. коли над полем з’явилась помилка). */
  measureKey?: unknown;
}

export function FlagField({
  value,
  onChange,
  detectedFlag,
  undetected = false,
  openIfUnknown = false,
  flags,
  label,
  className,
  measureKey,
}: FlagFieldProps) {
  const t = useTranslations('windows.nick');
  const c = useTranslations('chat.nick');
  const column = useChatColumn();
  const nameOf = useFlagName(flags);
  const [open, setOpen] = useState(openIfUnknown && undetected);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [listMax, setListMax] = useState(LIST_MAX);

  const uid = useId();
  const flagHintId = `${uid}-flag-hint`;
  const flagBtnId = `${uid}-flag-btn`;
  const listId = `${uid}-list`;
  const searchRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Групи списку з урахуванням пошуку.
  const groups = useMemo<Group[]>(() => {
    // Пошук прапора усіма мовами сайту (рішення 2026-11-09): uk/en/es/fr + код країни.
    const q = fold(query);
    const match = (name: string, sub?: string, code?: string) =>
      !q || fold(name).includes(q) || (sub ? fold(sub).includes(q) : false) || (!!code && matchesCountryName(code, name, q));
    const make = (key: Group['key'], code: string): Item => ({
      id: `${listId}-${key}-${code}`,
      code,
      name: nameOf(code),
      ...(code === 'earth' ? { sub: c('flags.earthSub') } : {}),
    });
    const out: Group[] = [];
    if (detectedFlag) {
      const items = [make('detected', detectedFlag)].filter((i) => match(i.name, i.sub, i.code));
      if (items.length) out.push({ key: 'detected', label: c('groupDetected'), items });
    }
    const spec = SPECIAL_ALL.map((code) => make('special', code)).filter((i) => match(i.name, i.sub, i.code));
    if (spec.length) out.push({ key: 'special', label: c('groupSpecial'), items: spec });
    const all = [...flags]
      .sort((a, b) => a.name.localeCompare(b.name, 'uk'))
      .map((f) => make('all', f.code))
      .filter((i) => match(i.name, i.sub, i.code));
    if (all.length) out.push({ key: 'all', label: c('groupAll'), items: all });
    return out;
  }, [query, flags, detectedFlag, listId, c, nameOf]);
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
    onChange(item.code);
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
    activeId && flat.some((i) => i.id === activeId) ? activeId : (flat.find((i) => i.code === value)?.id ?? flat[0]?.id ?? null);
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
    const panel = pop?.closest<HTMLElement>('[data-chat-slot-panel]');
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
  }, [open, column, measureKey]);

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

  return (
    <div className={cn('flex flex-col gap-1', className)} data-row="flag">
      <span id={`${uid}-flag-label`} className="text-label-sm">
        {label ?? c('flagLabel')}
      </span>
      {open ? (
        <div ref={popRef} className="relative" data-row="flag-search">
          <label className="relative flex">
            <span className="sr-only">{c('searchLabel')}</span>
            <span aria-hidden="true" className="pointer-events-none absolute start-3 top-3.25 flex text-text-muted">
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
                    const selected = item.code === value;
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
                          {item.sub ? <span className="text-caption text-text-muted">{item.sub}</span> : null}
                        </span>
                        {selected ? <Icon name="check" size={16} className="text-highlight" strokeWidth={2.6} /> : null}
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
          aria-label={c('flagButton', { name: nameOf(value) })}
          onClick={openList}
          className="t2f-nk-input t2f-nk-flagbtn"
        >
          <Flag round code={value} size="md" decorative />
          <span className="min-w-0 flex-1 truncate">{nameOf(value)}</span>
          <span className="text-label-sm font-medium text-text-secondary">{c('change')}</span>
          <Icon name="chevron-down" size={16} className="text-text-secondary" />
        </button>
      )}
      <p id={flagHintId} className="t2f-nk-hint">
        {undetected ? t('flagUnknown') : c('detected')}
      </p>
    </div>
  );
}
