'use client';

import { Accordion as Radix } from 'radix-ui';
import { createElement, type ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';

export interface AccordionItemData {
  value: string;
  title: ReactNode;
  content: ReactNode;
}

interface Common {
  items: AccordionItemData[];
  className?: string;
  /** Рівень заголовка тригера (за замовчуванням h3, бо секція має h2). */
  headingLevel?: 2 | 3 | 4;
}
export type AccordionProps =
  | (Common & { type?: 'single'; defaultValue?: string; value?: string; onValueChange?: (v: string) => void })
  | (Common & { type: 'multiple'; defaultValue?: string[]; value?: string[]; onValueChange?: (v: string[]) => void });

/** P28. «Питання й відповіді», «Весь шлях». Один відкритий (single) чи кілька (multiple). */
export function Accordion(props: AccordionProps) {
  const { items, className } = props;
  const level = props.headingLevel ?? 3;
  const root = cn('divide-y divide-border rounded-lg border border-border bg-surface', className);
  const body = items.map((it) => (
    <Radix.Item key={it.value} value={it.value} className="group/item">
      <Radix.Header asChild>
        {createElement(
          `h${level}`,
          null,
          <Radix.Trigger className="t2f-focus t2f-transition group flex min-h-touch-min w-full items-center gap-3 px-4 py-2 text-start text-body-strong text-text hover:bg-surface-raised group-first/item:rounded-t-lg group-last/item:[&[aria-expanded=false]]:rounded-b-lg">
            <span className="flex-1">{it.title}</span>
            <Icon name="chevron-down" size={18} className="group-aria-expanded:rotate-180" />
          </Radix.Trigger>,
        )}
      </Radix.Header>
      <Radix.Content className="t2f-acc-content">
        <div className="px-4 pb-4 text-body text-text-secondary">{it.content}</div>
      </Radix.Content>
    </Radix.Item>
  ));
  if (props.type === 'multiple') {
    return (
      <Radix.Root type="multiple" className={root} defaultValue={props.defaultValue} value={props.value} onValueChange={props.onValueChange}>
        {body}
      </Radix.Root>
    );
  }
  return (
    <Radix.Root
      type="single"
      collapsible
      className={root}
      defaultValue={props.defaultValue}
      value={props.value}
      onValueChange={props.onValueChange}
    >
      {body}
    </Radix.Root>
  );
}
