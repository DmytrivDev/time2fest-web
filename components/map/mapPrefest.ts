'use client';

/**
 * Мапа поясів «до свята» (головна `/before`, рішення власника 2026-11-17): та сама мапа, масштаб і вікна поясу й країни,
 * але без трансляцій, кімнат, штампів і графіка. Вікно поясу — час і країни поясу; вікно країни — час, пояси країни,
 * традиції й «Сторінка країни» лише для країн з описом, «Додати в календар» — файлом події.
 * `ZoneMap` ставить цей контекст, коли отримує проп `prefest`; без нього все як на живій мапі.
 */
import { createContext, useContext } from 'react';
import type { MapCountry, MapZone } from '@/lib/map/model';

export interface MapPrefest {
  /** «Додати в календар» у вікні країни (без обробника кнопки немає). */
  onCountryCalendar?: (zone: MapZone, country: MapCountry) => void;
}

export const MapPrefestContext = createContext<MapPrefest | null>(null);

/** Режим «до свята» або `null` (жива мапа). */
export function useMapPrefest(): MapPrefest | null {
  return useContext(MapPrefestContext);
}
