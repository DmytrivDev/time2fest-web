export declare const SITE_ORIGIN: string;
export function localePath(locale: string, route: string): string;
export function openRoutes(locales: string[], countriesIndexed?: boolean): string[];
export function sitemapXml(locales: string[], countriesIndexed?: boolean): { count: number; text: string };
export function robotsTxt(index: boolean): string;
export function redirectsFile(): { count: number; dynamic: number; text: string };
export function headersForIndex(text: string): string;
