import type { ReactNode } from 'react';

/** Полотно історії: відступ і підписані ряди станів (d f x e s l …). Лише для Storybook. */
export function Stage({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col gap-6 p-4 ${className}`}>{children}</div>;
}

export function StateRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-caption text-text-muted">{label}</h3>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}
