'use client';

/**
 * C17. CookieBanner (B-COOKIES) і CookieSettings (FR-065; дошки `Desk-Cookies-Bar`, `Desk-Cookies-Design`, рішення 2026-11-02).
 * Плашка — не вікно: нічого не блокує, без затемнення, ніколи не лягає на відео (правило YouTube; див. CookieLayer).
 * Дії рівноцінні (коралової немає): «Налаштувати», «Лише необхідні», «Прийняти»; × — те саме, що «Лише необхідні».
 * Варіанти:
 * - `bar` — один рядок: десктоп (завширшки з колонку відео) і телефон горизонтально (`compact`: без значка, коротший текст);
 * - `card` — телефон вертикально: невелика картка над «Розгорнути чат», «Налаштувати» — посиланням у тексті.
 * `CookieSettings` — вміст Sheet / ChatSlotPanel: чотири категорії (Switch), коралова «Зберегти вибір».
 */
import { useTranslations } from 'next-intl';
import { useId, useState, type CSSProperties, type Ref } from 'react';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { Switch } from '@/components/primitives/Switch';
import { useRegisterCoral } from '@/lib/overlay/coral';

export type CookieVariant = 'bar' | 'card';

export interface CookieChoices {
  analytics: boolean;
  marketing: boolean;
  facebookVideo: boolean;
}

export interface CookieBannerProps {
  variant: CookieVariant;
  /** Телефон горизонтально: без значка, коротший текст. */
  compact?: boolean;
  /** Плашка схована, бо лягла б на відео: виїжджає вниз, недоступна для фокуса. */
  hidden?: boolean;
  onAccept?: () => void;
  onNecessaryOnly?: () => void;
  onCustomize?: () => void;
  /** × — те саме, що «Лише необхідні» (а при збої збереження — просто ховає плашку). */
  onClose?: () => void;
  /** Вибір не вдалося зберегти: тихий рядок + «Спробувати ще». */
  saveFailed?: boolean;
  onRetry?: () => void;
  style?: CSSProperties;
  ref?: Ref<HTMLElement>;
  className?: string;
}

/** Значок печива в золотому колі (дошка `Desk-Cookies-Design`). */
function Badge() {
  return (
    <span aria-hidden="true" className="flex size-9 flex-none items-center justify-center rounded-full bg-highlight-tint text-highlight">
      <Icon name="cookie" size={20} />
    </span>
  );
}

export function CookieBanner({
  variant,
  compact = false,
  hidden = false,
  onAccept,
  onNecessaryOnly,
  onCustomize,
  onClose,
  saveFailed = false,
  onRetry,
  style,
  ref,
  className,
}: CookieBannerProps) {
  const t = useTranslations('cookies');
  const titleId = useId();
  const close = (
    <button
      type="button"
      aria-label={saveFailed ? t('closeShort') : t('close')}
      onClick={onClose}
      className="t2f-focus flex size-9 flex-none items-center justify-center rounded-md text-text-secondary hover:bg-border hover:text-text"
    >
      <Icon name="close" size={18} />
    </button>
  );
  const customize = (
    <button
      type="button"
      onClick={onCustomize}
      className="t2f-focus rounded-sm font-semibold text-text underline underline-offset-2 hover:text-text-secondary"
    >
      {t('customize')}
    </button>
  );
  const failed = (
    <p role="alert" data-row="save-failed" className="flex min-w-0 flex-1 items-start gap-2 text-text">
      <Icon name="alert" size={18} className="mt-0.5 flex-none text-primary" />
      <span>{t('saveFailed')}</span>
    </p>
  );
  const retry = (
    <Button variant="secondary" className="t2f-cookie-btn" onClick={onRetry}>
      {t('retry')}
    </Button>
  );
  const choices = (
    <>
      <Button variant="secondary" className="t2f-cookie-btn" onClick={onNecessaryOnly}>
        {t('necessaryOnly')}
      </Button>
      <Button variant="secondary" className="t2f-cookie-btn" onClick={onAccept}>
        {t('accept')}
      </Button>
    </>
  );

  return (
    <section
      ref={ref}
      aria-labelledby={titleId}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
      data-cookie-banner={variant}
      data-hidden={hidden ? 'true' : 'false'}
      data-compact={compact ? 'true' : undefined}
      style={style}
      className={cn('t2f-cookie fixed z-40 box-border rounded-lg border border-border-strong bg-surface-raised text-text', className)}
    >
      {variant === 'bar' ? (
        <div className={cn('flex items-center gap-3 py-2.5 pe-1.5', compact ? 'ps-4' : 'ps-3.5')}>
          {compact || saveFailed ? null : <Badge />}
          {saveFailed ? (
            <>
              <h2 id={titleId} className="sr-only">
                {t('title')}
              </h2>
              {failed}
              {retry}
            </>
          ) : (
            <>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <h2 id={titleId} className="t2f-cookie-title font-bold leading-tight">
                  {t('title')}
                </h2>
                <p className="t2f-cookie-text leading-snug text-text-secondary">
                  {compact ? t('textShort') : t('text')}
                </p>
              </div>
              <div className="flex flex-none items-center gap-2">
                <span className="t2f-cookie-link px-1.5">{customize}</span>
                {choices}
              </div>
            </>
          )}
          {close}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 pb-3.5 pe-1.5 ps-3.5 pt-3">
          <div className="flex items-center gap-2.5">
            <Badge />
            <h2 id={titleId} className="t2f-cookie-title flex-1 font-bold leading-tight">
              {t('title')}
            </h2>
            {close}
          </div>
          {saveFailed ? (
            <div className="flex flex-col gap-2.5 pe-2">
              {failed}
              {retry}
            </div>
          ) : (
            <>
              <p className="t2f-cookie-text pe-2 leading-snug text-text-secondary">
                {t('text')} {customize}
              </p>
              <div className="grid grid-cols-2 gap-2 pe-2 *:min-w-0 *:px-2">{choices}</div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export interface CookieSettingsProps {
  value: CookieChoices;
  /** «Зберегти вибір»: гість обрав категорії. */
  onSave?: (choices: CookieChoices) => void;
  saveFailed?: boolean;
  onRetry?: () => void;
  className?: string;
}

/** Вміст вікна «Налаштування cookies»: Необхідні (завжди), Аналітика, Маркетинг, «Відео з Facebook». */
export function CookieSettings({ value, onSave, saveFailed = false, onRetry, className }: CookieSettingsProps) {
  const t = useTranslations('cookies');
  const [draft, setDraft] = useState<CookieChoices>(value);
  useRegisterCoral();
  const rows: { key: keyof CookieChoices; label: string; text: string }[] = [
    { key: 'analytics', label: t('analytics'), text: t('analyticsText') },
    { key: 'marketing', label: t('marketing'), text: t('marketingText') },
    { key: 'facebookVideo', label: t('facebook'), text: t('facebookText') },
  ];
  return (
    <div data-window="O-COOKIES" className={cn('flex flex-col gap-4', className)}>
      <ul aria-label={t('categoriesLabel')} className="flex flex-col divide-y divide-border">
        <li className="flex flex-col py-1" data-category="necessary">
          <Switch label={t('necessary')} checked disabled className="w-full justify-between" />
          <span className="pb-2 text-caption text-text-muted">{t('necessaryText')}</span>
        </li>
        {rows.map((row) => (
          <li key={row.key} className="flex flex-col py-1" data-category={row.key}>
            <Switch
              label={row.label}
              checked={draft[row.key]}
              onCheckedChange={(v) => setDraft((d) => ({ ...d, [row.key]: v }))}
              className="w-full justify-between"
            />
            <span className="pb-2 text-caption text-text-muted">{row.text}</span>
          </li>
        ))}
      </ul>
      <Button variant="coral" size="lg" onClick={() => onSave?.(draft)}>
        {t('save')}
      </Button>
      {saveFailed ? (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 text-caption text-text" data-row="save-failed">
          <Icon name="alert" size={16} className="text-primary" />
          <span className="flex-1">{t('saveFailed')}</span>
          <Button variant="ghost" compact onClick={onRetry}>
            {t('retry')}
          </Button>
        </div>
      ) : null}
      <p className="text-caption text-text-muted">{t('later')}</p>
    </div>
  );
}
