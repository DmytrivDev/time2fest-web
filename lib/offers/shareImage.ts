/**
 * Картка штампа для «Поділитися» (O-SHARE): прев’ю 9:16 (сторіс) і 1:1 (квадрат).
 * Картку малюємо як SVG (миттєво, без мережі): прев’ю — `<img src="data:image/svg+xml…">`,
 * «Завантажити зображення» — растеризація того самого SVG у PNG через canvas.
 * Художні кольори листівки задано тут, а не токенами: це зображення, а не інтерфейс.
 */

export type ShareRatio = 'story' | 'square';

export const SHARE_SIZE: Record<ShareRatio, { w: number; h: number }> = {
  story: { w: 1080, h: 1920 },
  square: { w: 1080, h: 1080 },
};

export interface ShareCardText {
  /** «НОВИЙ РІК 2027». */
  stampLine: string;
  /** «СІДНЕЙ» (місто великими; для кількох — «СІДНЕЙ · МЕЛЬБУРН»). */
  place: string;
  /** «Сідней · Новий рік о 12:00 за вашим часом». */
  caption: string;
  brand: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function shareCardSvg(ratio: ShareRatio, text: ShareCardText): string {
  const { w, h } = SHARE_SIZE[ratio];
  const cx = w / 2;
  const cy = h / 2;
  const fw = [
    [220, h * 0.2, '#E8C872'],
    [860, h * 0.14, '#E8837F'],
    [150, h * 0.34, '#8CC7C2'],
    [930, h * 0.3, '#E8C872'],
  ] as const;
  const rays = fw
    .map(([x, y, c]) =>
      Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return `<line x1="${x + Math.cos(a) * 18}" y1="${y + Math.sin(a) * 18}" x2="${x + Math.cos(a) * 64}" y2="${y + Math.sin(a) * 64}" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`;
      }).join(''),
    )
    .join('');
  const frame = 56;
  const font = "font-family=\"Manrope, 'Segoe UI', Arial, sans-serif\"";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1D2846"/><stop offset="1" stop-color="#4A4262"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#sky)"/>
${rays}
<rect x="${frame}" y="${frame}" width="${w - frame * 2}" height="${h - frame * 2}" rx="28" fill="none" stroke="#EFE7D6" stroke-width="6"/>
<g text-anchor="middle" ${font}>
<text x="${cx}" y="${cy - 40}" fill="#EFE7D6" font-size="64" font-weight="700" letter-spacing="6">${esc(text.stampLine)}</text>
<text x="${cx}" y="${cy + 60}" fill="#FFFFFF" font-size="96" font-weight="800" letter-spacing="4">${esc(text.place)}</text>
<text x="${cx}" y="${cy + 150}" fill="#ECECEF" font-size="40" font-weight="500">${esc(text.caption)}</text>
<text x="${cx}" y="${h - frame - 48}" fill="#EFE7D6" font-size="44" font-weight="700">${esc(text.brand)}</text>
</g>
</svg>`;
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** SVG → PNG через canvas (лише в браузері). Відхиляється, якщо картинку не вдалося намалювати. */
export function svgToPngBlob(svg: string, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('blob'))), 'image/png');
      } catch (err) {
        reject(err instanceof Error ? err : new Error('canvas'));
      }
    };
    img.onerror = () => reject(new Error('image'));
    img.src = svgDataUrl(svg);
  });
}
