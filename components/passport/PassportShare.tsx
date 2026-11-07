'use client';

/**
 * «Поділитися шляхом» і «Поділитися паспортом» (функції пасу, рішення власника 2026-11-07): те саме вікно O-SHARE, що й
 * «Поділитися штампом» чи листівкою «Першого ряду» (9:16 / 1:1, «Поділитися…», WhatsApp, посилання, зображення), але з
 * картинкою «Мої Нові роки» (`summarySvg`) чи паспорта (`passportSvg`). Геометрію мапи й круглі прапори вантажимо, коли
 * вікно відкрите.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import type { ZoneMapGeometry } from '@/components/live/MapModel';
import { useOverlay } from '@/components/shell/OverlayManager';
import { SHARE_WINDOW_ID, ShareContent } from '@/components/windows/Share';
import type { PathPoint } from '@/lib/chat-sim/authorPath';
import { loadRoundFlags } from '@/lib/firstrow/postcardImage';
import type { ShareRatio } from '@/lib/offers/shareImage';
import { passportSvg, summarySvg, type SummaryText } from '@/lib/passport/summaryImage';
import type { PassportStamp } from '@/lib/passport/passport';

export interface ShareSummary {
  name: string;
  stats: SummaryText['stats'];
  route: string;
  rows: readonly PassportStamp[];
  points: readonly PathPoint[];
  zoneStates: Readonly<Record<string, 'past' | 'live' | 'next' | 'future'>>;
}

function useFlags(codes: readonly string[]): Record<string, string> {
  const [flags, setFlags] = useState<Record<string, string>>({});
  const key = codes.join(',');
  useEffect(() => {
    let alive = true;
    void loadRoundFlags(key.split(',').filter(Boolean)).then((f) => {
      if (alive) setFlags(f);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return flags;
}

function useGeometry(): ZoneMapGeometry | null {
  const [geo, setGeo] = useState<ZoneMapGeometry | null>(null);
  useEffect(() => {
    let alive = true;
    import('@/data/zonemap.json')
      .then((m) => {
        if (alive) setGeo(m.default as unknown as ZoneMapGeometry);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return geo;
}

function RouteShare({ data }: { data: ShareSummary }) {
  const t = useTranslations('passport.card');
  const codes = [...new Set(data.rows.map((r) => r.flagCode))];
  const flags = useFlags(codes);
  const geometry = useGeometry();
  const text: SummaryText = { kicker: t('kicker'), name: data.name, stats: data.stats, route: data.route, brand: 'Time2Fest · time2fest.com' };
  const map = geometry
    ? { geometry, zoneStates: data.zoneStates, visited: data.rows.map((r) => ({ zoneId: r.zoneId, iso: r.countryIso })), points: data.points }
    : null;
  const svgFor = (ratio: ShareRatio) => summarySvg(ratio, text, map, codes, flags);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <ShareContent
      data={{ place: data.route, time: '', url: `${origin}/` }}
      svgFor={svgFor}
      shareText={t('shareText', { countries: data.stats[1]?.value ?? '', continents: data.stats[2]?.value ?? '' })}
      previewAlt={t('previewAlt', { route: data.route })}
      fileStem="time2fest-my-new-years"
    />
  );
}

function PassportCardShare({ data }: { data: ShareSummary }) {
  const t = useTranslations('passport.card');
  const codes = [...new Set(data.rows.map((r) => r.flagCode))];
  const flags = useFlags(codes);
  const text: SummaryText = { kicker: t('passportKicker'), name: data.name, stats: data.stats, route: data.route, brand: 'Time2Fest · time2fest.com' };
  const stamps = data.rows.map((r) => ({ city: r.city, country: r.country, flagCode: r.flagCode, ...(r.seat ? { seat: r.seat } : {}) }));
  const svgFor = (ratio: ShareRatio) => passportSvg(ratio, text, stamps, flags);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <ShareContent
      data={{ place: data.route, time: '', url: `${origin}/` }}
      svgFor={svgFor}
      shareText={t('shareText', { countries: data.stats[1]?.value ?? '', continents: data.stats[2]?.value ?? '' })}
      previewAlt={t('previewAltPassport', { cities: data.rows.map((r) => r.city).join(', ') })}
      fileStem="time2fest-passport"
    />
  );
}

/** Відкрити «Поділитися шляхом» / «Поділитися паспортом» на місці чату (телефон — шторкою). */
export function usePassportShare() {
  const overlay = useOverlay();
  const t = useTranslations('passport.card');
  return useCallback(
    (kind: 'route' | 'passport', data: ShareSummary) =>
      overlay.open({
        id: SHARE_WINDOW_ID,
        kind: 'form',
        title: kind === 'route' ? t('routeTitle') : t('passportTitle'),
        content: kind === 'route' ? <RouteShare data={data} /> : <PassportCardShare data={data} />,
      }),
    [overlay, t],
  );
}
