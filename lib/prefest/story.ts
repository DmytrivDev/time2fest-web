/**
 * Картка для сторіс 1080×1920 (PNG на canvas поза екраном). Розкладка — як у превʼю 250 px, помножена на 4,32.
 * Без React; фон малює викликач (`drawBackground`), тож `lib/` не залежить від компонентів.
 */
export const STORY_W = 1080;
export const STORY_H = 1920;
const PREVIEW_W = 250;

export interface StoryColors {
  background: string;
  text: string;
  textSecondary: string;
  highlight: string;
}

export interface StoryParams {
  line1: string;
  ord: string;
  line3: string;
  where: string;
  invite: string;
  site: string;
  /** Адреса круглого прапора (SVG) або `null`. */
  flagSrc: string | null;
  logoSrc: string;
  colors: StoryColors;
  fontFamily: string;
  /** Малює фон у координатах 0…w × 0…h. */
  drawBackground: (g: CanvasRenderingContext2D, w: number, h: number) => void;
}

/** `#rrggbb` → `rgba(r,g,b,a)`; не hex — повертає колір як є. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

type Ctx = CanvasRenderingContext2D & { letterSpacing?: string };

/** Намалювати картку й повернути PNG. */
export async function renderStoryPng(p: StoryParams): Promise<Blob | null> {
  const [logo, flag] = await Promise.all([loadImage(p.logoSrc), p.flagSrc ? loadImage(p.flagSrc) : Promise.resolve(null)]);
  const cv = document.createElement('canvas');
  cv.width = STORY_W;
  cv.height = STORY_H;
  const g = cv.getContext('2d') as Ctx | null;
  if (!g) return null;
  const k = STORY_W / PREVIEW_W;
  const H = STORY_H / k;
  p.drawBackground(g, STORY_W, STORY_H);
  g.scale(k, k);

  const { background, text, textSecondary, highlight } = p.colors;
  const veil = g.createLinearGradient(0, 0, 0, H);
  veil.addColorStop(0, withAlpha(background, 0.25));
  veil.addColorStop(0.35, withAlpha(background, 0.1));
  veil.addColorStop(0.7, withAlpha(background, 0.94));
  veil.addColorStop(1, withAlpha(background, 0.94));
  g.fillStyle = veil;
  g.fillRect(0, 0, PREVIEW_W, H);

  if (logo) {
    const lh = 22;
    g.drawImage(logo, 20, 22, (logo.width / logo.height) * lh, lh);
  }

  const font = (size: number, weight: number) => `${weight} ${size}px ${p.fontFamily}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const line = (str: string, x: number, yMid: number, size: number, weight: number, color: string, spacing = '0px') => {
    g.font = font(size, weight);
    g.fillStyle = color;
    if ('letterSpacing' in g) g.letterSpacing = spacing;
    g.fillText(str, x, yMid);
  };

  // Блок знизу вгору: s5 (45), s4 (38), s3 (25), s2 (74,2), s1 (22,5) — як у превʼю.
  const total = 22.5 + 74.2 + 25 + 38 + 45;
  let y = H - 22 - total;
  line(p.line1, 20, y + 11.25, 15, 700, textSecondary);
  y += 22.5;
  line(p.ord, 20, y + 2 + 36.1, 76, 800, highlight, '-3.04px');
  y += 74.2;
  line(p.line3, 20, y + 4 + 10.5, 14, 600, text);
  y += 25;
  y += 16;
  let x = 20;
  if (flag) {
    g.save();
    g.beginPath();
    g.arc(x + 11, y + 11, 11, 0, Math.PI * 2);
    g.clip();
    g.drawImage(flag, x, y, 22, 22);
    g.restore();
    x += 30;
  }
  line(p.where, x, y + 11, 13, 700, text);
  y += 22;
  y += 14;
  g.fillStyle = withAlpha(text, 0.18);
  g.fillRect(20, y, PREVIEW_W - 40, 1);
  y += 1 + 12;
  line(p.invite, 20, y + 9, 12, 500, textSecondary);
  g.font = font(12, 500);
  const w = g.measureText(p.invite + ' ').width;
  line(p.site, 20 + w, y + 9, 12, 700, text);

  return new Promise((resolve) => cv.toBlob((b) => resolve(b), 'image/png'));
}
