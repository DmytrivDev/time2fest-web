'use client';

/**
 * Кімната перегляду (S-ROOM, US3) — новий дизайн (дошки `Desk-Room-New`, `Phone-Room-New`, `Desk-Room-Notices`,
 * концепція `room-concept-2026-11-05.md`, власник 2026-11-05).
 *
 * Згори нічого: одразу вікна (1 — на всю ширину, 2–4 — сітка 2×2, вільні місця — плашки розміром із вікно; порожня
 * кімната — 4 місця, телефон — одне). Під вікнами — «Кімната перегляду · N з 4», відлік до найближчої півночі у вікнах і
 * рядок дій: «Додати / Замінити трансляцію», «Поділитися», «Режим вечірки», «⋯». Далі — обіцянка штампа, штамп
 * (головного вікна + «Ще в кімнаті»), пас, «Поточні трансляції», «Як працює кімната». «Перший ряд» прибрано
 * (рішення власника 2026-11-12); на його місці — смуга тостів (`ToastStrip`) одразу під рядком дій кімнати.
 *
 * Вікна:
 * - позиція в сітці = порядок `guest.room.windows`; перше — головне (штамп, чат країни). DOM вікон не переставляємо
 *   (CSS `order`), тож перетягування за смугу не перезапускає плеєри;
 * - спільний `PlayerHost` макета сидить у вікні `hostSlot` (не обов’язково першому): лише він має автозапуск (FR-040);
 *   вікна 2–4 — `RoomWindowPlayer`, стартують після дії людини, без звуку;
 * - звук в одному вікні: «Звук сюди», клавіші 1–4; звук, увімкнений кнопкою самого плеєра, кімната переносить туди.
 * Сповіщення — там, де сталася дія: прибране вікно 6 с лишається плиткою «Повернути» (десктоп; телефон — під рядком
 * дій), заміна — 6 с у смузі вікна. Кімната повна → «Що замінити?» у колонці чату / шторці (лише там).
 * Телефон: розгорнутий чат при 2 вікнах згортає вікно без звуку (пауза); горизонтально — два вікна поруч (CSS).
 *
 * Файл — лише склад: стан і ефекти розкладено по хуках `useRoom*` / `useSharedRoomLink`, розмітку — по
 * `RoomWindowsGrid`, `RoomInfoBar`, `RoomCurrentStreams` (WP-F).
 */
import { RoomSkeleton } from '@/components/skeleton/LiveSkeletons';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import { useLiveChat } from '@/components/chat/hooks/useLiveChat';
import { useStamps } from '@/lib/api/hooks/passport';
import { useLiveData } from '@/lib/api/hooks/live';
import type { EventFilterValue } from '@/components/live/EventFilter';
import { MomentInflow } from '@/components/live/MomentInflow';
import { StampBlock } from '@/components/stamp/StampBlock';
import { useOfferWindows } from '@/components/offers/useOfferWindows';
import { ToastStrip } from '@/components/toast/ToastStrip';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { useChatColumn } from '@/components/shell/OverlayManager';
import type { GuestRoomWindow } from '@/lib/data/types';
import { cityOf } from '@/lib/live/cityOf';
import { useOptionalPlayer, useOptionalPlayerActions } from '@/lib/player/PlayerProvider';
import { useNow, useTimeReady } from '@/lib/time/TimeProvider';
import { roomLimit, useRoom, useRoomStore } from '@/stores/room';
import { RoomCurrentStreams } from './parts/RoomCurrentStreams';
import { RoomHowTo } from './parts/RoomHowTo';
import { RoomInfoBar } from './parts/RoomInfoBar';
import { RoomWindowsGrid } from './parts/RoomWindowsGrid';
import { roomCountdown } from './roomCountdown';
import { sourceTitle } from './roomShare';
import { RoomPageContext } from './hooks/useRoomToggle';
import { useRoomActions } from './hooks/useRoomActions';
import { useRoomChatCountries } from './hooks/useRoomChatCountries';
import { useRoomFold } from './hooks/useRoomFold';
import { useRoomHostPlayer } from './hooks/useRoomHostPlayer';
import { useRoomLiveStreams } from './hooks/useRoomLiveStreams';
import { useRoomPicker } from './hooks/useRoomPicker';
import { useRoomShare } from './hooks/useRoomShare';
import { useRoomSound } from './hooks/useRoomSound';
import { useRoomViewport } from './hooks/useRoomViewport';
import { useSharedRoomLink } from './hooks/useSharedRoomLink';
import s from './room.module.css';
import { useHasPass, useSchedule } from '@/lib/api/hooks/auth';

export function RoomLive() {
  const t = useTranslations('room.page');
  const tUndo = useTranslations('room.undo');
  const tCommon = useTranslations('common');
  const tChat = useTranslations('chat');
  const data = useLiveData();
  const player = useOptionalPlayer();
  const actions = useOptionalPlayerActions();
  const viewport = useRoomViewport();
  const phone = viewport === 'phone';
  const limit = roomLimit(viewport);
  const chatColumn = useChatColumn();
  const ready = useTimeReady();
  const now = useNow();
  const known = ready && now > 0;
  const minute = Math.floor(now / 60_000) * 60_000;
  const passWindows = useOfferWindows();

  const room = useRoom();
  const { started, hostSlot } = useRoomStore();
  const schedule = useSchedule();
  const stamps = useStamps();
  const hasPass = useHasPass();

  // На телефоні видно до 2 вікон (збережені з десктопа 3–4 лишаються в `guest.room`).
  const windows = useMemo(() => room.windows.slice(0, limit), [room.windows, limit]);
  const soundSlot = windows.some((w) => w.slot === room.soundSlot)
    ? room.soundSlot
    : (windows[0]?.slot ?? null);
  const main = windows[0] ?? null;
  const host = windows.find((w) => w.slot === hostSlot) ?? main;
  const soundWindow = windows.find((w) => w.slot === soundSlot) ?? main;

  const { sharedMore, setSharedMore } = useSharedRoomLink({ known, data, limit });
  useRoomHostPlayer({ known, data, viewport, host, hostSlot, windows, player, actions });

  const titleOf = useCallback(
    (w: Pick<GuestRoomWindow, 'eventId' | 'sourceId'>) => sourceTitle(data, w),
    [data],
  );
  const { isHost, applySound, soundLive, moveSound } = useRoomSound({
    windows,
    soundSlot,
    host,
    player,
    actions,
    titleOf,
  });
  const { undo, barNotice, remove, doUndo, replaceInto, undoReplace, drag, start } = useRoomActions({
    windows,
    soundSlot,
    soundLive,
    limit,
    viewport,
    main,
    applySound,
    titleOf,
  });
  const { roomZoneId, liveRows, slotState } = useRoomLiveStreams({
    data,
    known,
    now,
    minute,
    main,
    roomWindows: room.windows,
  });
  const { add, toggleFromCard, openPicker } = useRoomPicker({
    windows,
    soundSlot,
    soundLive,
    viewport,
    phone,
    limit,
    main,
    data,
    now,
    liveRows,
    passWindows,
    titleOf,
    remove,
    replaceInto,
  });
  const { openShare, toggleMore } = useRoomShare({ windows, data, titleOf });
  const { eventIds, mainEvent, windowCountries, country, chatRoomCountry, setPickedIso } =
    useRoomChatCountries({ windows, main, data });
  const { nextMidnight, nextCities, timerText, stampCities } = roomCountdown({
    windows,
    data,
    known,
    now,
    stamps,
  });

  const chat = useLiveChat({
    chatColumn,
    room: chatRoomCountry ?? 'world',
    roomLabel: country ? tChat('roomCountryPicker', { country: country.name.uk }) : tChat('roomWorld'),
    panel: {
      country: country ? { iso: country.iso, name: country.name.uk } : undefined,
      countries: windowCountries,
      onCountryChange: setPickedIso,
    },
  });
  const { foldSlot, unfold } = useRoomFold({ phone, windows, soundSlot, started, isHost, actions });

  // «Поточні трансляції» — картки подій із трансляцією зараз; «+» — одразу у вікно.
  const [currentFilter, setCurrentFilter] = useState<EventFilterValue>('all');
  const zoneMidnight = liveRows[0]?.midnightMs ?? mainEvent?.midnightMs;
  const roomCtx = useMemo(() => ({ toggle: toggleFromCard }), [toggleFromCard]);

  // До готовності часу (статичний HTML до гідратації) сервер не знає ні розміру екрана, ні вікон кімнати — показував
  // 2×2 порожніх вікон і на телефоні. Тепер — той самий скелетон, що при переході (`room/loading.tsx`, 2026-11-10).
  if (!known) return <RoomSkeleton />;

  return (
    <RoomPageContext.Provider value={roomCtx}>
      {/* Десктоп: вікна на рівні з верхом чату, без бічних відступів (власник 2026-11-07); телефон — як було. */}
      <div data-room-page="" className={cn('flex flex-col', s.page)}>
        <RoomWindowsGrid
          data={data}
          known={known}
          now={now}
          minute={minute}
          phone={phone}
          windows={windows}
          player={player}
          schedule={schedule}
          stamps={stamps}
          started={started}
          soundSlot={soundSlot}
          soundLive={soundLive}
          isHost={isHost}
          titleOf={titleOf}
          undo={undo}
          barNotice={barNotice}
          drag={drag}
          foldSlot={foldSlot}
          slotState={slotState}
          passWindows={passWindows}
          onStart={start}
          onUnfold={unfold}
          onUndo={doUndo}
          onUndoReplace={undoReplace}
          onRemove={remove}
          onSound={(slot) => moveSound(slot, { apply: true })}
          onAdd={openPicker}
        />
        <RoomInfoBar
          phone={phone}
          count={windows.length}
          limit={limit}
          soundLive={soundLive}
          soundTitle={soundWindow ? titleOf(soundWindow) : ''}
          nextMidnight={nextMidnight}
          nextCities={nextCities}
          timerText={timerText}
          chatButton={chat.showButton}
          onAdd={openPicker}
          onShare={openShare}
          onMore={toggleMore}
        />
        {/* Смуга тостів — під вікнами й рядком дій кімнати, та сама, що на головній (дошки `Desk-Toast-New`,
            `Phone-Toast-New`, 2026-11-12). */}
        <ToastStrip variant={chatColumn ? 'desk' : 'phone'} bare className={s.toastStrip} />
        {phone && sharedMore !== null && sharedMore > limit && !undo ? (
          // Перевірка дошок 2026-11-14: посилання з 3–4 вікнами на телефоні показувало 2 без пояснення.
          <div className={s.notice} role="status" data-room-notice="shared-phone">
            <Icon name="info" size={18} />
            <span className={s.noticeText}>{t('sharedPhoneNotice', { count: sharedMore, hidden: sharedMore - limit })}</span>
            <IconButton aria-label={tCommon('close')} icon="close" onClick={() => setSharedMore(null)} />
          </div>
        ) : null}
        {phone && undo ? (
          <div className={s.notice} role="status" data-room-notice="">
            <Icon name="check" size={18} />
            <span className={s.noticeText}>{t('removed', { city: cityOf(undo.title) })}</span>
            <Button variant="ghost" compact iconLeft="undo" onClick={doUndo}>
              {tUndo('undo')}
            </Button>
            <span className={cn(s.progress, s.progressGrey)} aria-hidden="true" />
          </div>
        ) : null}
        {stampCities.length ? (
          <p className={s.promise} data-room-promise="">
            <Icon name="stamp" size={18} className="text-text-muted" />
            {t('promise', { cities: stampCities.join(', ') })}
          </p>
        ) : null}
        <div className="mt-8 flex flex-col gap-4">
          {/* Штамп у кімнаті закривається «×» (постійний — лише на сторінці країни, власник 2026-11-06). */}
          <MomentInflow stamp={<StampBlock eventId={main?.eventId ?? null} roomEventIds={eventIds} />} label={t('heading')} />
        </div>
        <RoomCurrentStreams
          data={data}
          roomZoneId={roomZoneId}
          zoneMidnight={zoneMidnight}
          liveRows={liveRows}
          schedule={schedule}
          hasPass={hasPass}
          filter={currentFilter}
          onFilterChange={(v) =>
            v === 'mine' && !hasPass ? passWindows.openPassInfoBoard() : setCurrentFilter(v)
          }
          onToggle={toggleFromCard}
          onAdd={add}
        />
        <RoomHowTo className="mt-10" />
        {chatColumn ? chat.column : chat.dock}
      </div>
    </RoomPageContext.Provider>
  );
}
