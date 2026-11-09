'use client';

/**
 * Дотик до фішки учасника на стіні «Першого ряду» відкриває його картку — ту саму, що з ніка в чаті (O-AUTHOR):
 * прапор, ім’я, позначки й шлях по поясах (рішення власника 2026-10-31; до півночі, опівночі й після).
 * Учасник зі сценарію чату (ім’я на стіні починається з його ніка) — зі своїм шляхом; решта — без шляху.
 */
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { AuthorPanel } from '@/components/live/AuthorPanel';
import { useGetPass, usePassDetails } from '@/components/pass/PassWindow';
import { useOverlay } from '@/components/shell/OverlayManager';
import { useChatLookup } from '@/components/chat/useChatLookup';
import { buildAuthorPath, buildOwnPath } from '@/lib/chat-sim/authorPath';
import { CHAT_SCRIPT } from '@/lib/chat-sim/useChatSimulator';
import { getData } from '@/lib/data/load';
import type { Author, SeatParticipant } from '@/lib/data/types';
import { useClock } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';

/** Те саме вікно, що й з чату (`ChatPanel` → `AUTHOR_WINDOW_ID`). */
const AUTHOR_WINDOW_ID = 'O-AUTHOR';

/** Учасник стіни → автор картки: зі сценарію чату, якщо ім’я на стіні починається з ніка автора. */
export function participantAuthor(p: Pick<SeatParticipant, 'holderId' | 'name' | 'flagCode' | 'emojiId' | 'isMine'>): Author {
  const scripted = CHAT_SCRIPT.authors.find((a) => p.name === a.nick || p.name.startsWith(`${a.nick} `));
  const badges = new Set<Author['badges'][number]>(['first-row', ...((scripted?.badges ?? []) as Author['badges'])]);
  return {
    id: scripted?.id ?? p.holderId,
    nick: p.name,
    flagCode: p.flagCode,
    badges: [...badges],
    firstRowEmojiId: p.emojiId,
    ...(p.isMine ? { isMine: true } : {}),
  };
}

export function useOpenParticipant() {
  const overlay = useOverlay();
  const clock = useClock();
  const lookup = useChatLookup();
  const getPass = useGetPass();
  const passDetails = usePassDetails();
  const tRow = useTranslations('firstRow');
  return useCallback(
    (p: Pick<SeatParticipant, 'holderId' | 'name' | 'flagCode' | 'emojiId' | 'isMine'>) => {
      const author = participantAuthor(p);
      const guest = useGuestStore.getState();
      const path = author.isMine
        ? buildOwnPath(guest.stamps, guest.schedule, getData(), clock.getSnapshot())
        : buildAuthorPath(author, CHAT_SCRIPT, getData(), clock.getSnapshot());
      const viewerHasPass = guest.hasPass;
      overlay.open({
        id: AUTHOR_WINDOW_ID,
        inChat: true,
        kind: 'nonmodal',
        chrome: 'author',
        coral: !viewerHasPass,
        title: tRow('participantTitle'),
        content: (
          <AuthorPanel
            author={author}
            countryName={lookup.countryName?.(author.flagCode)}
            hasPass
            routeHidden={!author.isMine && !!CHAT_SCRIPT.authors.find((x) => x.id === author.id)?.pathHidden}
            path={path}
            viewerHasPass={viewerHasPass}
            onGetPass={() => getPass()}
            onPassInfo={passDetails}
          />
        ),
      });
    },
    [overlay, clock, lookup, getPass, passDetails, tRow],
  );
}
