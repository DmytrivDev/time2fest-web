'use client';

/**
 * Шар вікон поза чатом у `ChatDock`: контейнер є завжди (портал вікна шукає його в DOM), видно лише з вікном.
 * Ручка закриває шар дотиком; жести — у `useLayerSwipe`.
 */
import type { CSSProperties, FocusEvent, Ref } from 'react';
import { LAYER_DOCK_SLOT_ID } from '@/components/primitives/Panel';

export function ChatDockLayer({
  layerRef,
  land,
  hidden,
  closing,
  style,
  onLayerFocus,
  onClose,
}: {
  layerRef: Ref<HTMLDivElement>;
  land: boolean;
  hidden: boolean;
  closing: boolean;
  style: CSSProperties;
  onLayerFocus: (e: FocusEvent<HTMLElement>, on: boolean) => void;
  onClose: () => void;
}) {
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      ref={layerRef}
      data-window-layer=""
      data-land={land ? 'true' : undefined}
      className="t2f-layer"
      hidden={hidden}
      inert={closing || undefined}
      data-closing={closing ? 'true' : undefined}
      style={style}
      onFocus={(e) => onLayerFocus(e, true)}
      onBlur={(e) => onLayerFocus(e, false)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('.t2f-layer-grip')) onClose();
      }}
    >
      <div aria-hidden="true" className="t2f-layer-grip">
        <span className="t2f-dock-handle" />
      </div>
      <div id={LAYER_DOCK_SLOT_ID} className="t2f-layer-slot" />
    </div>
  );
}
