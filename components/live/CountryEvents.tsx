'use client';

/**
 * Блоки під плеєром сторінки країни: «Трансляції · <Країна>», «Ще о … · інші країни поясу» (або «Зараз і далі»),
 * «Як святкувати», «Питання й відповіді». Виокремлено з `CountryLive.tsx` (WP-F).
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { EventFilterValue } from '@/components/live/EventFilter';
import type { CountryZoneOption } from '@/components/live/CountryHeader';
import { Faq, type FaqItem } from '@/components/live/Faq';
import { HowToCard } from '@/components/live/HowToCard';
import { NowNext } from '@/components/live/NowNext';
import { StreamCards, type CountdownCountry } from '@/components/live/StreamCards';
import type { useOfferWindows } from '@/components/offers/useOfferWindows';
import { useGetPass } from '@/components/pass/PassWindow';
import { cn } from '@/components/primitives/cn';
import { Link } from '@/components/primitives/Link';
import { useTabletPortrait } from '@/components/shell/OverlayManager';
import { useSchedule } from '@/lib/api/hooks/auth';
import type { Country, Dataset, LoadedZone, Ms, ScheduledEvent } from '@/lib/data/types';
import { formatClock, viewerZoneLabel } from '@/lib/i18n/time';
import { festProgress, nowNextItems } from '@/lib/live/homeData';
import type { StreamRowData } from '@/lib/live/countryData';
import { utcLabel } from '@/lib/map/model';
import styles from './live.module.css';

const STREAMS_ID = 'country-streams';
const NOW_NEXT_ID = 'now-next';

interface Props {
  data: Dataset;
  country: Country;
  minute: Ms;
  chatColumn: boolean;
  mainEvent: ScheduledEvent | undefined;
  zoneId: string | null;
  zone: LoadedZone | undefined;
  zoneOptions: CountryZoneOption[] | undefined;
  recording: boolean;
  liveNow: boolean;
  countdown: boolean;
  countryRows: StreamRowData[];
  currentStreamId: string | null;
  currentRow: StreamRowData | null;
  select: (row: StreamRowData) => void;
  addToRoom: (row: StreamRowData) => void;
  nbRows: StreamRowData[];
  nbCountdown: CountdownCountry[];
  nbFilter: EventFilterValue;
  changeNbFilter: (next: EventFilterValue) => void;
  nbScheduleCount: number;
  zoneCountries: number;
  hasPass: boolean;
  passWindows: ReturnType<typeof useOfferWindows>;
  getPass: ReturnType<typeof useGetPass>;
}

export function CountryEvents({
  data, country, minute, chatColumn, mainEvent, zoneId, zone, zoneOptions, recording, liveNow, countdown, countryRows,
  currentStreamId, currentRow, select, addToRoom, nbRows, nbCountdown, nbFilter, changeNbFilter, nbScheduleCount,
  zoneCountries, hasPass, passWindows, getPass,
}: Props) {
  const tc = useTranslations('country');
  const tStreams = useTranslations('country.streams');
  // Планшет-портрет (`Tab-P-New`, 2026-11-10): «Зараз і далі» — сіткою карток, як на головній.
  const tabletPortrait = useTabletPortrait();
  const time = mainEvent ? formatClock(mainEvent.midnightMs) : '';
  const faqItems: FaqItem[] = (['when', 'stamp', 'switch', 'room'] as const).map((id) => ({
    id,
    question: tc(`faq.items.${id}.q`),
    answer: tc(`faq.items.${id}.a`, { time: mainEvent ? formatClock(mainEvent.midnightMs) : '' }),
  }));

  const schedule = useSchedule();
  // «Зараз і далі» — і до півночі, і після (правка власника 2026-11-05: на Азорських островах його не було).
  const nowNext = useMemo(() => nowNextItems(data, minute, schedule, { liveOthers: true, mainCards: true }), [data, minute, schedule]);
  const progress = useMemo(() => festProgress(data, minute), [data, minute]);
  const zoneLabel = viewerZoneLabel();

  return (
    <div className="flex flex-col gap-8 pb-8">
      <div className={cn(styles.pad, 'flex flex-col gap-9')}>
        <StreamCards
          id={STREAMS_ID}
          heading={
            zoneOptions && zone
              ? tStreams('cardsHeadingZone', {
                  country: country.name.uk,
                  zone: utcLabel(zone.offsetMinutes),
                })
              : tStreams('cardsHeading', { country: country.name.uk })
          }
          sub={recording ? tStreams('cardsSubAfter', { time }) : tStreams('cardsSub', { time })}
          rows={countryRows}
          currentStreamId={countdown ? null : currentStreamId}
          currentRow={currentRow}
          onSelect={select}
          onAddToRoom={addToRoom}
        />
        {liveNow ? (
          <StreamCards
            heading={tStreams('othersHeading', { time })}
            sub={tStreams('othersSub')}
            rows={nbRows}
            countdown={nbCountdown}
            filter={{ value: nbFilter, onChange: changeNbFilter, scheduleLocked: !hasPass, scheduleCount: nbScheduleCount }}
            phoneLimit={5}
            currentStreamId={countdown ? null : currentStreamId}
            currentRow={currentRow}
            onSelect={select}
            onAddToRoom={addToRoom}
            showCountry
            footer={
              <Link
                variant="chevron"
                href={`/countries/?zone=${encodeURIComponent(zoneId ?? '')}`}
                className="self-start"
              >
                {tStreams('othersAll', { count: zoneCountries })}
              </Link>
            }
          />
        ) : null}
      </div>
      {!liveNow && nowNext.length ? (
        <NowNext
          items={nowNext}
          zoneLabel={zoneLabel}
          layout={chatColumn ? 'carousel' : tabletPortrait ? 'grid' : 'stack'}
          progress={progress}
          mapHref={tabletPortrait ? '/countries/' : undefined}
          onToggleSchedule={passWindows.requestSchedule}
          scheduleLocked={!hasPass}
          onScheduleLocked={passWindows.openPassInfoBoard}
          onGetPass={() => getPass()}
          id={NOW_NEXT_ID}
          className={styles.pad}
        />
      ) : null}
      <HowToCard
        country={country.name.uk}
        traditions={country.howTo.traditions}
        gallery={country.howTo.gallery}
        text={country.howTo.text}
        variant="full"
        className={styles.pad}
      />
      <Faq items={faqItems} columns={2} className={styles.pad} />
    </div>
  );
}
