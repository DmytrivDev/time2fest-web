'use client';

/**
 * C13 AuthorPanel — O-AUTHOR (FR-055; макети `Desk-Author`, `Phone-Author`, `Phone-Author-NoPass`, `Phone-Author-States`).
 * Немодальне вікно: десктоп — `ChatSlotPanel` на місці колонки чату, телефон — Sheet під плеєром (розміщення й шапку
 * «‹ Назад · Автор повідомлення» дає `OverlayManager`, `chrome: 'author'`). Тіло прокручується саме, плашка пасу внизу закріплена.
 * Зверху вниз: автор (круглий прапор 40 px, нік, країна, «Новорічний пас») ·
 * «Шлях <нік>» + підсумок · мініатюра `PathMap` з легендою · картка «Переглянути шлях» (зустрінуті, далі заплановані;
 * прапори з’єднані пунктиром) · «Поскаржитись» (повідомлення, «Відповісти» і «Згадати» — у меню «⋯») · плашка «Оформи Новорічний пас» (глядач без пасу).
 * Стани автора: пас і зустрічі · пас, але ще нічого · без пасу (картки немає, мапа затемнена з плашкою) · свій нік (лише «це ти»).
 * Десктоп: картка природної висоти, прокручується вся панель; телефон: відкрита картка 232 px з власною прокруткою.
 */
import { Collapsible as Radix } from 'radix-ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { useChatColumn } from '@/components/shell/OverlayManager';
import { PaymentNotice } from '@/components/windows/OfferCard';
import { pathSummary, routeCities, type PathPoint } from '@/lib/chat-sim/authorPath';
import type { Author, ChatMessage } from '@/lib/data/types';
import { PathLegend, PathMap } from './PathMap';
import type { ZoneMapGeometry } from './MapModel';
import './AuthorPanel.css';

export interface AuthorPanelProps {
  author: Author;
  /** Назва країни прапора автора («Єгипет»). */
  countryName?: string;
  /** Повідомлення, яке відкрили (для «Поскаржитись»). */
  message?: ChatMessage;
  /** Автор має пас (показуємо шлях). */
  hasPass: boolean;
  /** Шлях автора (зустрінуті й заплановані); порожній з пасом — «зустрічей ще нема». */
  path?: readonly PathPoint[];
  /** У глядача є пас: плашку «Оформи пас» не показуємо. */
  viewerHasPass?: boolean;
  onReport?: (message: ChatMessage) => void;
  /** «Що ще дає пас?» — відкрити опис пасу. */
  onPassInfo?: () => void;
  /** Готова геометрія мапи (історії, тести). */
  geometry?: ZoneMapGeometry;
  className?: string;
}

/** Зустрінуті місця, далі заплановані; кожна група — у порядку часу. */
function orderedRows(path: readonly PathPoint[]): PathPoint[] {
  return [...path.filter((p) => !p.planned), ...path.filter((p) => p.planned)];
}

function ActionButton({ icon, label, muted, onClick }: { icon: 'flag'; label: string; muted?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className="t2f-focus t2f-transition t2f-author-action" data-muted={muted ? '' : undefined} onClick={onClick}>
      <Icon name={icon} size={18} />
      <span>{label}</span>
    </button>
  );
}

export function AuthorPanel({
  author,
  countryName,
  message,
  hasPass,
  path = [],
  viewerHasPass = false,
  onReport,
  onPassInfo,
  geometry,
  className,
}: AuthorPanelProps) {
  const t = useTranslations('chat.author');
  const w = useTranslations('windows.author');
  const offers = useTranslations('offers');
  const column = useChatColumn();
  const [notice, setNotice] = useState(false);
  const isMine = !!author.isMine;
  const showPath = !isMine;
  const showCard = showPath && hasPass;
  const { met, planned } = pathSummary(path);
  const rows = orderedRows(path);
  const route = routeCities(path);
  const routeText = [route.met.join(' → '), route.planned.length ? t('routeNext', { cities: route.planned.join(', ') }) : ''].filter(Boolean).join(' · ');
  const plannedPart = planned ? t('summaryPlanned', { count: planned }) : '';
  const summary = [met ? t('summaryMet', { count: met }) : t('summaryNone'), plannedPart].filter(Boolean).join(' · ');

  return (
    <div data-window="O-AUTHOR" data-pass={hasPass ? 'yes' : 'no'} data-author-compact={column ? 'false' : 'true'} className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)}>
      <div className="t2f-chat-log t2f-author-body" data-row="body">
        <header className="flex items-center gap-3">
          <Flag round code={author.flagCode} size="xl" name={countryName} decorative={!countryName} />
          <div className="min-w-0 flex-1">
            <h2 tabIndex={-1} className="t2f-author-nick">
              {author.nick}
            </h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-text-secondary">
              {countryName ? <span>{countryName}</span> : null}
              {isMine ? <Badge variant="you" /> : null}
              {hasPass ? (
                <span data-badge="pass" className="t2f-author-pass-badge">
                  <i aria-hidden="true">
                    <Icon name="ticket" size={12} className="[stroke-width:2.4]" />
                  </i>
                  {t('passLabel')}
                </span>
              ) : null}
            </div>
          </div>
        </header>


        {showPath ? (
          <section aria-labelledby="author-path-title" className="flex min-w-0 flex-col gap-2" data-row="path">
            <div>
              <h3 id="author-path-title" className="m-0 flex items-center gap-1.5 whitespace-nowrap t2f-author-h3">
                <span className="flex text-highlight">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="2.2 1.8" />
                    <circle cx="12" cy="12" r="4" />
                  </svg>
                </span>
                {w('pathOf', { name: author.nick })}
              </h3>
              {showCard ? <p className="text-caption text-text-secondary">{summary}</p> : null}
            </div>
            {showCard ? (
              <PathMap points={path} authorName={author.nick} summary={routeText} geometry={geometry} />
            ) : (
              <div className="relative" data-row="locked">
                <div inert>
                  <PathMap points={[]} authorName={author.nick} geometry={geometry} />
                </div>
                <div className="t2f-author-lock">
                  <p className="t2f-author-plate">
                    <span className="flex text-text-secondary">
                      <Icon name="lock" size={18} />
                    </span>
                    <span>{t.rich('noPass', { nick: author.nick, b: (chunks) => <b className="font-semibold">{chunks}</b> })}</span>
                  </p>
                </div>
              </div>
            )}
            {showCard ? <PathLegend /> : null}
            {showCard ? (
              <Radix.Root className="t2f-author-card" data-row="path-card">
                <Radix.Trigger className="t2f-focus t2f-transition t2f-author-card-trigger group">
                  <span className="flex-1">{w('viewPath')}</span>
                  <span className="t2f-author-fine font-semibold text-text-muted">{rows.length}</span>
                  <Icon name="chevron-down" size={18} className="[stroke-width:2] group-aria-expanded:rotate-180" />
                </Radix.Trigger>
                <Radix.Content className="t2f-chat-log t2f-author-card-rows" data-row="rows">
                  {met === 0 ? <p className="t2f-author-empty">{t('noMeetings')}</p> : null}
                  {rows.length ? (
                    <ol className="m-0 list-none p-0">
                      {rows.map((p, i) => {
                        const next = rows[i + 1];
                        return (
                          <li key={p.id} className="t2f-author-row" data-planned={p.planned ? '' : undefined}>
                            {i > 0 ? <span aria-hidden="true" className="t2f-author-seg" data-part="top" data-dim={p.planned ? '' : undefined} /> : null}
                            {next ? <span aria-hidden="true" className="t2f-author-seg" data-part="bottom" data-dim={next.planned ? '' : undefined} /> : null}
                            <span className="t2f-author-flag">
                              <Flag round code={p.flagCode} size="sm" name={p.country} />
                            </span>
                            <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                              <span className={cn('font-semibold', p.planned ? 'text-text-muted' : 'text-text')}>{p.city}</span>
                              <span className="text-text-muted"> · {p.country}</span>
                              {p.firstRowSeat ? <div className="t2f-author-fine font-semibold text-highlight">{t('pointSeat', { seat: p.firstRowSeat })}</div> : null}
                              {p.planned ? <div className="t2f-author-fine font-semibold text-text-muted">{w('legendSchedule')}</div> : null}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                </Radix.Content>
              </Radix.Root>
            ) : null}
          </section>
        ) : null}

        {!isMine && message && onReport ? (
          <div className="flex" data-row="actions">
            <ActionButton icon="flag" label={t('report')} muted onClick={() => onReport(message)} />
          </div>
        ) : null}
      </div>

      {!viewerHasPass ? (
        <div className="t2f-author-promo flex shrink-0 flex-col gap-2.5 border-t border-border p-3" data-row="promo">
          <p className="px-1 text-caption text-text-secondary">{t('promoText')}</p>
          <div className="flex gap-2">
            <Button variant="coral" className="t2f-author-promo-btn shrink-0" onClick={() => setNotice((v) => !v)}>
              {offers('getPass')}
            </Button>
            <Button variant="secondary" iconLeft="help" className="t2f-author-promo-btn min-w-0 flex-1" onClick={() => onPassInfo?.()}>
              {t('passMore')}
            </Button>
          </div>
          {notice ? <PaymentNotice>{offers('paymentLater')}</PaymentNotice> : null}
        </div>
      ) : null}
    </div>
  );
}
