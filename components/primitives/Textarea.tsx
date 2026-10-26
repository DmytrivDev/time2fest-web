'use client';

import { Label } from 'radix-ui';
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';
import { FieldCounter } from './TextField';

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> {
  /** Підпис поля; можна приховати візуально (`hideLabel`), тоді він лишається для зчитувача. */
  label: string;
  hideLabel?: boolean;
  /** Автовисота: від 1 до `maxRows` рядків (за замовчуванням 4). */
  maxRows?: number;
  hint?: ReactNode;
  error?: ReactNode;
  counter?: boolean;
  /** Показувати лічильник лише з цього символу (чат: 180). */
  counterFrom?: number;
  /** Вбудовані кнопки справа (готові привітання, надіслати). */
  endSlot?: ReactNode;
  ref?: Ref<HTMLTextAreaElement>;
}

const LINE = 24; // line-height text-body: 16 × 1.5

/** P13. Багаторядкове поле, автовисота 1–4 рядки, лічильник, кнопки справа. 16 px текст. */
export function Textarea({
  label,
  hideLabel,
  maxRows = 4,
  hint,
  error,
  counter,
  counterFrom = 0,
  endSlot,
  maxLength,
  className,
  id,
  value,
  defaultValue,
  onChange,
  disabled,
  ref,
  ...rest
}: TextareaProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  const hintId = `${fieldId}-hint`;
  const errId = `${fieldId}-error`;
  const el = useRef<HTMLTextAreaElement | null>(null);
  const [uncontrolled, setUncontrolled] = useState(String(defaultValue ?? ''));
  const text = value !== undefined ? String(value) : uncontrolled;
  const describedBy = [error ? errId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, LINE * maxRows)}px`;
  }, [text, maxRows]);

  const setRef = (node: HTMLTextAreaElement | null) => {
    el.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label.Root htmlFor={fieldId} className={hideLabel ? 'sr-only' : 'text-label-sm text-text-secondary'}>
        {label}
      </Label.Root>
      <div
        className={cn(
          't2f-transition flex min-h-touch-min items-end gap-1 rounded-md border bg-background ps-3 focus-within:border-highlight',
          error ? 'border-primary' : 'border-border-strong',
          disabled && 'border-border',
        )}
      >
        <textarea
          ref={setRef}
          id={fieldId}
          rows={1}
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
          className="t2f-focus block min-w-0 flex-1 resize-none bg-transparent py-2.5 text-body text-text placeholder:text-text-muted disabled:text-text-muted"
          {...rest}
        />
        {endSlot ? <div className="flex shrink-0 items-center">{endSlot}</div> : null}
      </div>
      {(hint || error || (counter && maxLength && text.length >= counterFrom)) && (
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
          {counter && maxLength && text.length >= counterFrom ? <FieldCounter length={text.length} max={maxLength} /> : null}
        </div>
      )}
    </div>
  );
}
