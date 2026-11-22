// Print-accurate photo strip renderer. Sizes are real print sizes in inches, rendered at `dpi`.
import { canvas, paperTexture, rng } from './film.js';

export const LAYOUTS = {
  // each column must add up to the paper height: top + rows*(cellH + caption) + gaps + footer
  '1x4': { label: '1 × 4 strip', count: 4, w: 2, h: 6, cols: 1, rows: 4, cellW: 1.72, cellH: 1.15, side: 0.14, top: 0.16, gapX: 0, gapY: 0.035, caption: 0.16 },
  '2x2': { label: '2 × 2 box', count: 4, w: 4, h: 6, cols: 2, rows: 2, cellW: 1.78, cellH: 2.25, side: 0.16, top: 0.16, gapX: 0.12, gapY: 0.1, caption: 0.22 },
  '2x3': { label: '2 × 3 sheet', count: 6, w: 4, h: 6, cols: 2, rows: 3, cellW: 1.8, cellH: 1.42, side: 0.15, top: 0.15, gapX: 0.1, gapY: 0.04, caption: 0.22 },
};

// Frame (paper) colours. Pastels are tuned to look like real coloured booth stock, not screen colours.
export const FRAMES = {
  white:    { label: 'White',    hex: '#f6f2ea' },
  black:    { label: 'Black',    hex: '#161514' },
  pink:     { label: 'Pink',     hex: '#f5cdd6' },
  green:    { label: 'Green',    hex: '#cfe2c9' },
  blue:     { label: 'Blue',     hex: '#cadcf2' },
  yellow:   { label: 'Yellow',   hex: '#f6e7a6' },
  purple:   { label: 'Purple',   hex: '#dcd0f2' },
  maroon:   { label: 'Maroon',   hex: '#6e1f2b' },
  burgundy: { label: 'Burgundy', hex: '#4b1622' },
};

// Text colours follow the paper: dark ink + red script on light paper, cream on dark paper.
export function frameTheme(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const dark = lum < 0.5;
  return { paper: hex, dark, black: lum < 0.12, ink: dark ? '#f2ece2' : '#2b2622', accent: dark ? '#f2ece2' : '#a3202a', blank: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)' };
}

// Cell rectangles in px for a layout at dpi (reading order).
export function cellRects(layoutId, dpi) {
  const L = LAYOUTS[layoutId];
  const rects = [];
  for (let r = 0; r < L.rows; r++) {
    for (let c = 0; c < L.cols; c++) {
      const x = (L.side + c * (L.cellW + L.gapX)) * dpi;
      const y = (L.top + r * (L.cellH + L.caption + L.gapY)) * dpi;
      rects.push({ x, y, w: L.cellW * dpi, h: L.cellH * dpi });
    }
  }
  return rects;
}
export function footerTop(layoutId, dpi) {
  const L = LAYOUTS[layoutId], last = cellRects(layoutId, dpi).at(-1);
  return last.y + last.h + L.caption * dpi;
}
export const stripSize = (layoutId, dpi) => ({ W: Math.round(LAYOUTS[layoutId].w * dpi), H: Math.round(LAYOUTS[layoutId].h * dpi) });
export const cellAspect = (layoutId) => LAYOUTS[layoutId].cellW / LAYOUTS[layoutId].cellH;

// photos: processed canvases (cell aspect) or null for an empty cell. captions: strings (or [] for none).
// note: custom footer line. showDate: print the date. stickers: transparent overlay canvas (drawn on top).
export function renderStrip({ layoutId, frame = FRAMES.white.hex, photos, captions = [], note = '', showDate = true, stickers = null, date = new Date(), dpi = 300, seed = 3 }) {
  const L = LAYOUTS[layoutId], T = frameTheme(frame);
  const { W, H } = stripSize(layoutId, dpi);
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const rand = rng(seed);
  const u = dpi / 100; // 1 "point" = 1/100 inch

  ctx.fillStyle = T.paper;
  ctx.fillRect(0, 0, W, H);

  const rects = cellRects(layoutId, dpi);
  // one caption size for the whole sheet: the largest that lets the longest lyric fit under its photo
  const base = 10.5 * u;
  ctx.font = `${base}px "Homemade Apple", cursive`;
  let capSize = base;
  for (const t of captions) if (t) capSize = Math.min(capSize, base * (rects[0].w - 4 * u) / ctx.measureText(t).width);
  capSize = Math.max(6.5 * u, capSize);
  rects.forEach((r, i) => {
    const img = photos[i];
    const rad = 3 * u;
    ctx.save();
    roundRect(ctx, r.x, r.y, r.w, r.h, rad);
    ctx.clip();
    if (img) ctx.drawImage(img, r.x, r.y, r.w, r.h);
    else { ctx.fillStyle = T.blank; ctx.fillRect(r.x, r.y, r.w, r.h); }
    // emulsion edge: slight darkening just inside the photo border
    const e = 5 * u;
    for (const [x0, y0, x1, y1] of [[r.x, 0, r.x + e, 0], [r.x + r.w, 0, r.x + r.w - e, 0], [0, r.y, 0, r.y + e], [0, r.y + r.h, 0, r.y + r.h - e]]) {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    ctx.restore();
    // a hair of print misregistration: thin lighter line on one edge
    ctx.strokeStyle = T.dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 0.6 * u;
    roundRect(ctx, r.x - 0.3 * u, r.y - 0.3 * u, r.w + 0.6 * u, r.h + 0.6 * u, rad);
    ctx.stroke();

    if (L.caption && captions[i]) {
      ctx.save();
      ctx.fillStyle = T.ink;
      ctx.globalAlpha = 0.88;
      ctx.font = `${capSize}px "Homemade Apple", cursive`;
      ctx.textBaseline = 'middle';
      ctx.translate(r.x + 2 * u, r.y + r.h + L.caption * dpi * 0.55);
      ctx.rotate((rand() - 0.5) * 0.03);
      ctx.fillText(captions[i], 0, 0);
      ctx.restore();
    }
  });

  drawFooter(ctx, L, T, W, H, dpi, u, showDate ? date : null, footerTop(layoutId, dpi), (note.trim() || 'hold it.').toUpperCase());

  // paper texture over everything (also lightly over photos, like real prints)
  const tex = paperTexture(Math.round(W / 2), Math.round(H / 2), T.dark, seed + 11);
  ctx.save();
  ctx.globalCompositeOperation = T.dark ? 'screen' : 'multiply';
  ctx.globalAlpha = T.dark ? 0.07 : 0.12;
  ctx.drawImage(tex, 0, 0, W, H);
  ctx.restore();
  // edge falloff of the paper
  const eg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.4, W / 2, H / 2, Math.hypot(W, H) * 0.6);
  eg.addColorStop(0, 'rgba(0,0,0,0)'); eg.addColorStop(1, T.dark ? 'rgba(0,0,0,0.25)' : 'rgba(80,60,30,0.07)');
  ctx.fillStyle = eg;
  ctx.fillRect(0, 0, W, H);
  // stickers sit on top of the paper, like real ones
  if (stickers) ctx.drawImage(stickers, 0, 0, W, H);
  return c;
}

function drawFooter(ctx, L, T, W, H, dpi, u, date, top, tag) {
  const fh = H - top;
  const cx = W / 2;
  const scale = Math.min(1, L.w / 4); // 1x4 strip is half as wide
  const dateStr = date ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : '';
  const meta = date ? `${dateStr}  ·  ${tag}` : tag;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (T.black) {
    // near-black stock gets the Photoism-style serif caps
    ctx.fillStyle = T.ink;
    ctx.font = `600 ${18 * u * (0.6 + scale * 0.4)}px "Bodoni Moda", serif`;
    ctx.letterSpacing = `${2 * u}px`;
    ctx.fillText('LAST CHRISTMAS', cx, top + fh * 0.42);
    ctx.font = `${7 * u}px "Courier Prime", monospace`;
    ctx.globalAlpha = 0.7;
    ctx.fillText(meta, cx, top + fh * 0.72);
  } else {
    ctx.fillStyle = T.accent;
    let big = (L.w < 3 ? 30 : 40) * u;
    ctx.font = `${big}px "Pinyon Script", cursive`;
    const need = ctx.measureText('Last Christmas').width;
    if (need > W * 0.86) { big *= (W * 0.86) / need; ctx.font = `${big}px "Pinyon Script", cursive`; }
    ctx.fillText('Last Christmas', cx, top + fh * 0.42);
    ctx.fillStyle = T.ink;
    ctx.globalAlpha = 0.62;
    ctx.font = `${(L.w < 3 ? 5.6 : 7) * u}px "Courier Prime", monospace`;
    ctx.fillText(meta, cx, top + fh * 0.76);
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
export { roundRect };

// Real booths hand you two 2x6 strips cut from one 4x6 print. This builds that sheet for the 1x4 layout,
// so it can be printed at any photo lab / pharmacy kiosk as a standard 4x6 and cut down the middle.
export function printSheet(strip) {
  const c = canvas(strip.width * 2, strip.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(strip, 0, 0);
  ctx.drawImage(strip, strip.width, 0);
  // faint cut guide ticks at top and bottom only, so nothing shows on the strips once cut
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, strip.width / 400);
  const t = strip.height * 0.012;
  ctx.beginPath(); ctx.moveTo(strip.width, 0); ctx.lineTo(strip.width, t); ctx.moveTo(strip.width, strip.height - t); ctx.lineTo(strip.width, strip.height); ctx.stroke();
  return c;
}

// Builds the (cached) paper texture for a layout ahead of time, so the first strip render doesn't pay for it.
export function warmStrip(layoutId, frameHex, dpi) {
  const { W, H } = stripSize(layoutId, dpi);
  paperTexture(Math.round(W / 2), Math.round(H / 2), frameTheme(frameHex).dark, 3 + 11);
}
