'use client';

/** Головне вікно кімнати: обрана трансляція ще не почалась — заглушка «Трансляція очікується» (2026-11-11). */
import { WaitingScene } from '@/components/player/CountdownScene';
import { useLiveData } from '@/lib/api/hooks/live';
import { useOptionalPlayer } from '@/lib/player/PlayerProvider';

export function MainWaiting() {
  const player = useOptionalPlayer();
  const liveData = useLiveData();
  const sel = player?.selection;
  if (!sel || sel.kind !== 'waiting' || !player.eventId) return null;
  const data = liveData;
  const country = data.countriesByIso.get(data.eventsById.get(player.eventId)?.countryIso ?? '');
  const src = data.chainsByEventId.get(player.eventId)?.sources.find((s) => s.id === sel.source.id);
  if (!country || !src?.startsAt) return null;
  return <WaitingScene compact country={country} waitingFor={{ title: src.title.uk, startsAt: Date.parse(src.startsAt) }} className="aspect-video" />;
}
