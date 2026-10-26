import type { Decorator, Preview } from '@storybook/nextjs';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import '../app/globals.css';
import { TimeProvider } from '../lib/time/TimeProvider';
import messages from '../messages/uk.json';
import { useGuestStore } from '../stores/guest';
import { assertSingleCoral, isPageOrWindowStory } from './coral-check';

// Декоратори (T056): ширина (телефон / десктоп / ТВ), «зменшити рух», «машина часу».
// «Машина часу» — `TimeProvider override` (T019); той самий механізм використає панель розробника (T086).

type Surface = 'auto' | 'phone' | 'desktop' | 'tv';
const WIDTH: Record<Exclude<Surface, 'auto'>, number> = { phone: 390, desktop: 1440, tv: 1920 };

/** Півночі за замовчуванням для пресетів «машини часу» (UTC). */
const DEFAULT_MIDNIGHT = '2027-01-01T00:00:00Z';
const TIME_PRESETS: Record<string, number | null> = {
  real: null,
  minus15m: -15 * 60_000,
  minus1m: -60_000,
  minus20s: -20_000,
  zero: 0,
  plus14m: 14 * 60_000,
};

export interface StoryTime {
  /** ISO-момент «зараз»; перекриває пресет із панелі. */
  at?: string;
  /** Півночі, від якої рахують пресети; за замовчуванням 2027-01-01T00:00:00Z. */
  midnight?: string;
  speed?: number;
  frozen?: boolean;
}

interface ShellProps {
  surface: Surface;
  reduce: boolean;
  preset: string;
  time: StoryTime | undefined;
  children: ReactNode;
}

function Shell({ surface, reduce, preset, time, children }: ShellProps) {
  useEffect(() => {
    const root = document.documentElement;
    root.lang = 'uk';
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
    // Той самий атрибут, що ставить lib/a11y/reducedMotion (true|false), і стан гостя для JS-анімацій.
    root.setAttribute('data-reduce-motion', reduce ? 'true' : 'false');
    useGuestStore.setState({ reducedMotion: reduce });
    return () => root.removeAttribute('data-reduce-motion');
  }, [reduce]);

  // Віртуальний час потрібен завжди: справжній `TimeProvider` у Storybook ходив би на /api/time.
  const [started] = useState(() => Date.now());
  const override = useMemo(() => {
    if (time?.at) return { at: time.at, speed: time.speed, frozen: time.frozen };
    const offset = TIME_PRESETS[preset];
    if (offset === null || offset === undefined) return { at: started, speed: time?.speed, frozen: time?.frozen };
    return { at: Date.parse(time?.midnight ?? DEFAULT_MIDNIGHT) + offset, speed: time?.speed, frozen: time?.frozen ?? preset === 'zero' };
  }, [time, preset, started]);

  const width = surface === 'auto' ? undefined : WIDTH[surface];

  return (
    <NextIntlClientProvider locale="uk" messages={messages}>
      <TimeProvider key={`${preset}|${JSON.stringify(time ?? null)}`} override={override}>
        <div
          data-surface={surface === 'tv' ? 'tv' : undefined}
          style={{ width, maxWidth: '100%', margin: surface === 'auto' ? undefined : '0 auto' }}
          className="bg-background text-body text-text"
        >
          {children}
        </div>
      </TimeProvider>
    </NextIntlClientProvider>
  );
}

const withShell: Decorator = (Story, context) => (
  <Shell
    surface={(context.globals.surface as Surface | undefined) ?? 'auto'}
    reduce={context.globals.reduceMotion === 'on'}
    preset={(context.globals.time as string | undefined) ?? 'real'}
    time={context.parameters.time as StoryTime | undefined}
  >
    <Story />
  </Shell>
);

const preview: Preview = {
  decorators: [withShell],
  globalTypes: {
    surface: {
      description: 'Ширина полотна',
      toolbar: {
        title: 'Ширина',
        icon: 'browser',
        dynamicTitle: true,
        items: [
          { value: 'auto', title: 'Вільна' },
          { value: 'phone', title: 'Телефон 390' },
          { value: 'desktop', title: 'Десктоп 1440' },
          { value: 'tv', title: 'ТВ 1920 (фокус 4 px)' },
        ],
      },
    },
    reduceMotion: {
      description: 'Зменшити рух',
      toolbar: {
        title: 'Рух',
        icon: 'lightning',
        dynamicTitle: true,
        items: [
          { value: 'off', title: 'Рух увімкнено' },
          { value: 'on', title: 'Зменшити рух' },
        ],
      },
    },
    time: {
      description: 'Машина часу (відносно півночі 2027-01-01 UTC)',
      toolbar: {
        title: 'Час',
        icon: 'time',
        dynamicTitle: true,
        items: [
          { value: 'real', title: 'Справжній час' },
          { value: 'minus15m', title: '−15 хв до півночі' },
          { value: 'minus1m', title: '−1 хв' },
          { value: 'minus20s', title: '−20 с' },
          { value: 'zero', title: 'Північ' },
          { value: 'plus14m', title: '+14 хв' },
        ],
      },
    },
  },
  initialGlobals: { surface: 'auto', reduceMotion: 'off', time: 'real', backgrounds: { value: 'dark' } },
  parameters: {
    layout: 'fullscreen',
    backgrounds: { options: { dark: { name: 'dark', value: '#121214' } } },
    viewport: {
      options: {
        phone: { name: 'Телефон 390', styles: { width: '390px', height: '844px' } },
        tablet: { name: 'Планшет 768', styles: { width: '768px', height: '1024px' } },
        desktop: { name: 'Десктоп 1440', styles: { width: '1440px', height: '900px' } },
        tv: { name: 'ТВ 1920', styles: { width: '1920px', height: '1080px' } },
      },
    },
  },
  // Правило однієї коралової кнопки (ІНВ 5.3): на кожній історії сторінки й вікна видимих [data-variant="coral"] ≤ 1.
  afterEach: ({ canvasElement, title, tags }) => {
    if (isPageOrWindowStory(title, tags)) assertSingleCoral(canvasElement);
  },
};

export default preview;
