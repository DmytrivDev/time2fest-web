'use client';

/**
 * Рядок дій під підписом плеєра (C1 ActionRow, режим `broadcast`):
 * [SoundToggle] [«Обрати трансляцію ›» / «Лишитися тут ›»] + десктоп — tonal «Кімната перегляду», «Режим вечірки»;
 * телефон і планшет — «⋯» праворуч з аркушем «Ще дії» (через `OverlayManager`, вікно `nonmodal`).
 * Кімната (US3), режим вечірки, «Поділитися трансляцією» (US6) і «Повідомити про проблему» тут ще інертні.
 * «Лишитися тут ›» — клієнтський перехід у межах `(live)`: макет і плеєр не перемонтовуються (SC-003).
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { SoundToggle, type SoundToggleProps } from '@/components/player/SoundToggle';
import { useOverlay } from '@/components/shell/OverlayManager';
import type { CaptionButton } from '@/lib/engine/captionPhase';
import styles from './live.module.css';

export const MORE_ACTIONS_ID = 'O-MORE-ACTIONS';

export interface ActionRowProps {
  /** Кнопка з фази підпису: «Обрати трансляцію ›» або «Лишитися тут ›». */
  button: CaptionButton;
  /** Сторінка країни поточної події. */
  href: string | null;
  sound: SoundToggleProps;
  /** «Лишитися тут ›»: запам’ятати подію перед переходом (BroadcastController.stayHere). */
  onStayHere?: () => void;
  className?: string;
}

function MoreActions() {
  const t = useTranslations('player');
  const items = [t('roomOpen'), t('partyMode'), t('shareStream'), t('reportProblem')];
  return (
    <ul className="flex flex-col gap-1">
      {items.map((label) => (
        <li key={label}>
          {/* Інертні до US3/US5/US6: дія з’явиться разом із відповідним вікном. */}
          <Button variant="ghost" disabled className="w-full justify-start">
            {label}
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function ActionRow({ button, href, sound, onStayHere, className }: ActionRowProps) {
  const t = useTranslations('player');
  const overlay = useOverlay();
  const stay = button === 'stay-here';
  const label = stay ? t('stayHere') : t('chooseStream');

  const openMore = () =>
    overlay.open({ id: MORE_ACTIONS_ID, kind: 'nonmodal', title: t('moreActions'), content: <MoreActions /> });

  return (
    <div data-action-row="" className={cn('flex flex-wrap items-center gap-2', className)}>
      <SoundToggle {...sound} />
      {href ? (
        <Button asChild variant="secondary" className="min-w-0 pe-3.5">
          <NextLink href={href} onClick={stay ? onStayHere : undefined} data-action={button}>
            {label}
            <Icon name="chevron-right" size={16} />
          </NextLink>
        </Button>
      ) : null}
      <span className="flex-1" />
      <span className={cn(styles.deskOnly, 'flex-wrap gap-2')}>
        {/* Інертні до US3 (кімната) і режиму вечірки. */}
        <Button variant="tonal" disabled iconLeft="tv">
          {t('roomOpen')}
        </Button>
        <Button variant="tonal" disabled iconLeft="expand">
          {t('partyMode')}
        </Button>
      </span>
      <span className={styles.phoneOnly}>
        <IconButton
          icon="more"
          aria-label={t('moreActions')}
          aria-haspopup="dialog"
          aria-expanded={overlay.current?.id === MORE_ACTIONS_ID}
          onClick={openMore}
        />
      </span>
    </div>
  );
}
