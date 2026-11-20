'use client';

/**
 * «Коли Новий рік прийде до тебе?»: вибір країни (і пояса, якщо їх кілька), твій номер серед 38 поясів, твоя північ,
 * скільки лишилось, стрічка поясів, «Додати в календар» і картка для сторіс 1080×1920. Країна за замовчуванням — з
 * часового поясу браузера в ніч свята (лише після гідратації; до того — нейтральні заглушки тієї ж розкладки).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import { useNow } from '@/lib/time/TimeProvider';
import { clock, dayMonth, utcLabel, viewerOffsetMinutes } from '@/lib/prefest/format';
import { downloadIcs } from '@/lib/prefest/ics';
import { around, timeLeft, type AfterPart, type BeforePart } from '@/lib/prefest/mine';
import { defaultCountry, STRIP_LANDMARKS, viewerZone, type PrefestCountry } from '@/lib/prefest/model';
import { renderStoryPng, STORY_H, STORY_W } from '@/lib/prefest/story';
import { nightHours, renderInvitePng } from '@/lib/prefest/invite';
import { roundFlagSrc } from '@/components/primitives/Flag';
import { drawScene } from './SceneCanvas';
import { CountryCombobox } from './CountryCombobox';
import { useClientReady, usePrefest } from './PrefestContext';
import { StoryCard } from './StoryCard';
import { InviteCard, inviteParams, useInviteTexts, type InviteVars } from './InviteCard';
import { ZoneStrip, type StripLandmark } from './ZoneStrip';
import { Bar } from '@/components/skeleton/parts';
import s from './prefest.module.css';
import m from './MyMidnight.module.css';

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function MyMidnight() {
  const t = useTranslations('prefest.mine');
  const { model, toast, site } = usePrefest();
  const ready = useClientReady();
  const now = useNow();
  const [picked, setPicked] = useState<{ iso: string; zoneId: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const total = model.zones.length;
  const fallback = ready ? defaultCountry(model, viewerZone(model, viewerOffsetMinutes(model.firstMidnightMs))) : null;
  const pickedCountry = picked ? model.countriesByIso.get(picked.iso) : undefined;
  const country: PrefestCountry | null = pickedCountry ?? fallback?.country ?? null;
  const zoneId = pickedCountry && picked ? picked.zoneId : (fallback?.zoneId ?? null);
  const zone = (zoneId ? model.zonesById.get(zoneId) : undefined) ?? (country ? model.zonesById.get(country.zones[0]?.zoneId ?? '') : undefined);
  const index = ready && zone ? zone.index : null;
  const n = index === null ? null : index + 1;
  const cityOfZone = country?.zones.find((z) => z.zoneId === zone?.id)?.city;
  const multi = (country?.zones.length ?? 0) > 1;

  const ordText = n === null ? '—' : t('ordinal', { n });
  const where: string | null = country
    ? multi && cityOfZone
      ? t('storyWhereCity', { country: country.name, city: cityOfZone })
      : t('storyWhere', { country: country.name })
    : null;

  // Передстартовий сайт: змінні картки «Запрошення на новорічну ніч» — усе від обраної країни й її пояса (правка власника
  // 2026-11-20): «Моя північ» і «Початок» (перша північ світу) — за місцевим часом цього пояса, з його містом; пояс
  // браузера лише обирає країну за замовчуванням.
  const inviteKey =
    site && ready && country && zone && n !== null
      ? [n, total, nightHours(model.firstMidnightMs, model.lastMidnightMs), country.name, country.flagCode, zone.id, cityOfZone ?? ''].join('|')
      : '';
  const inviteVars = useMemo<InviteVars | null>(() => {
    if (!inviteKey || !site || !country || !zone || n === null) return null;
    /** Мить `ms` як «місцевий час пояса», що форматується в UTC (пояси на кшталт +5:45 не мають назви IANA). */
    const local = (ms: number) => ms + zone.offsetMinutes * 60_000;
    return {
      n,
      total,
      hours: nightHours(model.firstMidnightMs, model.lastMidnightMs),
      country: { name: country.name, flagCode: country.flagCode },
      mineWhen: t('factMidnightValue', { date: dayMonth(local(zone.midnightMs), 'UTC'), time: clock(local(zone.midnightMs), 'UTC') }),
      start: {
        date: dayMonth(local(model.firstMidnightMs), 'UTC'),
        time: clock(local(model.firstMidnightMs), 'UTC'),
        // Місто пояса; у країни з одним поясом без міста — сама країна, у кількох — «UTC+5:45».
        city: cityOfZone ?? (country.main?.zoneId === zone.id ? country.main.city : undefined) ?? (multi ? utcLabel(zone.offsetMinutes) : country.name),
      },
    };
    // Ключ уже містить усе, від чого залежить картка.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteKey]);
  const inviteTexts = useInviteTexts(inviteVars);

  const left = ready && zone && now > 0 ? timeLeft(zone.midnightMs, now) : null;

  const landmarks: StripLandmark[] = STRIP_LANDMARKS.flatMap((l, i) => {
    const z = model.zonesById.get(l.zoneId);
    return z ? [{ city: model.label(l.city), index: z.index, time: ready ? clock(z.midnightMs) : null, optional: i % 2 === 0 }] : [];
  });

  const sentence = index === null ? null : around(model.celebrations, index, total);
  const beforeText = (p: BeforePart): ReactNode => {
    switch (p.kind) {
      case 'first':
        return t('first');
      case 'named':
        return t('beforeNamed', { names: p.names });
      case 'namedMore':
        return t('beforeNamedMore', { names: p.names, count: p.count });
      default:
        return t('beforeCount', { count: p.count });
    }
  };
  const afterText = (p: AfterPart): string => {
    switch (p.kind) {
      case 'last':
        return t('last');
      case 'named':
        return t('afterNamed', { names: p.names });
      case 'namedMore':
        return t('afterNamedMore', { names: p.names });
      default:
        return t('afterCount', { count: p.count });
    }
  };

  const addToCalendar = () => {
    if (!zone || n === null) return;
    downloadIcs(
      {
        uid: `time2fest-my-midnight-${zone.id}`,
        title: t('calendarTitle'),
        description: t('calendarText', { n }),
        startMs: zone.midnightMs,
      },
      'time2fest-moya-pivnich.ics',
    );
  };

  const shareCard = async () => {
    if (!country || n === null || busy) return;
    setBusy(true);
    try {
      const family = getComputedStyle(document.body).fontFamily || 'Manrope, system-ui, sans-serif';
      await document.fonts.ready;
      await Promise.all(['500', '600', '700', '800'].map((w) => document.fonts.load(`${w} 16px ${family}`).catch(() => [])));
      const k = STORY_W / 250;
      const blob = site && inviteVars && inviteTexts ? await renderInvitePng(await inviteParams(inviteTexts, inviteVars)) : await renderStoryPng({
        line1: t('storyLine1'),
        ord: t('ordinal', { n }),
        line3: t('storyLine3'),
        where: where ?? '',
        invite: t('storyInvite'),
        site: t('storySite'),
        flagSrc: roundFlagSrc(country.flagCode),
        logoSrc: '/brand/logo.png',
        colors: {
          background: cssVar('--color-background', '#121214'),
          text: cssVar('--color-text', '#ECECEF'),
          textSecondary: cssVar('--color-text-secondary', '#B5B5BD'),
          highlight: cssVar('--color-highlight', '#FCE286'),
        },
        fontFamily: family,
        drawBackground: (g) => {
          g.save();
          g.scale(k, k);
          drawScene(g, 250, STORY_H / k, 41, { bursts: 4 });
          g.restore();
        },
      });
      if (!blob) return;
      const file = new File([blob], 'time2fest-moya-pivnich.png', { type: 'image/png' });
      const text = t('shareText', { n });
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text });
        } catch (e) {
          if (!(e instanceof DOMException && e.name === 'AbortError')) throw e;
        }
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'time2fest-moya-pivnich.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(t('shareSaved'));
    } finally {
      setBusy(false);
    }
  };

  // Мовне дерево: кнопка — під карткою сторіс на всю її ширину (рішення власника 2026-11-19).
  const shareButton = (
    <button type="button" className={cn(s.btn, s.btnGhost)} onClick={shareCard} disabled={!country || !ready || busy}>
      <Icon name="share" size={20} />
      {t('share')}
    </button>
  );

  return (
    <section className={cn(s.sec, s.wrap)} id="mine" aria-labelledby="mine-h">
      <h2 className={s.h2} id="mine-h">
        {t('title')}
      </h2>
      <p className={s.intro}>{t('intro')}</p>
      <div className={m.mine}>
        <div className={m.card}>
          <div className={m.pick}>
            <label className={m.label} htmlFor="mine-country">
              {t('label')}
            </label>
            <CountryCombobox
              value={country}
              onChange={(c) => setPicked({ iso: c.iso, zoneId: c.zones[0]?.zoneId ?? '' })}
              inputId="mine-country"
            />
            {multi && country ? (
              <div className={m.chips} role="group" aria-label={t('chipsAria')}>
                <span className={m.chipsLabel}>{t('chipsLabel')}</span>
                {country.zones.map((z) => {
                  const zz = model.zonesById.get(z.zoneId);
                  return (
                    <button
                      key={z.zoneId}
                      type="button"
                      className={m.chipBtn}
                      aria-pressed={z.zoneId === zone?.id}
                      onClick={() => setPicked({ iso: country.iso, zoneId: z.zoneId })}
                    >
                      {z.city ? `${z.city} · ` : ''}
                      {zz ? utcLabel(zz.offsetMinutes) : ''}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className={m.res}>
            <span className={m.resFlag}>
              {country ? (
                <Flag code={country.flagCode} diameter={88} decorative className={m.resFlagImg} />
              ) : (
                <Bar shape="pill" w={[56, 88, 88]} h={[56, 88, 88]} />
              )}
            </span>
            <div>
              <span className={m.k}>{t('resultKicker')}</span>
              <div className={m.ord}>
                {n === null ? <Bar raised w={[84, 100, 120]} h={[42, 50, 60]} /> : ordText}
                <small>{t('ordinalOf')}</small>
              </div>
            </div>
          </div>

          <div className={m.facts}>
            <div>
              <span>{t('factMidnight')}</span>
              <b>
                {ready && zone ? (
                  t('factMidnightValue', { date: dayMonth(zone.midnightMs), time: clock(zone.midnightMs) })
                ) : (
                  <Bar raised w={[110, 130, 150]} h={[16, 18, 22]} />
                )}
              </b>
              <span>{t('factMidnightSub')}</span>
            </div>
            <div>
              <span>{t('factLeft')}</span>
              {left?.over ? (
                <>
                  <b>{t('factLeftNow')}</b>
                  <span>&nbsp;</span>
                </>
              ) : (
                <>
                  <b>{left ? t('factLeftDays', { count: left.days }) : <Bar raised w={[70, 80, 90]} h={[16, 18, 22]} />}</b>
                  <span>{left ? t('factLeftHours', { count: left.hours }) : <>&nbsp;</>}</span>
                </>
              )}
            </div>
            <div>
              <span>{t('factBefore')}</span>
              <b>{index === null ? <Bar raised w={[70, 80, 90]} h={[16, 18, 22]} /> : t('factBeforeValue', { count: index })}</b>
              <span>{t('factBeforeSub')}</span>
            </div>
          </div>

          <div>
            <ZoneStrip total={total} index={index} countryName={country?.name ?? null} landmarks={landmarks} />
            <p className={m.tlText}>
              {sentence ? (
                <>
                  {beforeText(sentence.before)} <b>{afterText(sentence.after)}</b>
                </>
              ) : (
                <span className={m.tlSk} aria-hidden="true">
                  <Bar w="100%" h={[14, 15, 16]} />
                  <Bar w="70%" h={[14, 15, 16]} />
                </span>
              )}
            </p>
          </div>

          <div className={cn(s.cta, m.actions)}>
            <button type="button" className={cn(s.btn, s.btnCoral)} onClick={addToCalendar} disabled={!zone || !ready}>
              <Icon name="calendar-add" size={20} />
              {t('addCalendar')}
            </button>
            {site ? null : shareButton}
          </div>
        </div>

        {site ? (
          <InviteCard vars={inviteVars} texts={inviteTexts} action={shareButton} />
        ) : (
          <StoryCard ord={n === null ? null : ordText} flagCode={country?.flagCode ?? null} where={where} />
        )}
      </div>
    </section>
  );
}
