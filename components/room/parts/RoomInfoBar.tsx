'use client';

/**
 * Рядок під вікнами кімнати: «Кімната перегляду · N з 4», відлік до найближчої півночі й дії («Додати / Замінити
 * трансляцію», «Поділитися», «Режим вечірки», «⋯»). Телефон — компактний варіант. Виокремлено з `RoomLive.tsx` (WP-F).
 */
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/primitives/Button';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { usePartyHref } from '@/components/shell/OverlayManager';
import s from '@/components/room/room.module.css';

export function RoomInfoBar({
  phone,
  count,
  limit,
  soundLive,
  soundTitle,
  nextMidnight,
  nextCities,
  timerText,
  chatButton,
  onAdd,
  onShare,
  onMore,
}: {
  phone: boolean;
  /** Кількість вікон у кімнаті. */
  count: number;
  limit: number;
  soundLive: boolean;
  soundTitle: string;
  nextMidnight: number | undefined;
  nextCities: readonly string[];
  timerText: string;
  chatButton: ReactNode;
  onAdd: () => void;
  onShare: () => void;
  onMore: () => void;
}) {
  const t = useTranslations('room.page');
  const tShare = useTranslations('room.share');
  const tPlayer = useTranslations('player');
  const router = useRouter();
  // «Режим вечірки»: телефон і планшет-портрет — `/tv-info/` (2026-11-10).
  const partyHref = usePartyHref();
  const full = count >= limit;

  const sub =
    count === 0
      ? t('subEmpty', { limit })
      : count > 1
        ? soundLive
          ? t('sub', { count, limit, title: soundTitle })
          : t('subMuted', { count, limit })
        : t('subOne', { count, limit });
  const addBtn = full ? (
    <Button variant="secondary" iconLeft="swap" onClick={onAdd} data-action="room-replace">
      {t('replaceButton')}
    </Button>
  ) : (
    <Button variant="secondary" iconLeft="plus" onClick={onAdd} data-action="room-add">
      {t('addButton')}
    </Button>
  );

  return phone ? (
    <div className={s.phoneActions}>
      <div className={s.phoneTimer}>
        <span>
          {nextMidnight
            ? t('phoneTimer', { count, limit })
            : t('phoneCount', { count, limit })}
        </span>
        {nextMidnight ? <b>{timerText}</b> : null}
      </div>
      <div className={s.phoneRow}>
        <Button
          variant="secondary"
          compact
          iconLeft={full ? 'swap' : 'plus'}
          onClick={onAdd}
          data-action={full ? 'room-replace' : 'room-add'}
        >
          {full ? t('replaceShort') : t('addShort')}
        </Button>
        <span className={s.spacer} />
        <IconButton icon="share" variant="ring" aria-label={tShare('button')} onClick={onShare} />
        <IconButton
          icon="monitor"
          variant="ring"
          aria-label={tPlayer('partyMode')}
          onClick={() => router.push(partyHref)}
        />
        <IconButton
          icon="more"
          variant="plain"
          aria-label={tPlayer('moreActions')}
          onClick={onMore}
        />
      </div>
    </div>
  ) : (
    <>
      <div className={s.info}>
        <div className={s.infoText}>
          <h1 className={s.infoTitle}>{t('heading')}</h1>
          <p className={s.infoSub}>{sub}</p>
        </div>
        {/* Чат сховано — «Показати чат» поруч із таймером, як на головній. */}
        {chatButton}
        {nextMidnight ? (
          <div className={s.timer} data-room-timer="">
            <span>{t('untilMidnight', { cities: nextCities.join(' і ') })}</span>
            <b>{timerText}</b>
          </div>
        ) : count ? (
          <div className={s.timer}>
            <span>{t('allPast')}</span>
          </div>
        ) : null}
      </div>
      <div className={s.actions}>
        {addBtn}
        <Button variant="secondary" iconLeft="share" onClick={onShare} data-action="room-share">
          {tShare('button')}
        </Button>
        <span className={s.spacer} />
        <Button asChild variant="tonal">
          <NextLink href={partyHref} data-action="party-mode">
            <Icon name="monitor" size={18} />
            {tPlayer('partyMode')}
          </NextLink>
        </Button>
        <IconButton
          icon="more"
          variant="ring"
          aria-label={tPlayer('moreActions')}
          aria-haspopup="dialog"
          onClick={onMore}
        />
      </div>
    </>
  );
}
