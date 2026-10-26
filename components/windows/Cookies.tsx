'use client';

/**
 * C17. CookieBanner (B-COOKIES) і CookieSettings (FR-065, Phone-/Desk-Cookies, Desk-Cookies-Wide, Phone-Cookies-Settings).
 * Банер — не вікно: нічого не блокує, без затемнення. Три рівноцінні secondary-кнопки: «Прийняти», «Лише необхідні»,
 * «Налаштувати» (коралової немає). Варіанти:
 * - `corner` (десктоп) — лівий нижній кут, ≤ 360 px, не на плеєрі й не на чаті;
 * - `strip` (телефон) — невисока смуга внизу на всю ширину;
 * - `inflow` — смуга в потоці сторінки під кнопками плеєра, коли вільного кута немає (чат сховано, відео на всю ширину).
 * `CookieSettings` — вміст Sheet / ChatSlotPanel: чотири категорії (Switch), коралова «Зберегти вибір».
 */
import { useTranslations } from 'next-intl';
import { useId, useState, type Ref } from 'react';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { Switch } from '@/components/primitives/Switch';
import { useRegisterCoral } from '@/lib/overlay/coral';

export type CookieVariant = 'corner' | 'strip' | 'inflow';

export interface CookieChoices {
  analytics: boolean;
  marketing: boolean;
  facebookVideo: boolean;
}

export interface CookieBannerProps {
  variant: CookieVariant;
  onAccept?: () => void;
  onNecessaryOnly?: () => void;
  onCustomize?: () => void;
  /** Вибір не вдалося зберегти: тихий рядок + «Спробувати ще». */
  saveFailed?: boolean;
  onRetry?: () => void;
  ref?: Ref<HTMLElement>;
  className?: string;
}

const SHELL: Record<CookieVariant, string> = {
  corner: 'fixed bottom-4 left-8 z-30 w-full gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-mini-player',
  strip: 'fixed inset-x-0 bottom-0 z-30 gap-2 border-t border-border bg-surface-raised px-3 pb-4 pt-3 shadow-mini-player',
  inflow: 'gap-3 rounded-lg border border-border bg-surface-raised p-4 md:flex-row md:flex-wrap md:items-center md:gap-x-8 md:ps-5',
};

export function CookieBanner({ variant, onAccept, onNecessaryOnly, onCustomize, saveFailed = false, onRetry, ref, className }: CookieBannerProps) {
  const t = useTranslations('cookies');
  const titleId = useId();
  const labelled = variant !== 'strip';
  const buttons = (
    <div className={cn('grid gap-2', variant === 'inflow' ? 'md:flex-none md:grid-cols-3' : variant === 'corner' ? 'grid-cols-2' : 'grid-cols-3')}>
      <Button variant="secondary" compact={variant === 'strip'} onClick={onAccept}>
        {t('accept')}
      </Button>
      <Button variant="secondary" compact={variant === 'strip'} onClick={onNecessaryOnly}>
        {t('necessaryOnly')}
      </Button>
      <Button
        variant="secondary"
        compact={variant === 'strip'}
        onClick={onCustomize}
        className={cn(variant === 'corner' && 'col-span-2')}
      >
        {t('customize')}
      </Button>
    </div>
  );
  return (
    <section
      ref={ref}
      {...(labelled ? { 'aria-labelledby': titleId } : { 'aria-label': t('regionLabel') })}
      data-cookie-banner={variant}
      style={variant === 'corner' ? { maxWidth: 'var(--cookie-banner-max-width)' } : undefined}
      className={cn('flex flex-col', SHELL[variant], className)}
    >
      {labelled ? (
        <div className={cn('flex flex-col gap-0.5', variant === 'inflow' && 'md:min-w-0 md:flex-1')}>
          <h2 id={titleId} className="text-body-strong text-text">
            {t('title')}
          </h2>
          <p className="text-caption text-text-secondary">{t('text')}</p>
        </div>
      ) : (
        <p className="px-1 text-caption text-text">{t('text')}</p>
      )}
      {buttons}
      {saveFailed ? (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 text-caption text-text" data-row="save-failed">
          <Icon name="alert" size={16} className="text-primary" />
          <span className="flex-1">{t('saveFailed')}</span>
          <Button variant="ghost" compact onClick={onRetry}>
            {t('retry')}
          </Button>
        </div>
      ) : null}
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
