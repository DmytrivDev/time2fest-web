'use client';

import { Label } from 'radix-ui';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react';
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
  /** Клас рамки поля (чат: пігулка за макетом `Main`). */
  frameClassName?: string;
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
  frameClassName,
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

  const resize = useCallback(() => {
    const node = el.current;
    if (!node) return;
    node.style.height = 'auto';
    // Максимум — maxRows рядків тексту плюс вертикальні відступи поля (box-sizing: border-box).
    const cs = getComputedStyle(node);
    const line = Number.parseFloat(cs.lineHeight) || LINE;
    const pad = Number.parseFloat(cs.paddingTop) + Number.parseFloat(cs.paddingBottom) || 0;
    // Порожнє поле — завжди один рядок: довгий placeholder, що переноситься у вузькому полі, не має роздувати висоту.
    const natural = node.value === '' ? line + pad : node.scrollHeight;
    node.style.height = `${Math.min(Math.round(natural), Math.round(line * maxRows + pad))}px`;
  }, [maxRows]);

  useLayoutEffect(resize, [text, resize]);

  // Зміна ширини (колонка чату, шрифти, вікно) перераховує висоту; без цього вона лишалась би застарілою.
  useEffect(() => {
    const node = el.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    let width = node.clientWidth;
    const ro = new ResizeObserver(() => {
      if (node.clientWidth === width) return;
      width = node.clientWidth;
      resize();
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [resize]);

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
          frameClassName,
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
