'use client';

/**
 * O-SHARE — «Поділитися штампом» (FR-065, Phone-/Desk-Share). Вікно з вибором (`form`): телефон — Sheet під плеєром,
 * десктоп — ChatSlotPanel на місці чату. Прев’ю картки 9:16 і 1:1; дії: системний шеринг (завжди перший, коралова),
 * WhatsApp, «Копіювати посилання», «Завантажити зображення»; стани «генерується» (скелетон, поки картка малюється)
 * і «скопійовано». Набір кнопок — за EXPERIENCE (ІНВ I-41: артборд мав Telegram / Instagram Stories — узгодити з власником).
 *
 * `ShareContent` — вигляд (історії, тести); `shareWindowSpec` — готове вікно для `OverlayManager` зі `Stamp`.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { SegmentedControl } from '@/components/primitives/SegmentedControl';
import { Skeleton } from '@/components/primitives/Skeleton';
import type { OverlaySpec } from '@/components/shell/OverlayManager';
import { getData } from '@/lib/data/load';
import { formatClock } from '@/lib/i18n/time';
import { SHARE_SIZE, shareCardSvg, svgDataUrl, svgToPngBlob, type ShareRatio } from '@/lib/offers/shareImage';
import { useRegisterCoral } from '@/lib/overlay/coral';
import type { StampEntry } from './Stamp';

export const SHARE_WINDOW_ID = 'O-SHARE';

export interface ShareData {
  /** Місто (або «Сідней · Мельбурн») в називному відмінку. */
  place: string;
  /** Час півночі за часом гостя («12:00»). */
  time: string;
  /** Що відкриється за посиланням. */
  url: string;
}

export interface ShareContentProps {
  data: ShareData;
  /** Системний шеринг (за замовчуванням `navigator.share`; без нього кнопка копіює посилання). */
  onNativeShare?: (payload: { title: string; text: string; url: string }) => Promise<void> | void;
  /** Растеризація картки для «Завантажити зображення» (за замовчуванням canvas). */
  renderPng?: (svg: string, width: number, height: number) => Promise<Blob>;
  /** Збереження PNG; за замовчуванням — завантаження через `<a download>`. */
  onDownload?: (blob: Blob, filename: string) => void;
  /** Інша картинка замість штампа (листівка «Першого ряду»): SVG для формату. */
  svgFor?: (ratio: ShareRatio) => string;
  /** Опис прев’ю для зчитувача (за замовчуванням — штамп). */
  previewAlt?: string;
  /** Текст для системного шерингу й WhatsApp (за замовчуванням — штамп). */
  shareText?: string;
  /** Початок імені файлу PNG (`time2fest-stamp`). */
  fileStem?: string;
  className?: string;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ShareContent({
  data,
  onNativeShare,
  renderPng = svgToPngBlob,
  onDownload = saveBlob,
  svgFor,
  previewAlt,
  shareText,
  fileStem = 'time2fest-stamp',
  className,
}: ShareContentProps) {
  const t = useTranslations('share');
  const [ratio, setRatio] = useState<ShareRatio>('story');
  const [loaded, setLoaded] = useState<ShareRatio | null>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useRegisterCoral();

  const caption = t('caption', { place: data.place, time: data.time });
  const svg = useMemo(
    () => (svgFor ? svgFor(ratio) : shareCardSvg(ratio, { stampLine: t('stampLine'), place: data.place.toLocaleUpperCase('uk'), caption, brand: 'Time2Fest' })),
    [ratio, data.place, caption, t, svgFor],
  );
  const src = useMemo(() => svgDataUrl(svg), [svg]);
  const size = SHARE_SIZE[ratio];
  const generating = loaded !== ratio;

  const text = shareText ?? t('shareText', { place: data.place });
  const waHref = `https://wa.me/?text=${encodeURIComponent(`${text} ${data.url}`)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.url);
      setCopied(true);
    } catch {
      // буфер недоступний — посилання видно в рядку нижче, його можна виділити
    }
  };

  const nativeShare = async () => {
    const payload = { title: text, text, url: data.url };
    try {
      if (onNativeShare) await onNativeShare(payload);
      else if (typeof navigator.share === 'function') await navigator.share(payload);
      else await copy();
    } catch {
      // людина закрила системне вікно — не помилка
    }
  };

  const download = async () => {
    setFailed(false);
    try {
      const blob = await renderPng(svg, size.w, size.h);
      onDownload(blob, `${fileStem}-${ratio === 'story' ? '9x16' : '1x1'}.png`);
    } catch {
      setFailed(true);
    }
  };

  return (
    <div data-window="O-SHARE" className={cn('flex flex-col gap-4', className)}>
      <SegmentedControl
        label={t('ratioLabel')}
        options={[
          { value: 'story', label: t('ratioStory') },
          { value: 'square', label: t('ratioSquare') },
        ]}
        value={ratio}
        onValueChange={(v) => setRatio(v as ShareRatio)}
        className="self-start"
      />
      <div className="relative self-start" data-row="preview" data-ratio={ratio} aria-busy={generating}>
        {/* eslint-disable-next-line @next/next/no-img-element -- data-URL картка, оптимізація зображень не потрібна */}
        <img
          src={src}
          alt={previewAlt ?? t('previewAlt', { caption })}
          width={size.w}
          height={size.h}
          onLoad={() => setLoaded(ratio)}
          onError={() => setLoaded(ratio)}
          className="h-48 w-auto rounded-md border border-border"
        />
        {generating ? <Skeleton variant="block" className="absolute inset-0 rounded-md" /> : null}
      </div>
      <p role="status" className="min-h-5 text-caption text-text-secondary" data-row="status">
        {generating ? t('generating') : copied ? t('copied') : ''}
      </p>
      {failed ? (
        <p role="alert" className="text-caption text-text" data-row="error">
          {t('downloadFailed')}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2" data-row="actions">
        <li>
          <Button variant="coral" size="lg" iconLeft="share" className="w-full" onClick={nativeShare}>
            {t('system')}
          </Button>
        </li>
        <li>
          <Button variant="tonal" size="lg" className="w-full" asChild>
            <a href={waHref} target="_blank" rel="noopener noreferrer">
              {t('whatsapp')}
            </a>
          </Button>
        </li>
        <li>
          <Button variant="tonal" size="lg" iconLeft={copied ? 'check' : undefined} className="w-full" onClick={copy}>
            {copied ? t('copied') : t('copy')}
          </Button>
        </li>
        <li>
          <Button variant="tonal" size="lg" iconLeft="arrow-down" className="w-full" onClick={download}>
            {t('download')}
          </Button>
        </li>
      </ul>
      <p className="truncate text-caption text-text-muted" data-row="url">
        {data.url}
      </p>
    </div>
  );
}

/** Дані для шерингу зі штампів: місто (міста), час півночі, адреса сторінки країни. */
export function shareDataFromStamps(stamps: readonly StampEntry[]): ShareData {
  const data = getData();
  const first = stamps[0];
  const event = first?.eventId ? data.eventsById.get(first.eventId) : undefined;
  const country = event ? data.countriesByIso.get(event.countryIso) : undefined;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return {
    place: stamps.map((s) => s.city).join(' · '),
    time: event ? formatClock(event.midnightMs) : '',
    url: `${origin}${country ? `/country/${country.slug}/` : '/'}`,
  };
}

/** Вікно «Поділитися» для `OverlayManager.open()` (виклик зі `Stamp.onShare`). */
export function shareWindowSpec(stamps: readonly StampEntry[], title: string): OverlaySpec {
  return {
    id: SHARE_WINDOW_ID,
    kind: 'form',
    title,
    content: <ShareContent data={shareDataFromStamps(stamps)} />,
  };
}
