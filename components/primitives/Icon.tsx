import type { ReactNode, SVGProps } from 'react';
import { cn } from './cn';

/** Набір штрихових іконок (P32): stroke 1.8, розміри 16 / 18 / 20 / 22, завжди aria-hidden. */
export type IconName =
  | 'speaker'
  | 'speaker-off'
  | 'ticket'
  | 'ticket-check'
  | 'calendar'
  | 'calendar-add'
  | 'calendar-check'
  | 'clock'
  | 'broadcast'
  | 'broadcast-dashed'
  | 'user'
  | 'menu'
  | 'more'
  | 'close'
  | 'plus'
  | 'minus'
  | 'check'
  | 'chevron-right'
  | 'chevron-left'
  | 'chevron-down'
  | 'chevron-up'
  | 'arrow-down'
  | 'arrow-left'
  | 'globe'
  | 'pause'
  | 'play'
  | 'search'
  | 'info'
  | 'alert'
  | 'wifi-off'
  | 'send'
  | 'smile'
  | 'tv'
  | 'share'
  | 'expand'
  | 'star'
  | 'dot'
  | 'home'
  | 'map'
  | 'passport'
  | 'heart'
  | 'glass'
  | 'cookie'
  | 'help'
  | 'motion'
  | 'grid4'
  | 'monitor'
  | 'chevrons-right'
  | 'broadcast-live'
  | 'message'
  | 'reply'
  | 'at'
  | 'flag'
  | 'lock'
  | 'pencil'
  | 'filter'
  | 'translate'
  | 'bell'
  | 'route'
  | 'eye'
  | 'eye-off'
  | 'arrow-right'
  | 'shield-check'
  | 'party'
  | 'text-short'
  | 'link-off'
  | 'link'
  | 'sparkles'
  | 'users'
  | 'stamp'
  | 'utensils'
  | 'mistletoe'
  | 'swap'
  | 'undo'
  | 'mail'
  | 'telegram'
  | 'instagram'
  | 'zap'
  | 'sign-out'
  | 'pin'
  | 'spark'
  | 'external'
  // Гліфи екранів входу й пасу (дошки `*-Auth-*`, `S-PASS`; колись `components/auth/icons.tsx`). Варіанти з суфіксом —
  // ті самі знаки з іншою геометрією, що намальована на дошках; злиття з базовими — візуальна правка (за власником).
  | 'check-circle'
  | 'refresh'
  | 'moon'
  | 'cloud-off'
  | 'devices'
  | 'chat'
  | 'card'
  | 'tick'
  | 'alert-bold'
  | 'clock-wide'
  | 'calendar-time'
  | 'lock-tall'
  | 'minus-short'
  | 'envelope'
  | 'rubber-stamp'
  // Іконки традицій наборів країн (конвеєр «Країни», 2026-11-19).
  | 'tradition-bell'
  | 'tradition-noodles'
  | 'tradition-shrine'
  | 'tradition-address'
  | 'tradition-feast'
  | 'tradition-tree'
  | 'tradition-white'
  | 'tradition-flower'
  | 'tradition-wave'
  | 'tradition-fireworks'
  | 'tradition-boat'
  | 'tradition-music'
  | 'tradition-sun'
  | 'tradition-door'
  | 'tradition-grapes'
  | 'tradition-suitcase'
  | 'tradition-flame'
  | 'tradition-horseshoe'
  | 'tradition-glass'
  | 'tradition-clock'
  | 'tradition-sunset'
  | 'tradition-cliff';

export type IconSize = 9 | 12 | 14 | 15 | 16 | 18 | 20 | 22 | 24 | 26 | 32;

const PATHS: Record<IconName, ReactNode> = {
  speaker: (
    <>
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
    </>
  ),
  'speaker-off': (
    <>
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <path d="M17 9l4 6M21 9l-4 6" />
    </>
  ),
  ticket: (
    <>
      <path d="M3 8 V6 H21 V8 A2.5 2.5 0 0 0 21 13 V18 H3 V13 A2.5 2.5 0 0 0 3 8 Z" />
      <path d="M14 6 V18" strokeDasharray="2 2" />
    </>
  ),
  'ticket-check': (
    <>
      <path d="M3 8 V6 H21 V8 A2.5 2.5 0 0 0 21 13 V18 H3 V13 A2.5 2.5 0 0 0 3 8 Z" />
      <path d="M8.5 12l2 2 3.5-4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  'calendar-add': (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4M12 12.5v5.5M9.25 15.25h5.5" />
    </>
  ),
  'calendar-check': (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4M8.8 15.2l2.3 2.3 4.4-4.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  broadcast: (
    <>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M8 8a5.6 5.6 0 0 0 0 8M16 8a5.6 5.6 0 0 1 0 8M5 5a9.9 9.9 0 0 0 0 14M19 5a9.9 9.9 0 0 1 0 14" />
    </>
  ),
  'broadcast-dashed': (
    <>
      <circle cx="12" cy="12" r="2.2" />
      <path
        d="M8 8a5.6 5.6 0 0 0 0 8M16 8a5.6 5.6 0 0 1 0 8M5 5a9.9 9.9 0 0 0 0 14M19 5a9.9 9.9 0 0 1 0 14"
        strokeDasharray="2.2 2.6"
      />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4 20 C5.5 15 18.5 15 20 20" />
    </>
  ),
  menu: <path d="M4 7 H20 M4 12 H20 M4 17 H20" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="M5 12l5 5 9-10" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-up': <path d="M6 15l6-6 6 6" />,
  'arrow-down': <path d="M12 5v14M6 13l6 6 6-6" />,
  'arrow-left': <path d="M19 12H5M11 6l-6 6 6 6" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
    </>
  ),
  pause: <path d="M9 5v14M15 5v14" />,
  play: <path d="M8 5l11 7-11 7z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5h.01" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5h.01" />
    </>
  ),
  'wifi-off': (
    <>
      <path d="M3 9.5a14 14 0 0 1 4-2.4M21 9.5a14 14 0 0 0-8-3.4M6.5 13a8 8 0 0 1 3-1.8M17.5 13a8 8 0 0 0-3-1.8M10 16.5a3.5 3.5 0 0 1 4 0" />
      <path d="M12 19.5h.01M4 4l16 16" />
    </>
  ),
  send: (
    <>
      <path d="M4 12l16-8-6 16-2.5-6.5z" />
      <path d="M11.5 13.5L20 4" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5c1.8 2 5.2 2 7 0M9 9.5h.01M15 9.5h.01" />
    </>
  ),
  tv: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 20.5h8M12 17v3.5" />
    </>
  ),
  share: (
    <>
      <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
      <path d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12" />
    </>
  ),
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  star: <path d="M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z" />,
  dot: <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />,
  home: <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />,
  map: (
    <>
      <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  passport: (
    <>
      <path d="M6 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <circle cx="11.5" cy="10" r="3" />
      <path d="M8.5 16h6" />
    </>
  ),
  heart: <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />,
  // Келих — тост (смуга тостів, вікно «Сказати тост», келих у полі чату).
  glass: (
    <>
      <path d="M8 3h8l-1 7a3 3 0 0 1-6 0z" />
      <path d="M12 13v7M8.5 21h7" />
    </>
  ),
  cookie: (
    <>
      <path d="M12 3a9 9 0 1 0 9 9 3 3 0 0 1-3-3 3 3 0 0 1-3-3 3 3 0 0 1-3-3z" />
      <path d="M8.5 11h.01M12 15.5h.01M15.5 13h.01M9 7.5h.01" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14" />
      <path d="M12 17.5v.01" />
    </>
  ),
  motion: <path d="M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0" />,
  grid4: (
    <>
      <rect x="3" y="4" width="8" height="7" rx="1.5" />
      <rect x="13" y="4" width="8" height="7" rx="1.5" />
      <rect x="3" y="13" width="8" height="7" rx="1.5" />
      <rect x="13" y="13" width="8" height="7" rx="1.5" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  'chevrons-right': <path d="M13 6l6 6-6 6M5 6l6 6-6 6" />,
  message: <path d="M4 5h16v11H9l-5 4z" />,
  reply: (
    <>
      <path d="M10 8L5 12l5 4" />
      <path d="M5 12h9a5 5 0 0 1 5 5v1" />
    </>
  ),
  at: (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M15.6 12v1.6a2.4 2.4 0 0 0 4.8 0V12a8.4 8.4 0 1 0-3.3 6.7" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  /** Трансляція наживо: центр залитий (картка події в ефірі, макет `Main`). */
  'broadcast-live': (
    <>
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
      <path d="M8 8a5.6 5.6 0 0 0 0 8M16 8a5.6 5.6 0 0 1 0 8M5 5a9.9 9.9 0 0 0 0 14M19 5a9.9 9.9 0 0 1 0 14" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
  /** Тихий режим чату (замість місяця, рішення 2026-10-30). */
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  translate: (
    <>
      <path d="M3 5h9M7.5 3v2" />
      <path d="M10 5c-.8 3.6-3 6.4-6 8" />
      <path d="M5.5 8.5c1 1.8 2.6 3.3 4.5 4.3" />
      <path d="M12.5 21l4-9 4 9M13.8 18h5.4" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12C3.5 10.2 7 6 12 6s8.5 4.2 9.5 6c-1 1.8-4.5 6-9.5 6s-8.5-4.2-9.5-6z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z" />
      <path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="9" r="3.2" />
      <circle cx="16.5" cy="10" r="2.6" />
      <path d="M3.5 19c.8-3.2 3-4.8 5.5-4.8s4.7 1.6 5.5 4.8M14.5 15c2.6-.4 5 .9 6 4" />
    </>
  ),
  stamp: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5.5" strokeDasharray="2 2" />
      <path d="M12 9.5l.8 1.7 1.8.2-1.3 1.2.4 1.8-1.7-.9-1.7.9.4-1.8-1.3-1.2 1.8-.2z" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.2 9.5 6-.5.9-1.5 2.3-2.9 3.6M6.3 7.6C4.5 8.9 3.2 10.7 2.5 12c1 1.8 4.5 6 9.5 6 1.6 0 3-.4 4.3-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  // Кімната перегляду: заміна вікна й «Повернути» (2026-11-05).
  swap: <path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" />,
  undo: (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
  'shield-check': (
    <>
      <path d="M12 3l7 3v6c0 4.4-3 7.9-7 9-4-1.1-7-4.6-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  party: (
    <>
      <path d="M4 20l5-14 9 9z" />
      <path d="M14 4l1 2M19 9l2-1M17 3l-1 3" />
    </>
  ),
  'text-short': (
    <>
      <path d="M4 7h16M4 12h10M4 17h7" />
      <path d="M17 15l2 2 3-4" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  // Традиції країни («Як святкувати»): вечеря й омела.
  utensils: (
    <>
      <path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10" />
      <path d="M17 3c-2 2-2 6 0 8v10" />
    </>
  ),
  mistletoe: (
    <>
      <path d="M12 3v7" />
      <path d="M12 10c-4-1-6-4-6-6 3 0 5 2 6 6zM12 10c4-1 6-4 6-6-3 0-5 2-6 6z" />
      <circle cx="10" cy="15" r="2" />
      <circle cx="14" cy="15" r="2" />
      <circle cx="12" cy="19" r="2" />
    </>
  ),
  'link-off': (
    <>
      <path d="M9 7l1-1a4 4 0 0 1 5.7 5.7l-1 1" />
      <path d="M15 17l-1 1a4 4 0 0 1-5.7-5.7l1-1" />
      <path d="M4 4l16 16" />
    </>
  ),  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  telegram: (
    <>
      <path d="M21 4L3 11l6 2 2 6 3-4 5 4z" />
      <path d="M9 13l12-9" />
    </>
  ),
  instagram: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M17 7h.01" />
    </>
  ),
  zap: <path d="M13 3L5 14h6l-1 7 8-11h-6z" />,
  'sign-out': (
    <>
      <path d="M15 4h4v16h-4" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </>
  ),
  // Тост закріплено під трансляцією (дошки `Desk-Toast-New`, `Phone-Toast-New`, 2026-11-12).
  pin: (
    <>
      <path d="M12 17v5" />
      <path d="M5 17h14v-1.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2z" />
    </>
  ),
  // Нік у привітанні опівночі; знак Time2Fest у привітанні (ті самі дошки).
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />,
  // «Відкрити оплату» — сторінка PayPro у новій вкладці.
  external: (
    <>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  ),
  // Гліфи екранів входу й пасу (див. перелік імен вище).
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.7 2.7L16 9.8" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  'cloud-off': (
    <>
      <path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.6A3.8 3.8 0 0 1 17.5 18z" />
      <path d="M4 4l16 16" />
    </>
  ),
  devices: (
    <>
      <rect x="2.5" y="5" width="13" height="10" rx="1.5" />
      <path d="M6 19h6" />
      <rect x="17" y="8" width="4.5" height="11" rx="1" />
    </>
  ),
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  card: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 10h6M7 14h4" />
      <circle cx="16.5" cy="12" r="2" />
    </>
  ),
  tick: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  'alert-bold': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.5h.01" strokeWidth="2.6" />
    </>
  ),
  'clock-wide': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  'calendar-time': (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="M12 13.5v2.5l1.6 1" />
    </>
  ),
  'lock-tall': (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  'minus-short': <path d="M6 12h12" />,
  envelope: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 6.5L12 13l8.5-6.5" />
    </>
  ),
  'rubber-stamp': (
    <>
      <path d="M9.5 3h5v4.5l1.5 3.5h-8l1.5-3.5z" />
      <rect x="4" y="11" width="16" height="5" rx="1.5" />
      <path d="M6 20h12" />
    </>
  ),
  'tradition-bell': (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  'tradition-noodles': (
    <>
      <path d="M4 12h16a8 6 0 0 1-16 0z" />
      <path d="M14 4l6 6M11 4.5l5 5.5" />
      <path d="M8 9c-.6-.8-.6-1.6 0-2.4M11 9c-.6-.8-.6-1.6 0-2.4" />
      <path d="M9 18.5h6" />
    </>
  ),
  'tradition-shrine': (
    <>
      <path d="M3 6.5c3 .8 15 .8 18 0" />
      <path d="M5 10h14" />
      <path d="M7 7v13M17 7v13" />
      <path d="M12 7.2V10" />
    </>
  ),
  'tradition-address': (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M9 21h6M12 17v4" />
      <circle cx="12" cy="9.5" r="1.8" />
      <path d="M8.5 15a3.5 3.5 0 0 1 7 0" />
    </>
  ),
  'tradition-feast': (
    <>
      <circle cx="12" cy="12" r="5" />
      <path d="M4 4v5a1.5 1.5 0 0 0 3 0V4M5.5 9v11" />
      <path d="M19.5 4c-1.6 1.8-1.6 5 0 6.5V20" />
    </>
  ),
  'tradition-tree': (
    <>
      <path d="M12 4l-5 6h3l-4 5h4l-3.5 4h11L14 15h4l-4-5h3z" />
      <path d="M12 19v2" />
      <path d="M12 1.8v.4" />
    </>
  ),
  'tradition-white': (
    <>
      <path d="M8.5 4L4 6.5l1.8 4L8 9.5V20h8V9.5l2.2 1 1.8-4L15.5 4a3.5 3.5 0 0 1-7 0z" />
    </>
  ),
  'tradition-flower': (
    <>
      <circle cx="12" cy="10" r="2.2" />
      <path d="M12 7.8C10.5 4 13.5 4 12 7.8M14.2 10c3.8-1.5 3.8 1.5 0 0M12 12.2c1.5 3.8-1.5 3.8 0 0M9.8 10C6 11.5 6 8.5 9.8 10" />
      <path d="M12 13v8M12 18c-2-.2-3.3-1.2-4-3M12 17c1.8 0 3-.8 3.6-2.3" />
    </>
  ),
  'tradition-wave': (
    <>
      <path d="M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
      <path d="M3 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
      <path d="M3 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
    </>
  ),
  'tradition-fireworks': (
    <>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
      <circle cx="12" cy="12" r="1.5" />
    </>
  ),
  'tradition-boat': (
    <>
      <path d="M3 15h18l-2.5 4h-13z" />
      <path d="M6 15v-4h9l2 4" />
      <path d="M9 11V8h4v3" />
      <path d="M2 21c2 1 4 1 6 0s4-1 6 0 4 1 6 0" />
    </>
  ),
  'tradition-music': (
    <>
      <path d="M9 18V6l10-2v12" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="16" r="2" />
    </>
  ),
  'tradition-sun': (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
    </>
  ),
  'tradition-door': (
    <>
      <path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17" />
      <path d="M3 21h18" />
      <path d="M9 3v18" />
      <circle cx="14.5" cy="12" r="1" />
    </>
  ),
  'tradition-grapes': (
    <>
      <path d="M12 7V4.5M12 5c1.5-1.8 3.8-2 5-1.2-.8 1.6-2.8 2.4-5 1.7" />
      <circle cx="9.5" cy="9.5" r="2.2" />
      <circle cx="14.5" cy="9.5" r="2.2" />
      <circle cx="7.5" cy="13.6" r="2.2" />
      <circle cx="12" cy="13.6" r="2.2" />
      <circle cx="16.5" cy="13.6" r="2.2" />
      <circle cx="9.8" cy="17.7" r="2.2" />
      <circle cx="14.2" cy="17.7" r="2.2" />
      <circle cx="12" cy="21" r="1.6" />
    </>
  ),
  'tradition-suitcase': (
    <>
      <rect x="5" y="7.5" width="14" height="11.5" rx="2" />
      <path d="M9.5 7.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2.5" />
      <path d="M9 11v4.5M15 11v4.5" />
      <path d="M8 19v2M16 19v2" />
    </>
  ),
  'tradition-flame': (
    <>
      <path d="M12 3c.5 3 4.5 4.8 4.5 9a4.5 4.5 0 0 1-9 0c0-2.2 1.2-3.4 2.2-4.4.3 1.6 1 2.4 1.8 2.6C11 8 11 5.5 12 3z" />
      <path d="M5 21l14-3M19 21L5 18" />
    </>
  ),
  'tradition-horseshoe': (
    <>
      <path d="M6.5 20V11a5.5 5.5 0 0 1 11 0v9" />
      <path d="M4.5 20h4M15.5 20h4" />
      <path d="M9 9.2v.01M12 7.2v.01M15 9.2v.01M8.6 14v.01M15.4 14v.01" />
    </>
  ),
  'tradition-glass': (
    <>
      <path d="M4.5 3h5l-.3 5a2.2 2.2 0 0 1-4.4 0z" />
      <path d="M7 10.3V19M5 19h4" />
      <path d="M14.5 3h5l-.3 5a2.2 2.2 0 0 1-4.4 0z" />
      <path d="M17 10.3V19M15 19h4" />
    </>
  ),
  'tradition-clock': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.2 2" />
    </>
  ),
  'tradition-sunset': (
    <>
      <path d="M7 15a5 5 0 0 1 10 0" />
      <path d="M3 15h18" />
      <path d="M12 4.5v2.5M5.2 8.2l1.8 1.8M18.8 8.2L17 10" />
      <path d="M5 19c2-1.3 4-1.3 6 0s4 1.3 6 0" />
    </>
  ),
  'tradition-cliff': (
    <>
      <path d="M3 7h9l1.5 3-.8 3 1.3 3 .5 3" />
      <path d="M3 7v12" />
      <path d="M15.5 17c1.4-1 2.8-1 4.2 0M15 20.5c1.6-1 3.4-1 5 0" />
    </>
  ),
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'size'> {
  name: IconName;
  size?: IconSize;
}

/** Розмір у rem (`size` / 16): іконка масштабується разом із кеглем кореня (пропорційний макет, 2026-11-09). */
export const remOf = (px: number) => `${px / 16}rem`;

export function Icon({ name, size = 18, className, ...rest }: IconProps) {
  return (
    <svg
      width={remOf(size)}
      height={remOf(size)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0', className)}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Знак Google (одноколірний, як на дошках входу): залитий, не штриховий — тому окремо від `Icon`. */
export function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={remOf(size)} height={remOf(size)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M21.4 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.3a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 2.9-4.3 2.9-7.3zM12 21.8c2.7 0 4.9-.9 6.5-2.4l-3.2-2.5c-.9.6-2 1-3.3 1-2.6 0-4.7-1.7-5.5-4H3.2v2.6A9.8 9.8 0 0 0 12 21.8zM6.5 13.9a5.9 5.9 0 0 1 0-3.8V7.5H3.2a9.8 9.8 0 0 0 0 8.9zM12 6.1c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.5 9.5 0 0 0 12 2.2a9.8 9.8 0 0 0-8.8 5.3l3.3 2.6c.8-2.3 2.9-4 5.5-4z"
      />
    </svg>
  );
}
