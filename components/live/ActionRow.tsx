'use client';

/**
 * Рядок дій під підписом плеєра (C1 ActionRow, режим `broadcast`):
 * [SoundToggle] [«Обрати трансляцію ›» / «Лишитися тут ›»] + десктоп — tonal «Кімната перегляду», «Режим вечірки»;
 * телефон і планшет — «⋯» праворуч з аркушем «Ще дії» (через `OverlayManager`, вікно `nonmodal`).
 * Кімната (US3), режим вечірки, «Поділитися трансляцією» (US6) і «Повідомити про проблему» тут ще інертні.
 * «Лишитися тут ›» — клієнтський перехід у межах `(live)`: макет і плеєр не перемонтовуються (SC-003).
 *
 * Режим `remote` (сторінка країни, пульт): [SoundToggle] [«Ще трансляції» — десктоп прокручує до блоків трансляцій,
 * телефон відкриває аркуш; після півночі — «Записи»] [«Подивитися північ ще раз», лише коли джерело дає повтор]
 * + ті самі інертні дії кімнати й вечірки. Переходу на іншу сторінку тут немає: пульт сам нікуди не веде.
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { SoundToggle, type SoundToggleProps } from '@/components/player/SoundToggle';
import { useOverlay } from '@/components/shell/OverlayManager';
import type { CaptionButton } from '@/lib/engine/captionPhase';
import home from './home.module.css';
import styles from './live.module.css';

export const MORE_ACTIONS_ID = 'O-MORE-ACTIONS';

export interface ActionRowProps {
  /** `broadcast` — головна (ефір); `remote` — сторінка країни. */
  mode?: 'broadcast' | 'remote';
  /** Кнопка з фази підпису: «Обрати трансляцію ›», «Лишитися тут ›» або (пульт) «Подивитися північ ще раз». */
  button: CaptionButton;
  /** Сторінка країни поточної події. */
  href: string | null;
  sound: SoundToggleProps;
  /** «Лишитися тут ›»: запам’ятати подію перед переходом (BroadcastController.stayHere). */
  onStayHere?: () => void;
  /** Пульт: «Ще трансляції» / «Записи». */
  onMoreStreams?: () => void;
  /** Пульт: після півночі кнопка називається «Записи». */
  recordings?: boolean;
  /** Пульт: «Подивитися північ ще раз» (повтор із `source.replay`). */
  onWatchAgain?: () => void;
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

export function ActionRow({
  mode = 'broadcast',
  button,
  href,
  sound,
  onStayHere,
  onMoreStreams,
  recordings = false,
  onWatchAgain,
  className,
}: ActionRowProps) {
  const t = useTranslations('player');
  const tc = useTranslations('country.actions');
  const overlay = useOverlay();
  const remote = mode === 'remote';
  const stay = button === 'stay-here';
  const label = stay ? t('stayHere') : t('chooseStream');

  const openMore = () =>
    overlay.open({ id: MORE_ACTIONS_ID, kind: 'nonmodal', title: t('moreActions'), content: <MoreActions /> });

  return (
    <div data-action-row="" className={cn(home.actions, className)}>
      <SoundToggle {...sound} />
      {remote ? (
        <>
          <Button variant="secondary" data-action="more-streams" onClick={onMoreStreams} className="min-w-0">
            {recordings ? tc('recordings') : tc('moreStreams')}
          </Button>
          {button === 'watch-again' ? (
            <Button variant="secondary" iconLeft="play" data-action="watch-again" onClick={onWatchAgain}>
              {t('watchMidnightAgain')}
            </Button>
          ) : null}
        </>
      ) : href ? (
        <Button asChild variant="secondary" className={cn('min-w-0', home.choose)}>
          <NextLink href={href} onClick={stay ? onStayHere : undefined} data-action={button}>
            {label}
            <Icon name="chevron-right" size={16} strokeWidth={2} />
          </NextLink>
        </Button>
      ) : null}
      <span className="flex-1" />
      <span className={cn(styles.deskOnly, 'flex-wrap gap-2')}>
        <Button asChild variant="tonal" className={home.tonal}>
          <NextLink href="/room/" data-action="room">
            <Icon name="grid4" size={18} className={home.accentIcon} />
            {t('roomOpen')}
          </NextLink>
        </Button>
        <Button asChild variant="tonal" className={home.tonal}>
          <NextLink href="/tv/" data-action="party-mode">
            <Icon name="monitor" size={18} className={home.accentIcon} />
            {t('partyMode')}
          </NextLink>
        </Button>
      </span>
      <span className={styles.phoneOnly}>
        <button
          type="button"
          aria-label={t('moreActions')}
          aria-haspopup="dialog"
          aria-expanded={overlay.current?.id === MORE_ACTIONS_ID}
          onClick={openMore}
          className={cn('t2f-focus t2f-transition', home.more)}
        >
          <Icon name="more" size={20} />
        </button>
      </span>
    </div>
  );
}
