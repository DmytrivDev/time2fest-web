'use client';

/**
 * Годинник «Машини часу» в шапці демо-збірки (власник 2026-11-11): перша дія праворуч, і на телефоні.
 * У `(live)` вікно відкриває `ShellHeader` (на місці чату / шторка) — передає `onClick`; на решті сторінок кнопка сама
 * відкриває бічне вікно (`SideDialog`), як меню.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Icon } from '@/components/primitives/Icon';
import { SideDialog } from '@/components/shell/Menu';
import { TimeProvider } from '@/lib/time/TimeProvider';
import { TimeMachineBody } from './TimeMachineBody';

export function DemoClock({ onClick, open, className }: { onClick?: () => void; open?: boolean; className?: string }) {
  const t = useTranslations('demoTime');
  const [own, setOwn] = useState(false);
  const isOpen = onClick ? Boolean(open) : own;
  return (
    <>
      <button
        type="button"
        aria-label={t('title')}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={onClick ?? (() => setOwn((v) => !v))}
        className={className}
        data-demo-clock=""
      >
        <Icon name={isOpen ? 'close' : 'clock'} size={20} />
      </button>
      {onClick ? null : (
        <SideDialog open={own} onOpenChange={setOwn} title={t('title')}>
          {/* Службові сторінки без годинника сайту: свій, з того ж сховища — стрибок діє на наступній сторінці свята. */}
          <TimeProvider>
            <TimeMachineBody />
          </TimeProvider>
        </SideDialog>
      )}
    </>
  );
}
