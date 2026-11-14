'use client';

/**
 * Частини `ChatPanel` для кімнат: перемикач «Світ» / «Країна» (з меню країн для кімнати перегляду) і підпис порожньої
 * кімнати країни.
 */
import { useTranslations } from 'next-intl';
import { Flag } from '@/components/primitives/Flag';
import { SegmentedControl, type SegmentOption } from '@/components/primitives/SegmentedControl';
import { getData } from '@/lib/data/load';
import type { RoomKey } from '@/components/chat/hooks/useChatPanelRoom';

export function ChatRoomSwitcher({
  country,
  countries,
  onCountryChange,
  activeKey,
  onRoomChange,
}: {
  country?: { iso: string; name: string };
  countries?: { iso: string; name: string }[];
  onCountryChange?: (iso: string) => void;
  activeKey: RoomKey;
  onRoomChange: (key: RoomKey) => void;
}) {
  const t = useTranslations('chat');
  const multi = !!countries && countries.length > 1 && !!country;
  const options: SegmentOption[] = [
    { value: 'world', label: t('roomWorld') },
    ...(country
      ? [
          {
            value: 'country',
            label: country.iso.toUpperCase(),
            flag: country.iso,
            ariaLabel: t('roomCountryAria', { country: country.name }),
            ...(multi
              ? {
                  menu: {
                    selected: country.iso,
                    items: countries!.map((c) => ({ value: c.iso, label: c.name, flag: c.iso })),
                    onSelect: (iso: string) => {
                      onCountryChange?.(iso);
                      onRoomChange('country');
                    },
                  },
                }
              : {}),
          } satisfies SegmentOption,
        ]
      : []),
  ];
  return (
    <SegmentedControl
      label={t('roomsLabel')}
      value={activeKey}
      onValueChange={(v) => onRoomChange(v as RoomKey)}
      options={options}
    />
  );
}

/** Рядок під заголовком порожньої кімнати країни: «Тут ще нікого…» і прапор глядача. */
export function ChatEmptyCountrySub({ country, ownFlag }: { country: { iso: string; name: string }; ownFlag: string | null | undefined }) {
  const t = useTranslations('chat');
  return (
    <>
      {t('emptyCountryRoom', { country: country.name })}
      {ownFlag ? (
        <>
          {' '}
          {t('emptyCountryFlag')}{' '}
          <Flag code={ownFlag} size="xs" name={getData().countries.find((c) => c.flagCode === ownFlag)?.name.uk} className="inline-block align-text-bottom" />
        </>
      ) : null}
    </>
  );
}
