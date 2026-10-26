'use client';

import { Label } from 'radix-ui';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';
import { IconButton } from './IconButton';

/** Лічильник символів під полем: caption muted → text біля межі → primary на межі (DESIGN «Чат»). */
export function FieldCounter({ length, max, className }: { length: number; max: number; className?: string }) {
  const near = length >= max - 5;
  const atLimit = length >= max;
  return (
    <span
      className={cn('text-caption', atLimit ? 'text-primary' : near ? 'text-text' : 'text-text-muted', className)}
      data-state={atLimit ? 'limit' : near ? 'near' : 'ok'}
    >
      {length}/{max}
    </span>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label: string;
  type?: 'text' | 'email' | 'search';
  /** Підказка під полем. */
  hint?: ReactNode;
  /** Повідомлення про помилку: `aria-invalid` + `aria-describedby`. */
  error?: ReactNode;
  /** Показувати лічильник «N/max» (потрібен `maxLength`). */
  counter?: boolean;
  /** Позначка обов'язкового поля. */
  requiredMark?: string;
  ref?: Ref<HTMLInputElement>;
}

/** P12. Поле введення: 16 px текст (ІНВ I-29), висота 44, межа border-strong, у фокусі жовта. */
export function TextField({
  label,
  type = 'text',
  hint,
  error,
  counter,
  maxLength,
  requiredMark,
  className,
  id,
  value,
  defaultValue,
  onChange,
  disabled,
  ref,
  ...rest
}: TextFieldProps) {
  const t = useTranslations('primitives.field');
  const auto = useId();
  const fieldId = id ?? auto;
  const hintId = `${fieldId}-hint`;
  const errId = `${fieldId}-error`;
  const inner = useRef<HTMLInputElement | null>(null);
  const [uncontrolled, setUncontrolled] = useState(String(defaultValue ?? ''));
  const text = value !== undefined ? String(value) : uncontrolled;
  const describedBy = [error ? errId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  const setRef = (node: HTMLInputElement | null) => {
    inner.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label.Root htmlFor={fieldId} className="text-label-sm text-text-secondary">
        {label}
        {requiredMark ? <span className="text-text-muted"> {requiredMark}</span> : null}
      </Label.Root>
      <div className="relative">
        {type === 'search' && (
          <Icon name="search" size={18} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
        )}
        <input
          ref={setRef}
          id={fieldId}
          type={type}
          value={value}
          defaultValue={defaultValue}
          maxLength={maxLength}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => {
            setUncontrolled(e.target.value);
            onChange?.(e);
          }}
          className={cn(
            't2f-focus t2f-transition block min-h-touch-min w-full rounded-md border bg-background px-3 text-body text-text placeholder:text-text-muted focus-visible:border-highlight disabled:border-border disabled:text-text-muted',
            error ? 'border-primary' : 'border-border-strong',
            type === 'search' && 'ps-10 pe-11',
          )}
          {...rest}
        />
        {type === 'search' && text.length > 0 && !disabled && (
          <IconButton
            icon="close"
            compact
            iconSize={16}
            aria-label={t('clear')}
            className="absolute end-0 top-0"
            onClick={() => {
              const el = inner.current;
              if (!el) return;
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              setter?.call(el, '');
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.focus();
            }}
          />
        )}
      </div>
      {(hint || error || (counter && maxLength)) && (
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            {error && (
              <p id={errId} className="flex items-center gap-1 text-caption text-primary">
                <Icon name="alert" size={16} />
                {error}
              </p>
            )}
            {hint && (
              <p id={hintId} className="text-caption text-text-muted">
                {hint}
              </p>
            )}
          </div>
          {counter && maxLength ? <FieldCounter length={text.length} max={maxLength} /> : null}
        </div>
      )}
    </div>
  );
}
