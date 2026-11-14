'use client';

/** Дрібні спільні шматки розділів кабінету: рядок стану запису, рядок налаштування, сегментований перемикач, перемикач-рядок. */

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { Switch } from '@/components/primitives/Switch';
import type { SaveState } from './useSave';
import s from './account.module.css';

/** Рядок стану запису під розділом: «Зберігаємо…» чи «Не вдалося зберегти зміну». */
export function SaveLine({ state, failed }: { state: SaveState; failed: string }) {
  const t = useTranslations('account.save');
  if (state === 'saving')
    return (
      <p className={cn(s.hint, s.saveLine)} role="status">
        <span className={s.spin} aria-hidden="true" />
        {t('saving')}
      </p>
    );
  if (state === 'failed')
    return (
      <p className={cn(s.err, s.saveLine)} role="alert">
        <Icon name="alert" size={16} />
        {failed}
      </p>
    );
  return null;
}

export function Row({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className={s.row}>
      <div className={s.rowText}>
        <div className={s.rowTitle}>{title}</div>
        {hint ? <div className={s.rowHint}>{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; lang?: string }[]; onChange(v: T): void }) {
  return (
    <div role="radiogroup" aria-label={label} className={s.seg}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          lang={o.lang}
          onClick={() => onChange(o.value)}
          className={cn('t2f-focus t2f-transition', s.segItem)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Рядок-перемикач: назва й пояснення ліворуч, доріжка праворуч (уся смуга назви — ціль). */
export function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange(v: boolean): void }) {
  return (
    <div className={s.toggleRow}>
      <Switch label={<span className={s.rowTitle}>{label}</span>} checked={checked} disabled={disabled} onCheckedChange={onChange} className={s.switch} />
      <div className={s.rowHint}>{hint}</div>
    </div>
  );
}
