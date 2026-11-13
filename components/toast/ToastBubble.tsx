'use client';

/**
 * Тост — бульбашка за рівнем (дошки `Desk-Toast-New`, `Phone-Toast-New` v2, рішення власника 2026-11-12): прапор, нік,
 * позначка пасу, жовта «тост», час праворуч, текст фірмовими емодзі; під текстом для $5 — «закріплено під трансляцією»,
 * для $10 — «закріплено · у привітанні опівночі». `plain` — сірий тост у «Щойно» смуги (без «тост» і позначок).
 * Суми не показуємо — лише що тост дає. Той самий вигляд — у розгорнутій смузі, на екрані успіху й на «Підтримати».
 */
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { EmojiText } from '@/components/primitives/Emoji';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { PassMark } from '@/components/primitives/PassMark';
import type { ToastTier } from '@/lib/toast/tiers';
import s from './toast.module.css';

export function ToastPill() {
  const t = useTranslations('toast');
  return <span className={s.pill}>{t('badge')}</span>;
}

/** Рядок під тостом $5 / $10 у чаті й на успіху. */
export function TierMeta({ tier, className }: { tier: number; className?: string }) {
  const t = useTranslations('toast.chat');
  if (tier < 5) return null;
  return (
    <p className={cn(s.meta, className)} data-toast-meta={tier}>
      <Icon name="pin" size={12} />
      {tier >= 10 ? (
        <>
          {t('pinnedShort')}
          <span aria-hidden="true" className={s.dot}>
            ·
          </span>
          <Icon name="spark" size={12} />
          {t('greeting')}
        </>
      ) : (
        t('pinned')
      )}
    </p>
  );
}

export interface ToastBubbleProps {
  nick: string;
  flagCode: string;
  text: string;
  /** `plain` — сірий «щойно» у смузі. */
  tier: ToastTier | 'plain';
  /** Праворуч у шапці: «щойно», «3 хв», «до 02:00». */
  aside?: string;
  /** Рядок «закріплено…» під текстом (чат, успіх); у смузі — ні. */
  meta?: boolean;
  pass?: boolean;
  className?: string;
}

export function ToastBubble({ nick, flagCode, text, tier, aside, meta = false, pass = false, className }: ToastBubbleProps) {
  return (
    <div className={cn(s.bubble, className)} data-tier={tier} data-toast-bubble="">
      <div className={s.head}>
        <Flag code={flagCode} size="xs" decorative />
        <span className={s.nick}>{nick}</span>
        {pass ? <PassMark variant="outline" className={s.passMark} /> : null}
        {tier === 'plain' ? null : <ToastPill />}
        <span className={s.spacer} />
        {aside ? <span className={s.ago}>{aside}</span> : null}
      </div>
      <p className={s.text}>
        <EmojiText text={text} />
      </p>
      {meta && tier !== 'plain' ? <TierMeta tier={tier} /> : null}
    </div>
  );
}
