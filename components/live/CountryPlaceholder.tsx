'use client';

/**
 * Заглушка сторінки країни (до US2): заголовок, той самий слот плеєра (відео, з яким прийшли з ефіру, грає далі)
 * і посилання на головну. Ланцюжок плеєра тут не задається: поза поверхнею ефіру `BroadcastController` його не чіпає.
 */
import { useTranslations } from 'next-intl';
import { PlayerSlot } from '@/components/player/PlayerSlot';
import { Link } from '@/components/primitives/Link';
import { getData } from '@/lib/data/load';
import styles from './live.module.css';

export function CountryPlaceholder({ iso }: { iso: string }) {
  const common = useTranslations('common');
  const country = getData().countriesByIso.get(iso);
  if (!country) return null;
  return (
    <>
      <PlayerSlot id="main" />
      <div className={styles.pad}>
        <h1 className="py-4 text-headline-sm text-text">{country.name.uk}</h1>
        <Link variant="chevron" href="/">
          {common('toHome')}
        </Link>
      </div>
    </>
  );
}
