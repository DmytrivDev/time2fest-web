/**
 * Іконки екранів входу, яких немає в загальному наборі (`primitives/Icon`): шляхи — з дощок `*-Auth-*`.
 * Штрих 1.8, завжди `aria-hidden`.
 */
import type { ReactNode } from 'react';

const PATHS = {
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 6.5L12 13l8.5-6.5" />
    </>
  ),
  keypad: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7.5 12h.01M12 12h.01M16.5 12h.01" strokeWidth="2.6" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.7 2.7L16 9.8" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.5h.01" strokeWidth="2.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
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
  unlink: (
    <>
      <path d="M9 7l1-1a4 4 0 0 1 5.7 5.7l-1 1" />
      <path d="M15 17l-1 1a4 4 0 0 1-5.7-5.7l1-1" />
      <path d="M4 4l16 16" />
    </>
  ),
  stamp: (
    <>
      <path d="M9.5 3h5v4.5l1.5 3.5h-8l1.5-3.5z" />
      <rect x="4" y="11" width="16" height="5" rx="1.5" />
      <path d="M6 20h12" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="M12 13.5v2.5l1.6 1" />
    </>
  ),
  ticket: (
    <>
      <path d="M3 8 V6 H21 V8 A2.5 2.5 0 0 0 21 13 V18 H3 V13 A2.5 2.5 0 0 0 3 8 Z" />
      <path d="M14 6 V18" strokeDasharray="2 2" />
    </>
  ),
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" />,
  card: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 10h6M7 14h4" />
      <circle cx="16.5" cy="12" r="2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4 20 C5.5 15 18.5 15 20 20" />
    </>
  ),
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
} satisfies Record<string, ReactNode>;

export type AuthIconName = keyof typeof PATHS;

export function AuthIcon({ name, size = 20, className }: { name: AuthIconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'chevron-left' ? 2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Знак Google (одноколірний, як на дошках). */
export function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M21.4 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.3a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 2.9-4.3 2.9-7.3zM12 21.8c2.7 0 4.9-.9 6.5-2.4l-3.2-2.5c-.9.6-2 1-3.3 1-2.6 0-4.7-1.7-5.5-4H3.2v2.6A9.8 9.8 0 0 0 12 21.8zM6.5 13.9a5.9 5.9 0 0 1 0-3.8V7.5H3.2a9.8 9.8 0 0 0 0 8.9zM12 6.1c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.5 9.5 0 0 0 12 2.2a9.8 9.8 0 0 0-8.8 5.3l3.3 2.6c.8-2.3 2.9-4 5.5-4z"
      />
    </svg>
  );
}
