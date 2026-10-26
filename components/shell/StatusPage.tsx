import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/primitives/Icon';

export interface StatusPageProps {
  icon: IconName;
  title: string;
  text: string;
  /** Кнопки; на телефоні — стовпчиком на всю ширину, ширше — рядом. */
  children: ReactNode;
}

/** Вміст сторінок 404 і помилки (Phone-404, Desk-404, Phone-Error): знак, заголовок, пояснення, дії. */
export function StatusPage({ icon, title, text, children }: StatusPageProps) {
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3">
      <span
        aria-hidden="true"
        className="mb-2 flex size-16 items-center justify-center rounded-full border border-border bg-surface text-highlight"
      >
        <Icon name={icon} size={22} />
      </span>
      <h1 className="text-headline-md text-text">{title}</h1>
      <p className="text-body text-text-secondary">{text}</p>
      <div className="mt-2 flex w-full flex-col gap-2 md:flex-row md:justify-center">
        {children}
      </div>
    </div>
  );
}
