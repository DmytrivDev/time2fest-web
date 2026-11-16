'use client';

import { useTranslations } from 'next-intl';
import { useChatColumn, useOverlay } from '@/components/shell/OverlayManager';
import { SITE_HOST } from '@/lib/config/site';
import { MORE_ACTIONS_ID, MoreActionsDesk, nativeShare, type ShareTarget } from './MoreActions';

/** Адреса й текст для «Поділитися трансляцією» (пункт «⋯» і кнопка-іконка в підписі). */
export function shareTargetFor(href: string | null, text: string): ShareTarget {
  return {
    url: `${typeof window !== 'undefined' ? window.location.origin : `https://${SITE_HOST}`}${href ?? '/'}`,
    shortUrl: `${SITE_HOST}${href ?? '/'}`,
    text,
  };
}

/**
 * Кнопка-іконка «Поділитися» (п. 16, Т15; власник 2026-11-15/16): те саме вікно, що в «⋯» — десктоп: панель на місці чату
 * (`MoreActionsDesk` з посиланням, системним шерингом і WhatsApp), телефон: системне вікно «Поділитися» (без нього —
 * копіює посилання). Пункт у «⋯» лишається.
 */
export function useShareStream({ href, place }: { href: string | null; place: string }): () => void {
  const t = useTranslations('player');
  const overlay = useOverlay();
  const column = useChatColumn();
  return () => {
    const target = shareTargetFor(href, t('more.shareText', { place }));
    if (!column) {
      void nativeShare(target);
      return;
    }
    overlay.open({
      id: MORE_ACTIONS_ID,
      kind: 'accent',
      chrome: 'board',
      title: t('moreActions'),
      description: place,
      content: <MoreActionsDesk target={target} />,
    });
  };
}
