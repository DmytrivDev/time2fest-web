import type { EventCardData } from '@/components/live/EventCard';

/** Сцена історій: «зараз» = 23:50 UTC 31 грудня (Лондон у ефірі, Париж — позаду). */
export const SCENE_NOW = '2026-12-31T23:50:00Z';
export const sceneTime = { at: SCENE_NOW, frozen: true } as const;

const utc = (iso: string) => Date.parse(iso);

export const PARIS: EventCardData = {
  id: 'evt_paris',
  title: 'Париж · Берлін · Рим',
  countryName: 'Франція',
  flagCode: 'FR',
  midnightMs: utc('2026-12-31T23:00:00Z'),
  celebrationType: 'main',
  stream: 'live',
  href: '/fr',
};
export const LONDON: EventCardData = {
  id: 'evt_london',
  title: 'Лондон',
  countryName: 'Велика Британія',
  flagCode: 'GB-ENG',
  midnightMs: utc('2027-01-01T00:00:00Z'),
  celebrationType: 'main',
  stream: 'live',
  href: '/gb',
};
export const AZORES: EventCardData = {
  id: 'evt_azores',
  title: 'Азорські острови',
  countryName: 'Португалія',
  flagCode: 'PT',
  midnightMs: utc('2027-01-01T01:00:00Z'),
  celebrationType: 'webcam',
  stream: 'expected',
  href: '/pt',
};
export const CAPE_VERDE: EventCardData = {
  id: 'evt_cabo_verde',
  title: 'Кабо-Верде',
  flagCode: 'CV',
  midnightMs: utc('2027-01-01T01:00:00Z'),
  celebrationType: 'countdown-only',
  stream: 'countdown-only',
  href: '/cv',
};
export const RIO: EventCardData = {
  id: 'evt_rio',
  title: 'Ріо-де-Жанейро',
  countryName: 'Бразилія',
  flagCode: 'BR',
  midnightMs: utc('2027-01-01T03:00:00Z'),
  celebrationType: 'main',
  stream: 'possible',
  href: '/br',
};
export const BUENOS_AIRES: EventCardData = {
  id: 'evt_ba',
  title: 'Буенос-Айрес',
  countryName: 'Аргентина',
  flagCode: 'AR',
  midnightMs: utc('2027-01-01T03:00:00Z'),
  celebrationType: 'tv',
  stream: 'live',
  href: '/ar',
};
export const NEW_YORK: EventCardData = {
  id: 'evt_ny',
  title: 'Нью-Йорк',
  countryName: 'США',
  flagCode: 'US',
  midnightMs: utc('2027-01-01T05:00:00Z'),
  celebrationType: 'main',
  stream: 'expected',
  href: '/us',
};
export const MEXICO: EventCardData = {
  id: 'evt_mx',
  title: 'Мехіко',
  countryName: 'Мексика',
  flagCode: 'MX',
  midnightMs: utc('2027-01-01T06:00:00Z'),
  celebrationType: 'webcam',
  stream: 'possible',
  href: '/mx',
};
export const HONOLULU: EventCardData = {
  id: 'evt_hnl',
  title: 'Гонолулу',
  countryName: 'США',
  flagCode: 'US',
  midnightMs: utc('2027-01-01T10:00:00Z'),
  celebrationType: 'main',
  stream: 'expected',
  href: '/us-hi',
};
export const SAMOA: EventCardData = {
  id: 'evt_samoa',
  title: 'Паго-Паго',
  countryName: 'Американське Самоа',
  flagCode: 'AS',
  midnightMs: utc('2027-01-01T11:00:00Z'),
  celebrationType: 'countdown-only',
  stream: 'countdown-only',
  href: '/as',
};

export const STRIP: EventCardData[] = [
  PARIS,
  LONDON,
  AZORES,
  CAPE_VERDE,
  { ...RIO, inSchedule: true },
  BUENOS_AIRES,
  NEW_YORK,
  MEXICO,
  HONOLULU,
  SAMOA,
];

export const TRADITIONS = [
  { id: 't1', title: 'Ле Ревейон', text: 'Довга святкова вечеря з родиною й друзями: устриці, фуа-гра, шампанське.', iconId: 'dinner' },
  { id: 't2', title: 'Поцілунок під омелою', text: 'Опівночі цілуються під гілкою омели — на щастя й удачу в новому році.', iconId: 'mistletoe' },
  { id: 't3', title: '«Bonne année!»', text: 'Так вітаються опівночі й увесь січень. Напиши це в чат країни — тобі відповідять.', iconId: 'greeting' },
  { id: 't4', title: 'Листівки', text: '1 січня надсилають новорічні листівки рідним і колегам.', iconId: 'cards' },
];

export const ZONE_COUNTRIES = [
  { iso: 'FR', name: 'Франція', flagCode: 'FR' },
  { iso: 'DE', name: 'Німеччина', flagCode: 'DE' },
  { iso: 'IT', name: 'Італія', flagCode: 'IT' },
  { iso: 'ES', name: 'Іспанія', flagCode: 'ES' },
  { iso: 'PL', name: 'Польща', flagCode: 'PL' },
  { iso: 'CZ', name: 'Чехія', flagCode: 'CZ' },
  { iso: 'AT', name: 'Австрія', flagCode: 'AT' },
  { iso: 'CH', name: 'Швейцарія', flagCode: 'CH' },
  { iso: 'NO', name: 'Норвегія', flagCode: 'NO' },
];
