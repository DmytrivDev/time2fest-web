'use client';

/**
 * Рядок дій під підписом плеєра (C1 ActionRow, режим `broadcast`):
 * [SoundToggle] [«Обрати трансляцію ›» / «Лишитися тут ›»] + десктоп — tonal «Кімната перегляду», «Режим вечірки», «⋯»;
 * телефон і планшет — «⋯» праворуч (дошка `Desk-ActionRow`, рішення 2026-11-01):
 * - «Обрати трансляцію» відкриває на місці чату / шторкою список трансляцій цієї півночі, що йдуть зараз (`StreamPicker`);
 * - «⋯» — «Ще дії» на місці чату / шторкою без затемнення сайту (`MoreActions`): поділитися й повідомити про проблему.
 * «Лишитися тут ›» — клієнтський перехід у межах `(live)`: макет і плеєр не перемонтовуються (SC-003).
 *
 * Режим `remote` (сторінка країни, пульт) — як на головній (рішення 2026-11-05): «Обрати трансляцію ›» відкриває той самий
 * список (`StreamPicker`), але з трансляціями країни й поясу в будь-якому стані, вибір — через сторінку (`streams.onPick`);
 * «Подивитися північ ще раз» — лише коли джерело дає повтор; «Кімната перегляду», «Режим вечірки», «⋯» — ті самі.
 * Перемикач «Відео | Відлік» (рішення 2026-11-05, дошка `Desk-Country-Full`): режим «Відлік» — сцена Time2Fest на місці
 * відео (точна північ без затримки), «Обрати трансляцію» тоді неактивна; телефон — двома іконками. Без трансляцій
 * сторінка перемикача не передає (режим «Відлік» сам).
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { ToggleGroup } from 'radix-ui';
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
import type { StreamRowData } from '@/lib/live/countryData';
import home from './home.module.css';
import nn from './nowNext.module.css';
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
  /** Пульт: трансляції країни й поясу для «Обрати трансляцію» і що робити з вибраною. */
  streams?: RemoteStreams;
  /** Пульт: «Відео | Відлік». */
  countdownMode?: CountdownModeControl;
  /** Пульт: місце для тексту «Поділитися» («Париж · Ейфелева вежа»). */
  sharePlace?: string;
  /** Пульт: «Подивитися північ ще раз» (повтор із `source.replay`). */
  onWatchAgain?: () => void;
  className?: string;
}

export interface CountdownModeControl {
  /** Увімкнено режим «Відлік». */
  countdown: boolean;
  onChange(countdown: boolean): void;
}

/** «Відео | Відлік» — той самий вигляд, що фільтр «Зараз і далі»; на телефоні — лише іконки (підпис — для зчитувача). */
function ModeToggle({ mode }: { mode: CountdownModeControl }) {
  const t = useTranslations('country.mode');
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={t('label')}
      value={mode.countdown ? 'countdown' : 'video'}
      onValueChange={(v) => {
        if (v) mode.onChange(v === 'countdown');
      }}
      data-row="mode"
      className={cn(nn.filter, 'shrink-0')}
    >
      <ToggleGroup.Item value="video" aria-label={t('video')} className={cn('t2f-focus', nn.seg)}>
        <Icon name="tv" size={16} />
        <span className={styles.deskOnly}>{t('video')}</span>
      </ToggleGroup.Item>
      <ToggleGroup.Item value="countdown" aria-label={t('countdown')} className={cn('t2f-focus', nn.seg)}>
        <Icon name="clock" size={16} />
        <span className={styles.deskOnly}>{t('countdown')}</span>
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  );
}

export interface RemoteStreams {
  rows: readonly StreamRowData[];
  countryIso: string;
  midnightMs: number;
  onPick(row: StreamRowData): void;
  /** «+» у списку — у кімнату перегляду. */
  onAddToRoom?(row: StreamRowData): void;
}

export function ActionRow({
  mode = 'broadcast',
  button,
  href,
  sound,
  onStayHere,
  streams,
  countdownMode,
  sharePlace,
  onWatchAgain,
  hideSound = false,
  className,
}: ActionRowProps) {
  const t = useTranslations('player');
  const overlay = useOverlay();
  const remote = mode === 'remote';
  const stay = button === 'stay-here';
  const label = stay ? t('stayHere') : t('chooseStream');

  const column = useChatColumn();
  const broadcast = useOptionalBroadcast();
  const midnightMs = remote ? (streams?.midnightMs ?? null) : (broadcast?.current?.event.midnightMs ?? null);
  const place = remote ? (sharePlace ?? '') : (broadcast?.current?.city?.name.uk ?? '');
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
      content:
        remote && streams ? (
          <StreamPicker
            midnightMs={midnightMs}
            countryIso={streams.countryIso}
            rows={streams.rows}
            onPick={streams.onPick}
            onAddToRoom={streams.onAddToRoom}
            onPicked={column ? undefined : () => overlay.close(STREAM_PICKER_ID)}
          />
        ) : (
          <StreamPicker midnightMs={midnightMs} countryIso={broadcast?.current?.event.countryIso} onPicked={column ? undefined : () => overlay.close(STREAM_PICKER_ID)} />
        ),
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
          <ReportProblem center onClose={() => overlay.close(REPORT_ID)} />
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
      content: column ? <MoreActionsDesk target={target} /> : <MoreActionsList target={target} onReport={openReport} />,
    });
  }
  const moreOpen = overlay.current?.id === MORE_ACTIONS_ID || overlay.current?.id === REPORT_ID;
  // Повторний натиск «⋯» закриває «Ще дії» (правка власника 2026-11-05).
  const toggleMore = () => (moreOpen ? overlay.close(overlay.current!.id) : openMore());

  return (
    <div data-action-row="" className={cn(home.actions, remote && home.actionsRemote, className)}>
      {hideSound ? null : <SoundToggle {...sound} />}
      {remote ? (
        <>
          {streams && streams.rows.length > 0 ? (
            <Button
              variant="secondary"
              aria-haspopup="dialog"
              aria-expanded={overlay.current?.id === STREAM_PICKER_ID}
              data-action="choose-stream"
              disabled={!!countdownMode?.countdown}
              onClick={openPicker}
              className={cn('min-w-0', home.choose)}
            >
              {t('chooseStream')}
              <Icon name="chevron-right" size={16} strokeWidth={2} />
            </Button>
          ) : null}
          {countdownMode ? <ModeToggle mode={countdownMode} /> : null}
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
        <IconButton
          icon="more"
          variant="ring"
          aria-label={t('moreActions')}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          data-action="more-actions"
          onClick={toggleMore}
        />
      </span>
      <span className={styles.phoneOnly}>
        <button
          type="button"
          aria-label={t('moreActions')}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={toggleMore}
          className={cn('t2f-focus t2f-transition', home.more)}
        >
          <Icon name="more" size={20} />
        </button>
      </span>
    </div>
  );
}
