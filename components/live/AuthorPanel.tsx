'use client';

/**
 * C13 AuthorPanel — O-AUTHOR (FR-055; макети `Desk-Author`, `Phone-Author`, `Phone-Author-NoPass`, `Phone-Author-States`).
 * Немодальне вікно: десктоп — `ChatSlotPanel` на місці колонки чату, телефон — Sheet під плеєром (розміщення й шапку
 * «‹ Назад · Автор повідомлення» дає `OverlayManager`, `chrome: 'author'`). Тіло прокручується саме, плашка пасу внизу закріплена.
 * Зверху вниз: автор (круглий прапор 40 px, нік, країна, «Новорічний пас») ·
 * «Шлях <нік>» + підсумок · мініатюра `PathMap` з легендою · картка «Переглянути шлях» (зустрінуті, далі заплановані;
 * прапори з’єднані пунктиром) · «Поскаржитись» (повідомлення, «Відповісти» і «Згадати» — у меню «⋯») · плашка «Оформи Новорічний пас» (глядач без пасу).
 * Стани автора: пас і зустрічі · пас, але ще нічого · без пасу (картки немає, мапа затемнена з плашкою) · пас, але шлях
 * приховано («Показувати мій шлях» вимкнено — та сама плашка з «закритим оком») · свій нік —
 * «Ти» поруч з ніком, мапа й «Переглянути шлях» завжди (зі штампів і «Мого графіка»; нічого — порожня мапа), без «Поскаржитись».
 * Десктоп: картка природної висоти, прокручується вся панель; телефон: відкрита картка 232 px з власною прокруткою.
 * Мапа — як мапа шляху графіка й паспорта, лише зменшена (правка власника 2026-11-09): пояси підсвічені за станом від
 * поточного часу (як на головній), кілька точок одного поясу — вузол і промені. Зустрінуті країни золотом НЕ заливаємо
 * (правка власника 2026-11-10: жовтий шлях зливався з заливкою; на графіку й у паспорті заливка лишається).
 * «Поскаржитись» (правка власника 2026-11-10): на місці кнопки підтвердження
 * «Дякуємо, скаргу передано» (той самий текст, що з меню повідомлення; `role="status"` — зчитувач озвучує).
 */
import { Collapsible as Radix } from 'radix-ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { StatusMessage } from '@/components/primitives/StatusMessage';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { useChatColumn } from '@/components/shell/OverlayManager';
import { pathSummary, routeCities, type PathPoint } from '@/lib/chat-sim/authorPath';
import { getData } from '@/lib/data/load';
import type { Author, ChatMessage } from '@/lib/data/types';
import { zoneState } from '@/lib/engine/zoneState';
import { useNow } from '@/lib/time/TimeProvider';
import { PathLegend, PathMap } from './PathMap';
import type { ZoneMapGeometry } from './MapModel';
import './AuthorPanel.css';

export interface AuthorPanelProps {
  author: Author;
  /** Назва країни прапора автора («Єгипет»). */
  countryName?: string;
  /** Повідомлення, яке відкрили (для «Поскаржитись»); немає — скарга на автора. */
  message?: ChatMessage;
  /** Автор має пас (показуємо шлях). */
  hasPass: boolean;
  /** Автор з пасом вимкнув «Показувати мій шлях»: мапа затемнена з плашкою «{нік} приховав свій шлях». */
  routeHidden?: boolean;
  /** Шлях автора (зустрінуті й заплановані); порожній з пасом — «зустрічей ще нема». */
  path?: readonly PathPoint[];
  /** У глядача є пас: плашку «Оформи пас» не показуємо. */
  viewerHasPass?: boolean;
  /** «Поскаржитись»: підтвердження панель показує сама; обробник — передати скаргу (повідомлення, якщо є). */
  onReport?: (message: ChatMessage | undefined) => void;
  /** «Що ще дає пас?» — відкрити опис пасу. */
  onPassInfo?: () => void;
  /** «Оформити пас» — оформлення (вікно під трансляцією чи сторінка пасу). */
  onGetPass?: () => void;
  /** Своє повідомлення: олівець біля ніка — змінити нік і прапор (O-NICK). */
  onEditProfile?: () => void;
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
  routeHidden = false,
  path = [],
  viewerHasPass = false,
  onReport,
  onPassInfo,
  onGetPass,
  onEditProfile,
  geometry,
  className,
}: AuthorPanelProps) {
  const t = useTranslations('chat.author');
  const chatT = useTranslations('chat');
  const w = useTranslations('windows.author');
  const offers = useTranslations('offers');
  const column = useChatColumn();
  const isMine = !!author.isMine;
  const showCard = isMine || (hasPass && !routeHidden);
  const { met, planned } = pathSummary(path);
  const rows = orderedRows(path);
  const route = routeCities(path);
  const routeText = [route.met.join(' → '), route.planned.length ? t('routeNext', { cities: route.planned.join(', ') }) : ''].filter(Boolean).join(' · ');
  const plannedPart = planned ? t('summaryPlanned', { count: planned }) : '';
  const summary = [met ? t('summaryMet', { count: met }) : t('summaryNone'), plannedPart].filter(Boolean).join(' · ');
  // Стан поясів — як на мапі головної й «Моєму графіку»: від поточного часу (до гідрації — усі «попереду»).
  const now = useNow({ granularity: 'minute' });
  const zoneStates = useMemo(() => {
    const zones = getData().zones;
    return Object.fromEntries(zones.map((z) => [z.id, now > 0 ? zoneState(now, z, zones) : 'future'] as const));
  }, [now]);
  // Скарга — на цього автора й це повідомлення: панель, перевідкрита на іншу людину, знову показує кнопку.
  const reportKey = `${author.id}|${author.nick}|${message?.id ?? ''}`;
  const [reportedKey, setReportedKey] = useState<string | null>(null);
  const reported = reportedKey === reportKey;
  const report = () => {
    setReportedKey(reportKey);
    onReport?.(message);
  };

  return (
    <div data-window="O-AUTHOR" data-pass={hasPass ? 'yes' : 'no'} data-author-compact={column ? 'false' : 'true'} className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)}>
      <div className="t2f-chat-log t2f-author-body" data-row="body">
        <header className="flex items-center gap-3">
          <Flag round code={author.flagCode} size="xl" name={countryName} decorative={!countryName} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2">
              <h2 tabIndex={-1} className="t2f-author-nick">
                {author.nick}
              </h2>
              {isMine && onEditProfile ? (
                <button
                  type="button"
                  aria-label={t('editProfile')}
                  onClick={onEditProfile}
                  className="t2f-focus t2f-transition t2f-author-edit"
                  data-row="edit-profile"
                >
                  <Icon name="pencil" size={18} />
                </button>
              ) : null}
              {isMine ? <Badge variant="you" /> : null}
            </div>
            {/* Один рядок: довга назва країни («Демократична Республіка Конго») — з трикрапкою, позначка завжди ціла. */}
            <div className="flex min-w-0 items-center gap-x-2 text-caption text-text-secondary">
              {countryName ? (
                <span className="min-w-0 truncate" title={countryName} data-row="country">
                  {countryName}
                </span>
              ) : null}
              {hasPass ? (
                <span data-badge="pass" className="t2f-author-pass-badge shrink-0">
                  <i aria-hidden="true">
                    <Icon name="ticket" size={12} className="[stroke-width:2.4]" />
                  </i>
                  {t('passLabel')}
                </span>
              ) : null}
            </div>
          </div>
        </header>


        <section aria-labelledby="author-path-title" className="flex min-w-0 flex-col gap-2" data-row="path">
            <div>
              <h3 id="author-path-title" className="m-0 flex items-center gap-1.5 whitespace-nowrap t2f-author-h3">
                <span className="flex text-highlight">
                  <svg width="1rem" height="1rem" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="2.2 1.8" />
                    <circle cx="12" cy="12" r="4" />
                  </svg>
                </span>
                {w('pathOf', { name: author.nick })}
              </h3>
              {showCard ? <p className="text-caption text-text-secondary">{summary}</p> : null}
            </div>
            {showCard ? (
              <PathMap
                points={path}
                authorName={author.nick}
                summary={routeText}
                geometry={geometry}
                zoneStates={zoneStates}
              />
            ) : (
              <div className="relative" data-row="locked">
                <div inert>
                  <PathMap points={[]} authorName={author.nick} geometry={geometry} zoneStates={zoneStates} />
                </div>
                <div className="t2f-author-lock">
                  <p className="t2f-author-plate" data-row={routeHidden ? 'route-hidden' : 'no-pass'}>
                    <span className="flex text-text-secondary">
                      <Icon name={routeHidden ? 'eye-off' : 'lock'} size={18} />
                    </span>
                    <span>
                      {t.rich(routeHidden ? 'routeHidden' : 'noPass', { nick: author.nick, b: (chunks) => <b className="font-semibold">{chunks}</b> })}
                    </span>
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
                <Radix.Content className="t2f-acc-content">
                  <div className="t2f-chat-log t2f-author-card-rows" data-row="rows">
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
                              {p.planned ? <div className="t2f-author-fine font-semibold text-text-muted">{w('legendSchedule')}</div> : null}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                  </div>
                </Radix.Content>
              </Radix.Root>
            ) : null}
          </section>

        {!isMine ? (
          <div className="flex" data-row="actions">
            {reported ? (
              <div className="w-full" data-row="reported">
                <StatusMessage kind="success">{chatT('reportedVisible')}</StatusMessage>
              </div>
            ) : (
              <ActionButton icon="flag" label={t('report')} muted onClick={report} />
            )}
          </div>
        ) : null}
      </div>

      {!viewerHasPass ? (
        <div className="t2f-author-promo flex shrink-0 flex-col gap-2.5 border-t border-border p-3" data-row="promo">
          <p className="px-1 text-caption text-text-secondary">{t('promoText')}</p>
          <div className="flex gap-2">
            <Button variant="coral" className="t2f-author-promo-btn shrink-0" onClick={() => onGetPass?.()}>
              {offers('getPass')}
            </Button>
            <Button variant="secondary" iconLeft="help" className="t2f-author-promo-btn min-w-0 flex-1" onClick={() => onPassInfo?.()}>
              {t('passMore')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
