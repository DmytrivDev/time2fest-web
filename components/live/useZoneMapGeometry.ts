// Ліниве завантаження геометрії мапи поясів (`data/zonemap.json`) для `ZoneMap`.
import { useEffect, useState, type RefObject } from 'react';
import type { ZoneMapGeometry } from './MapModel';

/**
 * Геометрія мапи (~75 КБ) вантажиться, коли мапа наближається до екрана (SC-001): на першому екрані її немає,
 * і на мобільному вона не має забирати канал у плеєра. Без IntersectionObserver — одразу.
 */
export function useGeometry(
  initial: ZoneMapGeometry | undefined,
  root: RefObject<HTMLElement | null>,
) {
  const [loaded, setLoaded] = useState<ZoneMapGeometry | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (initial) return;
    let alive = true;
    const load = () =>
      import('@/data/zonemap.json')
        .then((m) => {
          if (alive) setLoaded(m.default as unknown as ZoneMapGeometry);
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      void load();
      return () => {
        alive = false;
      };
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((en) => en.isIntersecting)) return;
        io.disconnect();
        void load();
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [initial, root]);
  return { geometry: initial ?? loaded, failed };
}
