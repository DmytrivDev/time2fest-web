'use client';

/**
 * Рядок дій під підписом плеєра (C1 ActionRow, режим `broadcast`):
 * [SoundToggle] [«Обрати трансляцію ›» / «Лишитися тут ›»] + десктоп — tonal «Кімната перегляду», «Режим вечірки», «⋯»;
 * телефон і планшет — «⋯» праворуч (дошка `Desk-ActionRow`, рішення 2026-11-01):
 * - «Обрати трансляцію» відкриває на місці чату / шторкою список трансляцій цієї півночі, що йдуть зараз (`StreamPicker`);
 * - «⋯» — «Ще дії» на місці чату / шторкою без затемнення сайту (`MoreActions`): поділитися й повідомити про проблему.
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
import { IconButton } from '@/components/primitives/IconButton';
import { useChatColumn, useOverlay } from '@/components/shell/OverlayManager';
import { SITE_HOST } from '@/lib/config/site';
import { useOptionalBroadcast } from '@/lib/player/BroadcastController';
import { MORE_ACTIONS_ID, MoreActionsDesk, MoreActionsList, REPORT_ID, ReportProblem, type ShareTarget } from './MoreActions';
import { STREAM_PICKER_ID, StreamPicker } from './StreamPicker';
import type { CaptionButton } from '@/lib/engine/captionPhase';
import home from './home.module.css';
import styles from './live.module.css';

export { MORE_ACTIONS_ID };

export interface ActionRowProps {
  /** `broadcast` — головна (ефір); `remote` — сторінка країни. */
  mode?: 'broadcast' | 'remote';
  /** Кнопка з фази підпису: «Обрати трансляцію ›», «Лишитися тут ›» або (пульт) «Подивитися північ ще раз». */
  button: CaptionButton;
  /** Сторінка країни поточної події. */
  href: string | null;
  sound: SoundToggleProps;
  /** Телефон, головна: звук стоїть у липкому рядку над блоком (`PlayerBlock dock`). */
  hideSound?: boolean;
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

export function ActionRow({
  mode = 'broadcast',
  button,
  href,
  sound,
  onStayHere,
  onMoreStreams,
  recordings = false,
  onWatchAgain,
  hideSound = false,
  className,
}: ActionRowProps) {
  const t = useTranslations('player');
  const tc = useTranslations('country.actions');
  const overlay = useOverlay();
  const remote = mode === 'remote';
  const stay = button === 'stay-here';
  const label = stay ? t('stayHere') : t('chooseStream');

  const column = useChatColumn();
  const broadcast = useOptionalBroadcast();
  const midnightMs = broadcast?.current?.event.midnightMs ?? null;
  const place = broadcast?.current?.city?.name.uk ?? '';
  const target: ShareTarget = {
    url: `${typeof window !== 'undefined' ? window.location.origin : `https://${SITE_HOST}`}${href ?? '/'}`,
    shortUrl: `${SITE_HOST}${href ?? '/'}`,
    text: t('more.shareText', { place }),
  };

  function openPicker() {
    if (midnightMs === null) return;
    overlay.open({
      id: STREAM_PICKER_ID,
      kind: 'accent',
      chrome: 'board',
      title: t('chooseStream'),
      description: t('picker.sub'),
      content: <StreamPicker midnightMs={midnightMs} onPicked={column ? undefined : () => overlay.close(STREAM_PICKER_ID)} />,
    });
  }
  function openReport() {
    overlay.open({
      id: REPORT_ID,
      kind: 'accent',
      chrome: 'board',
      title: t('more.reportTitle'),
      onBack: openMore,
      content: (
        <div className="px-4 pb-4 pt-2">
          <ReportProblem center onChooseStream={openPicker} onClose={() => overlay.close(REPORT_ID)} />
        </div>
      ),
    });
  }
  function openMore() {
    overlay.open({
      id: MORE_ACTIONS_ID,
      kind: 'accent',
      chrome: 'board',
      title: t('moreActions'),
      description: column ? place : undefined,
      content: column ? <MoreActionsDesk target={target} onChooseStream={openPicker} /> : <MoreActionsList target={target} onReport={openReport} />,
    });
  }
  const moreOpen = overlay.current?.id === MORE_ACTIONS_ID || overlay.current?.id === REPORT_ID;

  return (
    <div data-action-row="" className={cn(home.actions, className)}>
      {hideSound ? null : <SoundToggle {...sound} />}
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
      ) : stay && href ? (
        <Button asChild variant="secondary" className={cn('min-w-0', home.choose)}>
          <NextLink href={href} onClick={onStayHere} data-action={button}>
            {label}
            <Icon name="chevron-right" size={16} strokeWidth={2} />
          </NextLink>
        </Button>
      ) : href || midnightMs !== null ? (
        <Button
          variant="secondary"
          aria-haspopup="dialog"
          aria-expanded={overlay.current?.id === STREAM_PICKER_ID}
          data-action={button}
          onClick={openPicker}
          className={cn('min-w-0', home.choose)}
        >
          {label}
          <Icon name="chevron-right" size={16} strokeWidth={2} />
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
        {remote ? null : (
          <IconButton
            icon="more"
            variant="ring"
            aria-label={t('moreActions')}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            data-action="more-actions"
            onClick={openMore}
          />
        )}
      </span>
      <span className={styles.phoneOnly}>
        <button
          type="button"
          aria-label={t('moreActions')}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={openMore}
          className={cn('t2f-focus t2f-transition', home.more)}
        >
          <Icon name="more" size={20} />
        </button>
      </span>
    </div>
  );
}
