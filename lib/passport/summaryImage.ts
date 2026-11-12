/**
 * Картки «Поділитися шляхом» і «Поділитися паспортом» (функції пасу; рішення власника 2026-11-07, дошка
 * `Desk-Passport-New`, кадр 4): SVG для вікна O-SHARE (9:16 і 1:1), як картка штампа.
 * «Мої Нові роки» — мапа з поясами й відвіданими країнами золотом, шлях через вузли, чотири числа, маршрут і прапори.
 * Паспорт — числа й список штампів (прапор, місто, країна). Кольори — художні (зображення, не інтерфейс).
 */
import type { ZoneMapGeometry } from '@/components/live/MapModel';
import { pointToPercent } from '@/components/live/MapModel';
import type { PathPoint } from '@/lib/chat-sim/authorPath';
import { SHARE_SIZE, type ShareRatio } from '@/lib/offers/shareImage';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FONT = "font-family=\"Manrope, 'Segoe UI', Arial, sans-serif\"";
const ZONE_FILL = { past: '#2a2a2f', live: '#7a3236', next: '#4f3a2c', future: '#4f3a2c' } as const;

export interface SummaryText {
  kicker: string;
  name: string;
  stats: { value: string; label: string }[];
  route: string;
  brand: string;
}

export interface SummaryMap {
  geometry: ZoneMapGeometry;
  zoneStates: Readonly<Record<string, 'past' | 'live' | 'next' | 'future'>>;
  visited: readonly { zoneId: string; iso: string }[];
  points: readonly PathPoint[];
}

/** Мапа шляху як вкладений SVG (для картки). */
export function mapSvg(map: SummaryMap, x: number, y: number, w: number): { svg: string; h: number } {
  const { meta } = map.geometry;
  const h = Math.round((w * meta.height) / meta.width);
  const vis = new Set(map.visited.map((v) => `${v.zoneId}:${v.iso}`));
  let paths = '';
  for (const z of map.geometry.zones) {
    const st = map.zoneStates[z.zoneId] ?? 'future';
    paths += `<path d="${z.countries.map((c) => c.d).join('')}" fill="${ZONE_FILL[st]}" stroke="#121214" stroke-width="0.8"/>`;
    for (const c of z.countries) if (vis.has(`${z.zoneId}:${c.iso}`)) paths += `<path d="${c.d}" fill="#E9C766" stroke="#FCE286" stroke-width="1.4"/>`;
  }
  const px = (p: PathPoint) => {
    const pos = pointToPercent(p, meta);
    return { x: (pos.left / 100) * meta.width, y: (pos.top / 100) * meta.height };
  };
  const met = map.points.filter((p) => !p.planned);
  const route = met.filter((p) => !p.hubOf);
  let lines = '';
  for (let i = 1; i < route.length; i++) {
    const a = px(route[i - 1]!);
    const b = px(route[i]!);
    lines += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#FCE286" stroke-width="4" stroke-dasharray="10 8" stroke-linecap="round"/>`;
  }
  for (const p of met.filter((x) => x.hubOf)) {
    const hub = met.find((x) => x.id === p.hubOf);
    if (!hub) continue;
    const a = px(hub);
    const b = px(p);
    lines += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#FCE286" stroke-width="3" stroke-dasharray="4 6"/>`;
  }
  const dots = met.map((p) => {
    const c = px(p);
    return `<circle cx="${c.x}" cy="${c.y}" r="${p.hubOf ? 6 : 10}" fill="#FCE286" stroke="#121214" stroke-width="3"/>`;
  });
  return {
    svg: `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${meta.width} ${meta.height}"><rect width="100%" height="100%" fill="#121214"/>${paths}${lines}${dots.join('')}</svg>`,
    h,
  };
}

function statsSvg(stats: SummaryText['stats'], x: number, y: number, w: number, cols: number): { svg: string; h: number } {
  const gap = 20;
  const cw = (w - gap * (cols - 1)) / cols;
  const ch = 150;
  let out = '';
  stats.forEach((s, i) => {
    const cx = x + (i % cols) * (cw + gap);
    const cy = y + Math.floor(i / cols) * (ch + gap);
    out += `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="22" fill="#FFFFFF" fill-opacity="0.07"/>`;
    out += `<text x="${cx + 28}" y="${cy + 78}" fill="#FCE286" font-size="68" font-weight="800">${esc(s.value)}</text>`;
    out += `<text x="${cx + 28}" y="${cy + 120}" fill="#B4B4BC" font-size="30" font-weight="600">${esc(s.label)}</text>`;
  });
  const rows = Math.ceil(stats.length / cols);
  return { svg: out, h: rows * ch + (rows - 1) * gap };
}

function flagsRow(codes: readonly string[], flags: Record<string, string>, x: number, y: number, size: number): string {
  return codes
    .slice(0, 12)
    .map((c, i) => {
      const fx = x + i * (size + 10);
      const src = flags[c];
      return src
        ? `<image href="${src}" x="${fx}" y="${y}" width="${size}" height="${size}"/>`
        : `<circle cx="${fx + size / 2}" cy="${y + size / 2}" r="${size / 2}" fill="#4A4A52"/>`;
    })
    .join('');
}

/** «Мої Нові роки»: мапа шляху, числа, маршрут, прапори. */
export function summarySvg(ratio: ShareRatio, text: SummaryText, map: SummaryMap | null, flagCodes: readonly string[], flags: Record<string, string>): string {
  const { w, h } = SHARE_SIZE[ratio];
  const pad = 72;
  const story = ratio === 'story';
  let y = pad + 40;
  let body = `<text x="${pad}" y="${y}" fill="#FCE286" font-size="34" font-weight="800" letter-spacing="5">${esc(text.kicker)}</text>`;
  y += 70;
  body += `<text x="${pad}" y="${y}" fill="#FFFFFF" font-size="${story ? 64 : 56}" font-weight="800">${esc(text.name)}</text>`;
  y += story ? 50 : 36;
  if (map) {
    const mw = story ? w - pad * 2 : 560;
    const m = mapSvg(map, pad, y, mw);
    body += `<rect x="${pad - 2}" y="${y - 2}" width="${mw + 4}" height="${m.h + 4}" rx="18" fill="none" stroke="#3A3A42" stroke-width="3"/>${m.svg}`;
    if (story) y += m.h + 50;
    else {
      const st = statsSvg(text.stats, pad + mw + 40, y, w - pad * 2 - mw - 40, 1 + 1);
      body += st.svg;
      y += Math.max(m.h, st.h) + 50;
    }
  }
  if (story || !map) {
    const st = statsSvg(text.stats, pad, y, w - pad * 2, 2);
    body += st.svg;
    y += st.h + 60;
  }
  body += `<text x="${pad}" y="${y}" fill="#FFFFFF" font-size="40" font-weight="800">${esc(text.route)}</text>`;
  y += 40;
  body += flagsRow(flagCodes, flags, pad, y, 56);
  y += 56;
  // Вміст — по вертикалі посередині між верхом і підписом бренду (сторіс не порожніє знизу).
  const dy = Math.max(0, Math.round((h - pad - 90 - y) / 2));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1B2240"/><stop offset="1" stop-color="#121214"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#bg)"/><g ${FONT}><g transform="translate(0 ${dy})">${body}</g>
<text x="${pad}" y="${h - pad}" fill="#B4B4BC" font-size="34" font-weight="700">${esc(text.brand)}</text></g></svg>`;
}

export interface PassportCardStamp {
  city: string;
  country: string;
  flagCode: string;
}

/** «Поділитися паспортом»: числа й список штампів. */
export function passportSvg(ratio: ShareRatio, text: SummaryText, stamps: readonly PassportCardStamp[], flags: Record<string, string>): string {
  const { w, h } = SHARE_SIZE[ratio];
  const pad = 72;
  const story = ratio === 'story';
  let y = pad + 40;
  let body = `<text x="${pad}" y="${y}" fill="#FCE286" font-size="34" font-weight="800" letter-spacing="5">${esc(text.kicker)}</text>`;
  y += 70;
  body += `<text x="${pad}" y="${y}" fill="#FFFFFF" font-size="${story ? 64 : 56}" font-weight="800">${esc(text.name)}</text>`;
  y += 50;
  const st = statsSvg(text.stats, pad, y, w - pad * 2, story ? 2 : 4);
  body += st.svg;
  y += st.h + 50;
  const rowH = story ? 96 : 70;
  const cols = story ? 1 : 2;
  const cw = (w - pad * 2 - (cols - 1) * 30) / cols;
  const max = Math.floor((h - pad - 80 - y) / rowH) * cols;
  stamps.slice(0, max).forEach((s, i) => {
    const x = pad + (i % cols) * (cw + 30);
    const ry = y + Math.floor(i / cols) * rowH;
    const src = flags[s.flagCode];
    body += src ? `<image href="${src}" x="${x}" y="${ry}" width="52" height="52"/>` : `<circle cx="${x + 26}" cy="${ry + 26}" r="26" fill="#4A4A52"/>`;
    body += `<text x="${x + 72}" y="${ry + 26}" fill="#FFFFFF" font-size="34" font-weight="800">${esc(s.city)}</text>`;
    body += `<text x="${x + 72}" y="${ry + 60}" fill="#B4B4BC" font-size="26" font-weight="600">${esc(s.country)}</text>`;
  });
  body += `<text x="${pad}" y="${h - pad}" fill="#B4B4BC" font-size="34" font-weight="700">${esc(text.brand)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A2140"/><stop offset="1" stop-color="#121214"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#bg)"/><rect x="36" y="36" width="${w - 72}" height="${h - 72}" rx="28" fill="none" stroke="#FCE286" stroke-opacity="0.5" stroke-width="4"/><g ${FONT}>${body}</g></svg>`;
}
