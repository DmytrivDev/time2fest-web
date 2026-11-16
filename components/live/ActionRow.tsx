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
 * Відкриття списку — `useStreamPicker` (рішення власника 2026-11-13): ним же кнопка «Дивитися, що вже йде» на заглушці
 * головного святкування відкриває той самий список (головна — ефір, сторінка країни — пульт); вибір там — ручний, як тут.
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef } from 'react';
import { ToggleGroup } from 'radix-ui';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { SoundToggle, type SoundToggleProps } from '@/components/player/SoundToggle';
import { IconButton } from '@/components/primitives/IconButton';
import { useChatColumn, useOverlay, usePartyHref } from '@/components/shell/OverlayManager';
import { useStreamChains } from '@/lib/api/hooks/live';
import { SITE_HOST } from '@/lib/config/site';
import { useOptionalBroadcast } from '@/lib/player/BroadcastController';
import { MORE_ACTIONS_ID, MoreActionsDesk, MoreActionsList, REPORT_ID, ReportProblem, type ShareTarget } from './MoreActions';
import { STREAM_PICKER_ID, StreamPicker } from './StreamPicker';
import { useShareStream } from './useShareStream';
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
  /** Календарик у «Обрати трансляцію» — «Додати в графік». */
  onToggleSchedule?: (eventId: string) => void;
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

export interface StreamPickerOptions {
  /** `broadcast` — головна (ефір); `remote` — сторінка країни. */
  mode?: 'broadcast' | 'remote';
  streams?: RemoteStreams;
  onToggleSchedule?: (eventId: string) => void;
}

/**
 * «Обрати трансляцію»: список трансляцій цієї півночі (`StreamPicker`) на місці чату (десктоп) чи шторкою (телефон).
 * Ефір: обрана в списку трансляція — вибір людини до наступної передачі ефіру (як на ТВ), щоб сторінка знала, що людина
 * дивиться не головне святкування («Головне святкування почалось · Перемкнути»). Пульт: вибір — через `streams.onPick`.
 */
export function useStreamPicker({ mode = 'broadcast', streams, onToggleSchedule }: StreamPickerOptions): { open: () => void; isOpen: boolean } {
  const t = useTranslations('player');
  const overlay = useOverlay();
  const column = useChatColumn();
  const broadcast = useOptionalBroadcast();
  const chains = useStreamChains();
  const remote = mode === 'remote';
  const midnightMs = remote ? (streams?.midnightMs ?? null) : (broadcast?.current?.event.midnightMs ?? null);
  // Список живе у вікні поза контекстом ефіру — беремо найсвіжіший стан ефіру з посилання.
  const broadcastRef = useRef(broadcast);
  useEffect(() => {
    broadcastRef.current = broadcast;
  });
  const pickOnAir = useCallback((row: StreamRowData) => {
    const b = broadcastRef.current;
    if (!b) return;
    const air = b.current?.event.id;
    const main = air ? chains.get(air)?.sources.find((x) => x.kind === 'main') : undefined;
    b.watch(row.eventId === air && row.id === main?.id ? null : { eventId: row.eventId, sourceId: row.id });
  }, [chains]);
  const open = () => {
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
            onToggleSchedule={onToggleSchedule}
            onPicked={column ? undefined : () => overlay.close(STREAM_PICKER_ID)}
          />
        ) : (
          <StreamPicker
            midnightMs={midnightMs}
            countryIso={broadcast?.current?.event.countryIso}
            onPick={broadcast?.controlling ? pickOnAir : undefined}
            onToggleSchedule={onToggleSchedule}
            onPicked={column ? undefined : () => overlay.close(STREAM_PICKER_ID)}
          />
        ),
    });
  };
  return { open, isOpen: overlay.current?.id === STREAM_PICKER_ID };
}

export function ActionRow({
  mode = 'broadcast',
  button,
  href,
  sound,
  onStayHere,
  streams,
  onToggleSchedule,
  countdownMode,
  sharePlace,
  onWatchAgain,
  hideSound = false,
  className,
}: ActionRowProps) {
  const t = useTranslations('player');
  const overlay = useOverlay();
  // «Режим вечірки»: телефон і планшет-портрет — `/tv-info/` (2026-11-10).
  const partyHref = usePartyHref();
  const remote = mode === 'remote';
  const stay = button === 'stay-here';
  const label = stay ? t('stayHere') : t('chooseStream');

  const column = useChatColumn();
  const broadcast = useOptionalBroadcast();
  const midnightMs = remote ? (streams?.midnightMs ?? null) : (broadcast?.current?.event.midnightMs ?? null);
  const picker = useStreamPicker({ mode, streams, onToggleSchedule });
  const place = remote ? (sharePlace ?? '') : (broadcast?.current?.city?.name.uk ?? '');
  const target: ShareTarget = {
    url: `${typeof window !== 'undefined' ? window.location.origin : `https://${SITE_HOST}`}${href ?? '/'}`,
    shortUrl: `${SITE_HOST}${href ?? '/'}`,
    text: t('more.shareText', { place }),
  };

  const share = useShareStream({ href, place });
  const openPicker = picker.open;
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
          <NextLink href={partyHref} data-action="party-mode">
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
      <span className={cn(styles.phoneOnly, 'inline-flex items-center gap-2')}>
        {/* Телефон, головна: кружечок «Поділитися» поруч із «⋯», як у кімнаті (п. 16, Т15). Сторінка країни й колонка чату —
            іконка в підписі (`Caption`). */}
        {remote || column ? null : (
          <IconButton icon="share" variant="ring" aria-label={t('shareStream')} data-action="share-stream" onClick={share} />
        )}
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
