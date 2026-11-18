'use client';

/**
 * Вибір країни (WAI-ARIA combobox + listbox): прапор вибраної країни зліва, шеврон справа; на фокусі показує всі країни
 * за абеткою, під час набору — спершу назви на запит, далі ті, що його містять (до 60 рядків).
 */
import { useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import { clock } from '@/lib/prefest/format';
import { searchCountries } from '@/lib/prefest/mine';
import type { PrefestCountry } from '@/lib/prefest/model';
import { usePrefest } from './PrefestContext';
import { Bar } from '@/components/skeleton/parts';
import m from './CountryCombobox.module.css';

export function CountryCombobox({
  value,
  onChange,
  inputId,
}: {
  value: PrefestCountry | null;
  onChange: (c: PrefestCountry) => void;
  /** `id` поля — для `<label htmlFor>`. */
  inputId: string;
}) {
  const t = useTranslations('prefest.mine');
  const { model } = usePrefest();
  const uid = useId();
  const listId = `${uid}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  /** Набраний текст; `null` — показуємо назву вибраної країни. */
  const [draft, setDraft] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const shown = useMemo(() => (open ? searchCountries(model.countries, draft ?? '') : []), [open, draft, model.countries]);
  const optId = (i: number) => `${uid}-opt-${i}`;

  const close = () => {
    setOpen(false);
    setDraft(null);
  };
  const choose = (c: PrefestCountry) => {
    onChange(c);
    close();
    inputRef.current?.blur();
  };
  const highlight = (i: number) => {
    setActive(i);
    document.getElementById(optId(i))?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
      } else highlight(Math.min(shown.length - 1, active + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) highlight(Math.max(0, active - 1));
    } else if (e.key === 'Enter') {
      if (open) {
        e.preventDefault();
        const c = shown[active];
        if (c) choose(c);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        close();
        inputRef.current?.blur();
      }
    }
  };
  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value);
    setOpen(true);
    setActive(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  };

  const optionHint = (c: PrefestCountry) => {
    if (c.zones.length > 1) return t('zonesCount', { count: c.zones.length });
    const z = model.zonesById.get(c.zones[0]?.zoneId ?? '');
    return z ? t('midnightAt', { time: clock(z.midnightMs) }) : '';
  };

  return (
    <div className={m.combo}>
      <span className={m.ci} aria-hidden="true">
        {value ? <Flag code={value.flagCode} diameter={24} decorative /> : <Bar shape="pill" w={24} h={24} />}
      </span>
      <input
        ref={inputRef}
        id={inputId}
        className={m.input}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && shown.length ? optId(active) : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={value ? t('placeholder') : ''}
        value={draft ?? value?.name ?? ''}
        onFocus={(e) => {
          e.currentTarget.select();
          setDraft(null);
          setActive(0);
          setOpen(true);
        }}
        onBlur={close}
        onChange={onInput}
        onKeyDown={onKeyDown}
      />
      {value ? null : (
        <span className={m.skName} aria-hidden="true">
          <Bar w={160} h={18} />
        </span>
      )}
      <Icon name="chevron-down" size={20} className={m.chev} />
      <ul id={listId} ref={listRef} role="listbox" aria-label={t('label')} className={m.list} hidden={!open}>
        {open && shown.length === 0 ? (
          <li className={cn(m.opt, m.none)} role="presentation">
            {t('notFound')}
          </li>
        ) : (
          shown.map((c, i) => (
            <li
              key={c.iso}
              id={optId(i)}
              role="option"
              aria-selected={i === active}
              className={m.opt}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(c);
              }}
              onMouseMove={() => i !== active && setActive(i)}
            >
              <Flag code={c.flagCode} diameter={22} decorative />
              {c.name}
              <span className={m.hint}>{optionHint(c)}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
