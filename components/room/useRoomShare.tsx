'use client';

/**
 * «Поділитися кімнатою» (як «Поділитися штампом») і «⋯» (ще дії, скарга). Виокремлено з `RoomLive.tsx` (WP-F).
 */
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import {
  MORE_ACTIONS_ID,
  MoreActionsDesk,
  MoreActionsList,
  REPORT_ID,
  ReportProblem,
  type ShareTarget,
} from '@/components/live/MoreActions';
import { useChatColumn, useOverlay } from '@/components/shell/OverlayManager';
import { ShareContent } from '@/components/stamp/Share';
import { SITE_HOST } from '@/lib/config/site';
import type { Dataset, GuestRoomWindow } from '@/lib/data/types';
import { formatClock } from '@/lib/i18n/time';
import { cityOf } from '@/lib/live/cityOf';
import { roomShareSvg } from '@/lib/room/shareRoomImage';
import { roomShareUrl } from './roomShare';

const SHARE_ID = 'O-ROOM-SHARE';

export function useRoomShare({
  windows,
  data,
  titleOf,
}: {
  windows: readonly GuestRoomWindow[];
  data: Dataset;
  titleOf: (w: Pick<GuestRoomWindow, 'eventId' | 'sourceId'>) => string;
}) {
  const tShare = useTranslations('room.share');
  const tPlayer = useTranslations('player');
  const overlay = useOverlay();
  const chatColumn = useChatColumn();

  // ── Поділитися кімнатою (як «Поділитися штампом») ──
  const openShare = useCallback(() => {
    const cells = windows.map((w) => {
      const ev = data.eventsById.get(w.eventId);
      return { city: cityOf(titleOf(w)), time: ev ? formatClock(ev.midnightMs) : '' };
    });
    const url = roomShareUrl(windows);
    overlay.open({
      id: SHARE_ID,
      kind: 'form',
      title: tShare('title'),
      description: tShare('sub'),
      content: (
        <ShareContent
          data={{ place: cells.map((c) => c.city).join(' · '), time: '', url }}
          svgFor={(ratio) =>
            roomShareSvg(ratio, cells, {
              eyebrow: tShare('eyebrow'),
              title: tShare('cardTitle', { count: cells.length }),
              caption: tShare('caption'),
              brand: 'Time2Fest',
            })
          }
          previewAlt={tShare('previewAlt', { places: cells.map((c) => c.city).join(', ') })}
          shareText={tShare('text', { count: cells.length })}
          fileStem="time2fest-room"
        />
      ),
    });
  }, [windows, data, titleOf, overlay, tShare]);

  // ── ⋯ ──
  const shareTarget: ShareTarget = {
    url: roomShareUrl(windows),
    shortUrl: `${SITE_HOST}/room/`,
    text: tShare('text', { count: windows.length }),
  };
  const openReport = () =>
    overlay.open({
      id: REPORT_ID,
      kind: 'accent',
      chrome: 'board',
      title: tPlayer('more.reportTitle'),
      onBack: openMore,
      content: (
        <div className="px-4 pb-4 pt-2">
          <ReportProblem center onClose={() => overlay.close(REPORT_ID)} />
        </div>
      ),
    });
  function openMore() {
    overlay.open({
      id: MORE_ACTIONS_ID,
      kind: 'accent',
      chrome: 'board',
      title: tPlayer('moreActions'),
      content: chatColumn ? (
        <MoreActionsDesk target={shareTarget} />
      ) : (
        <MoreActionsList target={shareTarget} onReport={openReport} />
      ),
    });
  }
  const toggleMore = () =>
    overlay.current?.id === MORE_ACTIONS_ID ? overlay.close(MORE_ACTIONS_ID) : openMore();

  return { openShare, toggleMore };
}
