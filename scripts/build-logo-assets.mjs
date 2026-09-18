import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

const SRC = 'public/brand/bull-rush-futures.jpg';

/**
 * The artwork is light ink on a solid black field, which is exactly a
 * black-matted image: each pixel already equals colour x coverage. So alpha is
 * the pixel's own peak channel, and the true colour is recovered by dividing it
 * back out. That gives genuinely anti-aliased edges rather than the hard
 * key a colour-distance threshold would produce.
 */
const NOISE_FLOOR = 14; // JPEG ringing in the black field sits below this

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
console.log(`source ${width}x${height}, ${channels} channels`);

const out = Buffer.alloc(width * height * 4);
const colAlpha = new Float64Array(width);
const rowAlpha = new Float64Array(height);

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * channels;
    const r = data[i], g = data[i + 1], b = data[i + 2];

    let a = Math.max(r, g, b);
    if (a <= NOISE_FLOOR) a = 0;
    else a = Math.min(255, Math.round(((a - NOISE_FLOOR) * 255) / (255 - NOISE_FLOOR)));

    const o = (y * width + x) * 4;
    if (a === 0) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    } else {
      const k = 255 / a;
      out[o] = Math.min(255, Math.round(r * k));
      out[o + 1] = Math.min(255, Math.round(g * k));
      out[o + 2] = Math.min(255, Math.round(b * k));
      out[o + 3] = a;
      colAlpha[x] += a;
      rowAlpha[y] += a;
    }
  }
}

// Ink bounds, so the asset ships with no dead margin.
const firstAbove = (arr, t) => arr.findIndex((v) => v > t);
const lastAbove = (arr, t) => { for (let i = arr.length - 1; i >= 0; i -= 1) if (arr[i] > t) return i; return -1; };
const COL_T = 255 * 2, ROW_T = 255 * 2;

const x0 = firstAbove(colAlpha, COL_T), x1 = lastAbove(colAlpha, COL_T);
const y0 = firstAbove(rowAlpha, ROW_T), y1 = lastAbove(rowAlpha, ROW_T);
console.log(`ink bounds x ${x0}-${x1}, y ${y0}-${y1}`);

// Find the gutter between the bull and the wordmark. The slashes are slanted,
// so no column is perfectly empty; the split is the SPARSEST column in the band
// where the gutter has to be, rather than the widest empty run.
const inkWidth = x1 - x0 + 1;
const searchFrom = x0 + Math.floor(inkWidth * 0.3);
const searchTo = x0 + Math.floor(inkWidth * 0.55);
let splitAt = searchFrom, minSum = Infinity;
for (let x = searchFrom; x <= searchTo; x += 1) {
  if (colAlpha[x] < minSum) { minSum = colAlpha[x]; splitAt = x; }
}
console.log(`gutter: sparsest column at x=${splitAt} (density ${Math.round(minSum / 255)}px)`);

const raw = { raw: { width, height, channels: 4 } };
const pad = 2;

// Full lockup
await sharp(out, raw)
  .extract({ left: x0 - pad, top: y0 - pad, width: x1 - x0 + 1 + pad * 2, height: y1 - y0 + 1 + pad * 2 })
  .png({ compressionLevel: 9 })
  .toFile('public/brand/bull-rush-futures.png');

// Bull mark alone: everything left of the gutter.
const bx1 = splitAt;
let by0 = height, by1 = 0;
for (let y = 0; y < height; y += 1) {
  let sum = 0;
  for (let x = x0; x <= bx1; x += 1) sum += out[(y * width + x) * 4 + 3];
  if (sum > ROW_T) { if (y < by0) by0 = y; by1 = y; }
}
await sharp(out, raw)
  .extract({ left: x0 - pad, top: by0 - pad, width: bx1 - x0 + 1 + pad * 2, height: by1 - by0 + 1 + pad * 2 })
  .png({ compressionLevel: 9 })
  .toFile('public/brand/bull-mark.png');

const meta = await Promise.all([
  sharp('public/brand/bull-rush-futures.png').metadata(),
  sharp('public/brand/bull-mark.png').metadata(),
]);
console.log(`lockup  ${meta[0].width}x${meta[0].height}  aspect ${(meta[0].width / meta[0].height).toFixed(3)}`);
console.log(`bull    ${meta[1].width}x${meta[1].height}  aspect ${(meta[1].width / meta[1].height).toFixed(3)}`);
