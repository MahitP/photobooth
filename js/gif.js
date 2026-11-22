// Animated GIFs. "Live strip": every cell plays a short boomerang recorded around the shutter, inside the
// real strip (frame colour, captions, stickers). Uploaded photos have no clip, so they get a flipbook instead.
import { GIFEncoder, quantize, applyPalette } from 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js';
import { canvas, smartCrop, FILM_CSS } from './film.js';
import { renderStrip, cellRects, stripSize, cellAspect, roundRect } from './strip.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

function encode(frames, W, H, delay, onProgress) {
  return (async () => {
    const enc = GIFEncoder();
    for (let i = 0; i < frames.length; i++) {
      const data = frames[i]();
      const palette = quantize(data, 256);
      enc.writeFrame(applyPalette(data, palette), W, H, { palette, delay: Array.isArray(delay) ? delay[i] : delay });
      onProgress((i + 1) / frames.length);
      await tick(); // keep the page responsive between frames
    }
    enc.finish();
    return new Blob([enc.bytes()], { type: 'image/gif' });
  })();
}

// photos: [{ raw, focus, clip?: canvas[], dev }], strip options as in renderStrip; stickers: full-size overlay or null.
export async function liveStripGif({ layoutId, frame, photos, captions, note, showDate, stickers, film, onProgress = () => {} }) {
  const dpi = layoutId === '1x4' ? 170 : 125; // 340x1020 or 500x750: sharp on phones, small files
  const { W, H } = stripSize(layoutId, dpi);
  const base = renderStrip({ layoutId, frame, photos: photos.map(() => null), captions, note, showDate, dpi });
  const rects = cellRects(layoutId, dpi);
  const aspect = cellAspect(layoutId);
  const len = Math.max(...photos.map((p) => p.clip?.length ?? 1));
  const order = [...Array(len).keys(), ...[...Array(Math.max(0, len - 2)).keys()].map((k) => len - 2 - k)]; // boomerang
  const out = canvas(W, H), ctx = out.getContext('2d', { willReadFrequently: true });
  const crops = photos.map((p) => smartCrop(p.raw.width, p.raw.height, p.focus, aspect));
  const frames = order.map((f) => () => {
    ctx.drawImage(base, 0, 0);
    rects.forEach((r, k) => {
      const p = photos[k];
      const src = p.clip?.length ? p.clip[Math.min(f, p.clip.length - 1)] : p.raw;
      const s = src.width / p.raw.width, c = crops[k];
      ctx.save();
      roundRect(ctx, r.x, r.y, r.w, r.h, dpi * 0.03);
      ctx.clip();
      ctx.filter = FILM_CSS[film] ?? 'none';
      ctx.drawImage(src, c.x * s, c.y * s, c.w * s, c.h * s, r.x, r.y, r.w, r.h);
      ctx.restore();
    });
    if (stickers) ctx.drawImage(stickers, 0, 0, W, H);
    return ctx.getImageData(0, 0, W, H).data;
  });
  return encode(frames, W, H, 95, onProgress);
}

// Flipbook: one developed print at a time on its paper, with its caption.
export async function flipbookGif({ photos, captions, film, frameHex, ink, onProgress = () => {} }) {
  const W = 480, pad = 22;
  const img0 = photos[0].dev[film].img;
  const ph = Math.round((W - pad * 2) * img0.height / img0.width);
  const H = ph + pad * 2 + 56;
  const out = canvas(W, H), ctx = out.getContext('2d', { willReadFrequently: true });
  const frames = photos.map((p, k) => () => {
    ctx.fillStyle = frameHex; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(p.dev[film].img, pad, pad, W - pad * 2, ph);
    ctx.fillStyle = ink; ctx.font = '22px "Homemade Apple", cursive'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(captions[k] ?? '', W / 2, ph + pad + 32);
    return ctx.getImageData(0, 0, W, H).data;
  });
  return encode(frames, W, H, 650, onProgress);
}
