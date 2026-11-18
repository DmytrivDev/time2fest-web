'use client';

/**
 * C19. «Країни й міста» (S-COUNTRIES / S-LIST) — довідник країн за поясами (рішення власника 2026-11-04, дошка
 * `Desk-Countries-Next`, вайрфрейм v2). Що зараз і що далі дивитися — на головній; тут — знайти країну, побачити, коли там
 * північ і чи є трансляція, і перейти на її сторінку.
 *
 * Зверху вниз: `h1` і підзаголовок з датою й часом гостя · пошук, фільтр «Усі · З трансляціями · Мій графік» (як у «Зараз і
 * далі»), «Мапа | Список» · список: рядки поясів — ті самі, що у «Списку» на головній (п’ять прапорців і «ще N»), усі 38 по
 * черзі, «Вже зустріли» — згорнуто внизу; на старті всі згорнуті. Розгорнутий пояс — один рядок про пояс і повний список
 * країн за регіонами великими картками зі статусом; клік по картці — сторінка країни. Пошук і фільтри звужують рядки й
 * картки: лишаються пояси зі збігами, розгорнуті. «Мапа» — компонент головної. Колонка чату — як на головній.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useLiveChat } from '@/components/chat/hooks/useLiveChat';
import { useOfferWindows } from '@/components/offers/useOfferWindows';
import { useGetPass } from '@/components/pass/PassWindow';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { useChatColumn } from '@/components/shell/OverlayManager';
import { useChatRooms } from '@/lib/api/hooks/chat';
import { formatUsd, PASS_PRICE } from '@/lib/offers/format';
import { usePhone } from '@/lib/hooks/useMedia';
import nn from '@/components/live/nowNext.module.css';
import { useHasPass, useSchedule } from '@/lib/api/hooks/auth';
import { CountriesView, type CountryListProps } from './CountriesView';

export { matchCountry, orderCountries, type CountryListProps } from './CountriesView';

/** Сторінка свята: довідник (`CountriesView`) + чат «Світ», вікна паса й графіка, «Мій графік». */
export function CountryList(props: CountryListProps) {
  const tNN = useTranslations('liveCards.nowNext');
  const tChat = useTranslations('chat');
  const hasPass = useHasPass();
  const schedule = useSchedule();
  const phone = usePhone();
  const chatColumn = useChatColumn();
  const chat = useLiveChat({
    chatColumn,
    room: 'world',
    roomLabel: tChat('roomWorld'),
    panel: { startInWorld: true },
  });
  const passWindows = useOfferWindows();
  const getPass = useGetPass();
  useChatRooms(useMemo(() => ['world' as const], []));

  const lockedBar = (
    <div
      role="status"
      data-row="mine-locked"
      className={cn(nn.lockedBar, phone && nn.lockedBarStack)}
    >
      <Icon name="lock" size={18} className="mt-0.5 shrink-0 text-highlight" />
      <p className={nn.lockedText}>
        {tNN.rich('mineLockedText', { b: (c) => <b className="font-bold">{c}</b> })}
      </p>
      <span className={nn.lockedActions}>
        <Button
          variant="coral"
          compact
          iconLeft="ticket"
          data-action="get-pass"
          onClick={() => getPass()}
        >
          {tNN('mineLockedGet', { price: formatUsd(PASS_PRICE) })}
        </Button>
        <Button
          variant="tonal"
          compact
          data-action="pass-info"
          onClick={passWindows.openPassInfoBoard}
        >
          {tNN('mineLockedButton')}
        </Button>
      </span>
    </div>
  );

  return (
    <CountriesView
      {...props}
      headerAside={chat.showButton}
      hasPass={hasPass}
      schedule={schedule}
      lockedBar={lockedBar}
      onToggleSchedule={passWindows.requestSchedule}
    >
      {chat.column}
      {chat.dock}
    </CountriesView>
  );
}
