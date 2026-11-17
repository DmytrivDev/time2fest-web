import { PNG } from 'pngjs';

/** Paints rectangles `[x, y, w, h]` opaque black into a decoded PNG (in place). */
function applyMasks(png, masks) {
  for (const [x, y, w, h] of masks) {
    for (let j = Math.max(0, y); j < Math.min(png.height, y + h); j++) {
      for (let i = Math.max(0, x); i < Math.min(png.width, x + w); i++) {
        const o = (j * png.width + i) * 4;
        png.data[o] = 0;
        png.data[o + 1] = 0;
        png.data[o + 2] = 0;
        png.data[o + 3] = 255;
      }
    }
  }
}

/**
 * Compares two PNG buffers. A pixel differs when any RGBA channel differs by more than `tol`.
 * Different sizes are compared over the union; the extra area counts as different.
 * Returns `{ pct, diffPng }`: `pct` is the share of differing pixels (0-100), `diffPng` is a Buffer
 * with the new image dimmed and differing pixels red.
 */
export function diffPngs(refBuf, newBuf, { tol = 24, masks = [] } = {}) {
  const ref = PNG.sync.read(refBuf);
  const cur = PNG.sync.read(newBuf);
  applyMasks(ref, masks);
  applyMasks(cur, masks);
  const width = Math.max(ref.width, cur.width);
  const height = Math.max(ref.height, cur.height);
  const out = new PNG({ width, height });
  let diff = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const inRef = x < ref.width && y < ref.height;
      const inCur = x < cur.width && y < cur.height;
      let differs = !(inRef && inCur);
      if (!differs) {
        const a = (y * ref.width + x) * 4;
        const b = (y * cur.width + x) * 4;
        for (let c = 0; c < 4; c++) {
          if (Math.abs(ref.data[a + c] - cur.data[b + c]) > tol) {
            differs = true;
            break;
          }
        }
      }
      if (differs) {
        diff++;
        out.data[o] = 255;
        out.data[o + 1] = 0;
        out.data[o + 2] = 0;
        out.data[o + 3] = 255;
      } else {
        const b = (y * cur.width + x) * 4;
        out.data[o] = Math.round(cur.data[b] * 0.3);
        out.data[o + 1] = Math.round(cur.data[b + 1] * 0.3);
        out.data[o + 2] = Math.round(cur.data[b + 2] * 0.3);
        out.data[o + 3] = 255;
      }
    }
  }
  return { pct: (diff / (width * height)) * 100, diffPng: PNG.sync.write(out) };
}
