'use client';

/**
 * «Поділитися листівкою» (після півночі, дошка `Desk-FR-After-C`): те саме вікно O-SHARE, що й для штампа (на десктопі —
 * на місці чату, на телефоні — шторка), але картинка — листівка ряду: місто, «З Новим 2027 роком!», привітання
 * (своє, якщо ти в ряду, інакше — те, що на екрані) і всі імена з прапорами. Посилання — сторінка країни.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { emojiSymbol } from '@/components/live/SeatPill';
import { useOverlay } from '@/components/shell/OverlayManager';
import { SHARE_WINDOW_ID, ShareContent } from '@/components/windows/Share';
import { getData } from '@/lib/data/load';
import type { FirstRowSeat, Ms, SeatParticipant } from '@/lib/data/types';
import { formatClock } from '@/lib/i18n/time';
import { loadEmojiIcons, loadRoundFlags, postcardSvg, type PostcardPerson } from '@/lib/firstrow/postcardImage';
import type { ShareRatio } from '@/lib/offers/shareImage';
import { newYearOf, postcardOrder } from './FirstRowPostcard';

export interface PostcardShareProps {
  city: string;
  countryIso: string;
  midnightMs: Ms;
  seats: readonly FirstRowSeat[];
  featured?: SeatParticipant;
}

export function PostcardShare({ city, countryIso, midnightMs, seats, featured }: PostcardShareProps) {
  const t = useTranslations('firstRow');
  const tp = useTranslations('firstRow.postcard');
  const order = postcardOrder(seats);
  const people: PostcardPerson[] = order.map((s) => ({ name: s.participant.name, flagCode: s.participant.flagCode, emoji: emojiSymbol(s.participant.emojiId) }));
  const [flags, setFlags] = useState<Record<string, string>>({});
  const codes = people.map((p) => p.flagCode).join(',');
  const emojis = people.map((p) => p.emoji).join(',');
  useEffect(() => {
    let alive = true;
    void Promise.all([loadRoundFlags(codes.split(',').filter(Boolean)), loadEmojiIcons(emojis.split(','))]).then(([f, e]) => {
      if (alive) setFlags({ ...f, ...e });
    });
    return () => {
      alive = false;
    };
  }, [codes, emojis]);

  const year = newYearOf(midnightMs);
  const greeting = featured?.greeting.trim() ?? '';
  const author = featured ? { name: featured.name, flagCode: featured.flagCode, emoji: emojiSymbol(featured.emojiId) } : undefined;
  const text = {
    kicker: t('heading', { city }).toLocaleUpperCase('uk'),
    title: tp('title', { year }),
    greeting,
    author,
    people,
    brand: 'Time2Fest · time2fest.com',
  };
  const svgFor = (ratio: ShareRatio) => postcardSvg(ratio, text, flags);

  const country = getData().countriesByIso.get(countryIso);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <ShareContent
      data={{ place: city, time: formatClock(midnightMs), url: `${origin}${country ? `/country/${country.slug}/` : '/'}` }}
      svgFor={svgFor}
      shareText={tp('shareText', { year, city })}
      previewAlt={tp('previewAlt', { city, greeting: greeting || tp('noGreeting') })}
      fileStem="time2fest-first-row"
    />
  );
}

/** Відкрити «Поділитися листівкою» для події. */
export function useSharePostcard(event: { id: string; midnightMs: Ms }, city: string, seats: readonly FirstRowSeat[]) {
  const overlay = useOverlay();
  const tp = useTranslations('firstRow.postcard');
  return useCallback(
    (featured: SeatParticipant | undefined) => {
      const countryIso = getData().eventsById.get(event.id)?.countryIso ?? '';
      overlay.open({
        id: SHARE_WINDOW_ID,
        kind: 'form',
        title: tp('share'),
        content: <PostcardShare city={city} countryIso={countryIso} midnightMs={event.midnightMs} seats={seats} featured={featured} />,
      });
    },
    [overlay, tp, city, event.id, event.midnightMs, seats],
  );
}
