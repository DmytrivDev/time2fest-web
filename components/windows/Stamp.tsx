'use client';

/**
 * C14. Stamp (AchievementCard) — ачівка «Новий штамп у паспорті» за дошкою `Desk-Stamp-Open` (рішення власника 2026-11-01).
 * Окремий блок під рядком дій плеєра (`StampBlock`), не вікно `OverlayManager`: вікна збоку його не прибирають.
 * Завжди розгорнутий, без згортання: зліва тонка смужка кольорів прапора, текст і кнопки; справа — листівка міста
 * з печаткою (`StampArt`, «старий» вигляд). На телефоні листівка на всю ширину згори, назва й країна — по центру.
 * «×» прибирає саме цей штамп (він лишається в «Мій паспорт»); без `onClose` хрестика немає (сторінка країни — штамп
 * висить постійно, рішення 2026-11-05). Країна з кількома поясами — штамп за кожен пояс: пояс у підзаголовку й на печатці.
 *
 * Стани: `stamping` (удар штемпеля ≈ 0,6 с + конфеті — лише у `lively`), `multi` («Сідней · Мельбурн»),
 * `first-row` (подвійна жовта рамка), `save-failed`. Коралова «Поділитися» реєструється в `lib/overlay/coral`
 * (кнопка звуку стає нейтральною); alt листівки = текст штампа.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { Reveal } from '@/components/primitives/Reveal';
import { flagGradient } from '@/lib/flags/colors';
import { useRegisterCoral } from '@/lib/overlay/coral';
import st from './stamp.module.css';
import { StampArt } from './StampArt';
import './StampMotion.css';

export interface StampEntry {
  eventId?: string;
  /** Назва міста в називному відмінку («Сідней»). */
  city: string;
  /** Назва країни в називному відмінку («Австралія»). */
  countryName: string;
  flagCode: string;
  illustrationId: string;
  /** Номер місця в «Першому ряді», якщо гість там сидів. */
  firstRowSeat?: number;
  /** Пояс («UTC−5») — лише для країн з кількома поясами. */
  zone?: string;
}

export type StampSaveState = 'saved' | 'pending' | 'failed';

export interface StampProps {
  /** Одна або кілька подій цього моменту (кілька → «Сідней · Мельбурн»). */
  stamps: StampEntry[];
  /** Зіграти «удар» штемпеля й конфеті (лише у `lively`; під «зменшити рух» штемпель одразу на місці). */
  stamping?: boolean;
  /** Гість з акаунтом? Для гостя без входу показуємо «Збережено на цьому пристрої · Увійди…». */
  signedIn?: boolean;
  saveState?: StampSaveState;
  onShare?: () => void;
  onPassport?: () => void;
  onSignIn?: () => void;
  onRetrySave?: () => void;
  /** Під штампом інше вікно з власною кораловою дією (пропозиція, оцінка) → «Поділитися» стає вторинною: коралова — одна. */
  quiet?: boolean;
  /** «×» — прибрати цей штамп. */
  onClose?: () => void;
  /** «Як тобі шоу?» рядком під кнопками (з +5 хв): плавно розкривається, коли з’являється. */
  rate?: ReactNode;
  className?: string;
}

const CONFETTI_TONES = ['var(--color-highlight)', 'var(--color-primary)', 'var(--color-text)'] as const;
const CONFETTI = Array.from({ length: 16 }, (_, i) => ({
  left: `${(i * 37 + 6) % 94}%`,
  drift: `${((i * 13) % 5 - 2) * 14}px`,
  spin: `${240 + i * 31}deg`,
  delay: `${(i % 6) * 110}ms`,
  tone: CONFETTI_TONES[i % CONFETTI_TONES.length],
}));

/** Тривалість «удару» + конфеті, після якої `data-stamping` знімається. */
const STAMPING_MS = 2600;

export function Stamp({
  stamps,
  stamping = false,
  quiet = false,
  signedIn = false,
  saveState = 'saved',
  onShare,
  onPassport,
  onSignIn,
  onRetrySave,
  onClose,
  rate,
  className,
}: StampProps) {
  const t = useTranslations('windows.achievement');
  const titleId = useId();

  const [playing, setPlaying] = useState(stamping);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- синхронізація з пропом `stamping` і таймер завершення
    setPlaying(stamping);
    if (!stamping) return;
    const id = window.setTimeout(() => setPlaying(false), STAMPING_MS);
    return () => window.clearTimeout(id);
  }, [stamping]);

  useRegisterCoral(!quiet);

  const first = stamps[0];
  if (!first) return null;

  const cities = stamps.map((s) => s.city);
  const placesShort = cities.length === 2 ? t('multi', { first: cities[0]!, second: cities[1]! }) : cities.join(' · ');
  const zone = stamps.length === 1 ? first.zone : undefined;
  const countries = [...new Set(stamps.map((s) => s.countryName))].join(' · ') + (zone ? ` · ${zone}` : '');
  const stampText = t('stamped', { city: (zone ? `${placesShort} · ${zone}` : placesShort).toLocaleUpperCase('uk') });
  const frStamp = stamps.find((s) => s.firstRowSeat !== undefined);
  const multi = stamps.length > 1;
  const failed = saveState === 'failed';
  const strip = flagGradient(first.flagCode);

  const content: ReactNode = (
    <>
      {/* Смужка кольорів прапора — лівий край картки (загинається по заокругленнях кутів), плавний градієнт переважних
          кольорів (`lib/flags/colors`), білий — білий; за нею ледь помітне сяйво. Текст на неї не лягає. */}
      {strip ? (
        <>
          <span aria-hidden="true" className={st.glow} style={{ '--flag': strip } as CSSProperties} />
          <span aria-hidden="true" className={st.strip} style={{ '--flag': strip } as CSSProperties} />
        </>
      ) : null}
      <p className={st.head}>{t('heading')}</p>
      <div className={st.art}>
        <div data-stamping={playing ? 'true' : 'false'} className="relative overflow-hidden rounded-md">
          <StampArt illustrationId={first.illustrationId} stampText={stampText} stamping={playing} />
          <span aria-hidden="true" className="t2f-stamp-spark" />
          <span aria-hidden="true" className="pointer-events-none absolute inset-0">
            {CONFETTI.map((c, i) => (
              <span
                key={i}
                className="t2f-confetti"
                style={{ '--left': c.left, '--drift': c.drift, '--spin': c.spin, '--delay': c.delay, '--tone': c.tone } as CSSProperties}
              />
            ))}
          </span>
        </div>
      </div>
      <div className={st.body}>
        <div className={st.titleBlock}>
          <h2 id={titleId} className={st.title}>
            <span className={st.flags}>
              {stamps.map((s) => (
                <Flag key={s.flagCode + (s.eventId ?? s.city)} round code={s.flagCode} size="md" decorative />
              ))}
            </span>
            <span>{placesShort}</span>
          </h2>
          <p className={st.sub}>{t('subline', { country: countries })}</p>
        </div>
        {frStamp ? (
          <p className={cn('flex items-center gap-2 text-label-sm text-highlight', st.line)} data-row="first-row">
            <Icon name="ticket" size={16} />
            {t('firstRow', { city: frStamp.city })}
          </p>
        ) : null}
        {failed ? (
          <div className={cn('flex flex-wrap items-center gap-x-3 text-caption text-text-secondary', st.line)} data-row="save-failed">
            <span>{t('saveFailed')}</span>
            <Button variant="ghost" compact onClick={onRetrySave}>
              {t('retry')}
            </Button>
          </div>
        ) : (
          <>
            <p className={cn('flex items-center gap-1.5', st.inPassport, st.line)} data-row="in-passport">
              <Icon name="check" size={16} />
              {t('inPassport')}
            </p>
            {!signedIn ? (
              <p className={st.saved} data-row="saved-local">
                {t.rich('savedLocal', {
                  signIn: (chunks) => (
                    <button
                      type="button"
                      onClick={onSignIn}
                      className="t2f-focus -my-3 inline-flex min-h-touch-min items-center rounded-sm text-body-strong text-text underline underline-offset-2"
                    >
                      {chunks}
                    </button>
                  ),
                })}
              </p>
            ) : null}
          </>
        )}
        <div className={st.actions}>
          <Button variant={quiet ? 'secondary' : 'coral'} size="lg" iconLeft="share" onClick={onShare}>
            {t('share')}
          </Button>
          <Button variant="secondary" size="lg" iconLeft="passport" onClick={onPassport}>
            {t('passport')}
          </Button>
        </div>
      </div>
      <Reveal open={!!rate} className={st.rate}>
        {rate}
      </Reveal>
    </>
  );

  return (
    <section
      aria-labelledby={titleId}
      data-stamp={multi ? 'multi' : 'expanded'}
      data-first-row={frStamp ? 'true' : undefined}
      data-save-state={saveState}
      className={cn(
        // Без золотої рамки (правка власника 2026-11-01): край картки — смужка прапора. «Перший ряд» — подвійна жовта рамка.
        'relative overflow-hidden rounded-lg bg-surface-raised',
        frStamp ? 'border border-highlight p-1' : st.card,
        className,
      )}
    >
      {frStamp ? (
        <div className={cn('relative overflow-hidden rounded-md border border-highlight', st.card)} data-frame="inner">
          {content}
        </div>
      ) : (
        content
      )}
      {onClose ? (
        <IconButton
          icon="close"
          variant="plain"
          iconSize={18}
          aria-label={t('dismiss')}
          className="absolute right-0.5 top-0 text-text-muted md:right-1.5 md:top-2"
          onClick={onClose}
        />
      ) : null}
    </section>
  );
}

/** Назва з інвентаря компонентів (C14). */
export const AchievementCard = Stamp;
