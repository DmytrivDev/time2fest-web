/**
 * Значки соцмереж у підвалі (рішення власника 2026-11-19: значки замість назв). Instagram — з набору значків сайту;
 * Facebook, Threads і LinkedIn — прості монохромні знаки в тому ж стилі (24×24, `currentColor`). Підпис — `aria-label`
 * на посиланні.
 */
import { useTranslations } from 'next-intl';
import siteJson from '@/data/prelaunch/site.json';
import { Icon, type IconSize } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import s from './site.module.css';

const SITE = siteJson as { email: string; social: { name: string; url: string }[] };

const PATHS: Record<string, string> = {
  Facebook:
    'M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5H16.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21h3z',
  Threads:
    'M12.2 21.5c-2.7 0-4.9-.9-6.3-2.6C4.6 17.4 4 15.3 4 12.6V12c.1-2.6.7-4.7 2-6.2C7.4 4.1 9.5 3.3 12.2 3.3c2 0 3.7.5 5 1.5 1.2.9 2 2.2 2.4 3.8l-2 .5c-.7-2.6-2.5-3.9-5.4-3.9-2 0-3.5.6-4.5 1.8-.9 1.1-1.4 2.8-1.5 4.9v.6c0 2.2.5 3.8 1.5 5 1 1.2 2.5 1.8 4.5 1.8 1.6 0 2.8-.4 3.8-1.2 1-.8 1.4-1.8 1.4-2.9 0-.9-.3-1.6-.9-2.1-.2 1.1-.6 2-1.3 2.6-.8.7-1.9 1.1-3.2 1.1-1.1 0-2.1-.3-2.8-.9-.7-.6-1.1-1.4-1.1-2.3 0-1 .4-1.8 1.2-2.4.8-.6 1.9-.9 3.3-.9.6 0 1.2 0 1.7.1-.2-.6-.5-1-.9-1.3-.4-.3-1-.4-1.7-.4-.9 0-1.6.3-2.1.9l-1.6-1.2c.8-1 2.1-1.6 3.7-1.6 1.3 0 2.4.4 3.1 1.1.7.7 1.1 1.7 1.2 3 .5.2.9.5 1.3.8 1.1.9 1.6 2.1 1.6 3.6 0 1.7-.7 3.2-2 4.3-1.4 1.2-3.1 1.8-5.3 1.8zm.4-8.1c-.8 0-1.4.1-1.8.4-.4.3-.6.6-.6 1 0 .8.8 1.3 1.9 1.3.8 0 1.4-.2 1.9-.7.4-.4.6-1 .7-1.8-.6-.1-1.3-.2-2.1-.2z',
  LinkedIn:
    'M5.4 7.6a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 0 1 0 3.8zM3.8 20h3.3V9.3H3.8V20zm5.4-10.7V20h3.3v-5.3c0-1.4.3-2.8 2-2.8 1.7 0 1.7 1.6 1.7 2.9V20h3.3v-5.9c0-2.9-.6-5.1-4-5.1-1.6 0-2.7.9-3.2 1.7v-1.4H9.2z',
};

export function SocialIcon({ name, size = 20 }: { name: string; size?: IconSize }) {
  if (name === 'Instagram') return <Icon name="instagram" size={size} />;
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

/**
 * Ряд значків: пошта й соцмережі (рішення власника перед доменом, 2026-11-19) — у підвалі й унизу меню. Адреса пошти —
 * лише в `aria-label` і `title`.
 */
export function SocialLinks({ className }: { className?: string }) {
  const t = useTranslations('prelaunch.footer');
  return (
    <ul className={cn(s.social, className)} aria-label={t('socialLabel')}>
      <li>
        <a
          href={`mailto:${SITE.email}`}
          aria-label={`${t('write')}: ${SITE.email}`}
          title={SITE.email}
        >
          <Icon name="mail" size={20} />
        </a>
      </li>
      {SITE.social.map((x) => (
        <li key={x.url}>
          <a
            href={x.url}
            rel="noopener noreferrer"
            target="_blank"
            aria-label={t('socialLink', { network: x.name })}
          >
            <SocialIcon name={x.name} />
          </a>
        </li>
      ))}
    </ul>
  );
}
