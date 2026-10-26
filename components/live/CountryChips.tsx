'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Chip, ChipGroup } from '@/components/primitives/Chip';

export interface CountryChipItem {
  iso: string;
  /** Назва країни, як є (без відмінювання). */
  name: string;
  flagCode: string;
}

export interface CountryChipsProps {
  countries: readonly CountryChipItem[];
  /** Країна, що зараз у плеєрі. */
  selectedIso?: string;
  onSelect?: (iso: string) => void;
  /** Скільки чипів показати до «Ще N». */
  visibleCount?: number;
  defaultExpanded?: boolean;
  className?: string;
}

/** Ряд чипів країн поясу: прапор і назва; решта ховається за «Ще N». */
export function CountryChips({ countries, selectedIso, onSelect, visibleCount = 6, defaultExpanded = false, className }: CountryChipsProps) {
  const t = useTranslations('nav');
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hiddenCount = Math.max(0, countries.length - visibleCount);
  const shown = expanded || hiddenCount === 0 ? countries : countries.slice(0, visibleCount);

  return (
    <ChipGroup label={t('countriesOfZone')} className={className} data-country-chips="">
      {shown.map((c) => (
        <Chip
          key={c.iso}
          variant="country"
          flag={c.flagCode}
          selected={c.iso === selectedIso}
          onSelectedChange={() => onSelect?.(c.iso)}
        >
          {c.name}
        </Chip>
      ))}
      {hiddenCount > 0 ? (
        <Chip variant="more" count={hiddenCount} expanded={expanded} onClick={() => setExpanded((v) => !v)} />
      ) : null}
    </ChipGroup>
  );
}
