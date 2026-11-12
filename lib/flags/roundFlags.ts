/**
 * Круглі прапори з `public/flags/round` як data-URL — щоб картки «Поділитися» (SVG → PNG через canvas) малювали їх без
 * мережі. Раніше жило в листівці «Першого ряду» (`lib/firstrow/postcardImage.ts`); ряд прибрано (рішення 2026-11-12).
 */

/** Невдалі (немає мережі, немає файлу) — пропускаємо: картка малює сіре коло. */
export async function loadRoundFlags(codes: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    [...new Set(codes)].map(async (code) => {
      try {
        const file = code === 'un' ? 'un' : code.toLowerCase();
        const res = await fetch(`/flags/round/${file}.svg`);
        if (!res.ok) return;
        const svg = await res.text();
        out[code] = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      } catch {
        // без мережі — сіре коло
      }
    }),
  );
  return out;
}
