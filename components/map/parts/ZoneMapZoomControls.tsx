'use client';

// Кнопки масштабу мапи поясів (десктоп): «−», відсоток, «+», «Скинути» (`ZoneMap`).
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/components/primitives/cn';
import { MAX_K } from '@/components/map/hooks/useMapZoom';
import m from '@/components/map/zoneMap.module.css';

export function ZoneMapZoomControls({
  k,
  zoomed,
  zoomIn,
  zoomOut,
  reset,
}: {
  k: number;
  zoomed: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}) {
  const t = useTranslations('liveMap');
  return (
    <div
      className={cn(m.zoom, m.zoomDesk)}
      role="group"
      aria-label={t('zoomGroup')}
      data-zone-map-zoom=""
    >
      <ZoomButton label={t('zoomOut')} disabled={!zoomed} onClick={zoomOut}>
        −
      </ZoomButton>
      <span className={m.zoomValue}>{Math.round(k * 100)}%</span>
      <ZoomButton label={t('zoomIn')} disabled={k >= MAX_K - 0.01} onClick={zoomIn}>
        +
      </ZoomButton>
      <span aria-hidden="true" className={m.zoomSep} />
      <button
        type="button"
        disabled={!zoomed}
        onClick={reset}
        className={cn('t2f-focus', m.zoomReset)}
      >
        {t('zoomReset')}
      </button>
    </div>
  );
}

/** Кнопка масштабу мапи (квадрат 32 px; `aria-label` — дія). */
function ZoomButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn('t2f-focus', m.zoomBtn)}
    >
      {children}
    </button>
  );
}
