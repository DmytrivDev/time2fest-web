// Клавіатура мапи поясів: один Tab-стоп, стрілки між поясами, Esc закриває вікно й повертає фокус (`ZoneMap`).
import {
  useRef,
  useState,
  type Dispatch,
  type FocusEvent,
  type KeyboardEvent,
  type SetStateAction,
} from 'react';
import type { MapZone } from './MapModel';
import type { Selection } from './useZoneMapSelection';

export function useZoneMapKeyboard({
  ordered,
  zoneById,
  liveZoneId,
  selection,
  setSelection,
}: {
  ordered: MapZone[];
  zoneById: Map<string, MapZone>;
  liveZoneId: string | undefined;
  selection: Selection;
  setSelection: Dispatch<SetStateAction<Selection>>;
}) {
  const [, setFocusedId] = useState<string | null>(null);
  const [ringId, setRingId] = useState<string | null>(null);
  const [tabStopId, setTabStopId] = useState<string | null>(null);
  const pathRefs = useRef(new Map<string, SVGGElement>());
  const dotRefs = useRef(new Map<string, HTMLElement>());

  const tabStop =
    tabStopId && zoneById.has(tabStopId) ? tabStopId : (liveZoneId ?? ordered[0]?.id ?? null);

  function focusZone(id: string) {
    setTabStopId(id);
    pathRefs.current.get(id)?.focus();
  }

  function onZoneKeyDown(e: KeyboardEvent<SVGGElement>, id: string) {
    const i = ordered.findIndex((z) => z.id === id);
    let target: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        target = Math.min(ordered.length - 1, i + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        target = Math.max(0, i - 1);
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = ordered.length - 1;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        setSelection({ kind: 'zone', id });
        return;
      default:
        return;
    }
    e.preventDefault();
    const next = ordered[target];
    if (!next) return;
    // Відкрита картка поясу йде за фокусом: стрілками можна гортати пояси.
    if (selection?.kind === 'zone') setSelection({ kind: 'zone', id: next.id });
    focusZone(next.id);
  }

  function onZoneFocus(e: FocusEvent<SVGGElement>, id: string) {
    setTabStopId(id);
    setFocusedId(id);
    let visible = true;
    try {
      visible = e.currentTarget.matches(':focus-visible');
    } catch {
      visible = true;
    }
    setRingId(visible ? id : null);
  }

  function onZoneBlur() {
    setFocusedId(null);
    setRingId(null);
  }

  function closeSelection() {
    const prev = selection;
    setSelection(null);
    if (prev?.kind === 'zone' || prev?.kind === 'country') {
      focusZone(prev.kind === 'zone' ? prev.id : prev.zoneId);
      // Esc закриває картку зовсім: фокус повертається на пояс без картки-прев’ю (вона з’явиться з наступним рухом фокуса).
      setFocusedId(null);
    } else if (prev?.kind === 'city') dotRefs.current.get(prev.id)?.focus();
  }

  function onRootKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented || !selection) return;
    if (!e.currentTarget.contains(e.target as Node)) return;
    e.preventDefault();
    closeSelection();
  }

  return {
    tabStop,
    ringId,
    pathRefs,
    dotRefs,
    onZoneKeyDown,
    onZoneFocus,
    onZoneBlur,
    closeSelection,
    onRootKeyDown,
  };
}
