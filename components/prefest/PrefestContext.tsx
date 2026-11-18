'use client';

/**
 * Спільне для блоків головної «до свята»: модель даних (`lib/prefest/model`), «сторінка вже в браузері» (час
 * відвідувача відомий лише після гідратації — статичний експорт збирається в UTC) і тост для заглушок.
 */
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { Dataset } from '@/lib/data/types';
import { getData } from '@/lib/data/load';
import type { PrefestModel } from '@/lib/prefest/model';
import { cn } from '@/components/primitives/cn';
import type { ExpectedKind } from '@/components/map/mapPrefest';
import s from './prefest.module.css';

/** Фото чи відео на місці заглушки (`data/prelaunch/media.json`). */
export interface MediaItem {
  src: string;
  /** Підпис для незрячих: рядок або мовами (`{ "en": …, "uk": … }`). */
  alt?: string | Record<string, string>;
  /** Автор, ліцензія й сторінка джерела — підпис під фото (обов’язковий для Wikimedia). */
  author?: string;
  license?: string;
  sourceUrl?: string;
  /** Для відео: кадр до запуску. */
  poster?: string;
  /** Для відео: джерела по черзі (браузер бере перше, яке вміє й під яке підходить `media`); `src` — запасне. */
  sources?: readonly { src: string; type: string; media?: string }[];
  kind?: 'image' | 'video';
}

/** `alt` фото мовою сторінки. */
export function mediaAlt(
  item: MediaItem | undefined,
  locale: string | undefined,
  fallback: string,
): string {
  const alt = item?.alt;
  if (!alt) return fallback;
  return typeof alt === 'string' ? alt : (alt[locale ?? ''] ?? alt.en ?? fallback);
}

/**
 * Мовне дерево (`app/[locale]`, передстартовий сайт). Блоки головної, отримавши `site`, показують правки плану
 * передстартового сайту (розділ 9); без нього (`/before`) — усе як було.
 */
export interface PrefestSite {
  locale: string;
  /** Адреса сторінки мовного дерева за шляхом без мови (`/countries/`). */
  href: (path: string) => string;
  media: Readonly<Record<string, MediaItem>>;
  /** Місто пояса відвідувача мовою сторінки («Київ») або порожньо. */
  zoneCity: (timeZone: string) => string;
  /** Форма «у країні» мовою сторінки, якщо вона є в даних. */
  inCountry: (iso: string) => string | undefined;
  /** Тип очікуваної трансляції країни в поясі (`data/prelaunch/expected.json`) або `null`. */
  expectedKind?: (iso: string, zoneId: string) => ExpectedKind | null;
}

interface PrefestContextValue {
  model: PrefestModel;
  toast: (text: string) => void;
  /** Каталог, з якого збудовано модель (у мовному дереві — мовою сторінки). */
  data: Dataset;
  site: PrefestSite | null;
}

const Ctx = createContext<PrefestContextValue | null>(null);

export function usePrefest(): PrefestContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePrefest: потрібен <PrefestProvider>');
  return v;
}

const noop = () => () => undefined;
/** `true` лише в браузері після гідратації: до того час і пояс відвідувача невідомі — показуємо нейтральну заглушку. */
export function useClientReady(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

export function PrefestProvider({
  model,
  data,
  site = null,
  children,
}: {
  model: PrefestModel;
  data?: Dataset;
  site?: PrefestSite | null;
  children: ReactNode;
}) {
  const [text, setText] = useState('');
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((t: string) => {
    setText(t);
    setOn(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), 2600);
  }, []);
  return (
    <Ctx.Provider value={{ model, toast, data: data ?? getData(), site }}>
      {children}
      <div className={cn(s.toast, on && s.toastOn)} role="status" aria-live="polite">
        {text}
      </div>
    </Ctx.Provider>
  );
}
