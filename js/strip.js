// Print-accurate photo strip renderer. Sizes are real print sizes in inches, rendered at `dpi`.
import { canvas, paperTexture, rng } from './film.js';

export const LAYOUTS = {
  // each column must add up to the paper height: top + rows*(cellH + caption) + gaps + footer
  '1x4': { label: '1 × 4 strip', count: 4, w: 2, h: 6, cols: 1, rows: 4, cellW: 1.72, cellH: 1.15, side: 0.14, top: 0.16, gapX: 0, gapY: 0.035, caption: 0.16 },
  '2x2': { label: '2 × 2 box', count: 4, w: 4, h: 6, cols: 2, rows: 2, cellW: 1.78, cellH: 2.25, side: 0.16, top: 0.16, gapX: 0.12, gapY: 0.1, caption: 0.22 },
  '2x3': { label: '2 × 3 sheet', count: 6, w: 4, h: 6, cols: 2, rows: 3, cellW: 1.8, cellH: 1.42, side: 0.15, top: 0.15, gapX: 0.1, gapY: 0.04, caption: 0.22 },
};

export const THEMES = {
  classic:  { label: 'Classic',  paper: '#f4f0e7', ink: '#2b2622', accent: '#2b2622', dark: false },
  merry:    { label: 'Merry',    paper: '#f6ede0', ink: '#3a2420', accent: '#a3202a', dark: false },
  midnight: { label: 'Midnight', paper: '#151413', ink: '#ece5d8', accent: '#ece5d8', dark: true },
};

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

export const cellAspect = (layoutId) => LAYOUTS[layoutId].cellW / LAYOUTS[layoutId].cellH;

// photos: processed canvases (any size, already cell-aspect). captions: strings. Returns a canvas.
// note: optional custom line (names, place) printed in the footer instead of the site name.
export function renderStrip({ layoutId, themeId, photos, captions = [], note = '', date = new Date(), dpi = 300, seed = 3 }) {
  const L = LAYOUTS[layoutId], T = THEMES[themeId];
  const W = Math.round(L.w * dpi), H = Math.round(L.h * dpi);
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
    else { ctx.fillStyle = T.dark ? '#262422' : '#d9d3c8'; ctx.fillRect(r.x, r.y, r.w, r.h); }
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

  drawFooter(ctx, L, T, W, H, dpi, u, date, themeId, rects, (note.trim() || 'hold it.').toUpperCase());

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
  return c;
}

function drawFooter(ctx, L, T, W, H, dpi, u, date, themeId, rects, tag) {
  const last = rects[rects.length - 1];
  const top = last.y + last.h + L.caption * dpi;
  const fh = H - top;
  const cx = W / 2;
  const scale = Math.min(1, L.w / 4) ; // 1x4 strip is half as wide
  const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (themeId === 'midnight') {
    ctx.fillStyle = T.ink;
    ctx.font = `600 ${18 * u * (0.6 + scale * 0.4)}px "Bodoni Moda", serif`;
    ctx.letterSpacing = `${2 * u}px`;
    ctx.fillText('LAST CHRISTMAS', cx, top + fh * 0.42);
    ctx.font = `${7 * u}px "Courier Prime", monospace`;
    ctx.globalAlpha = 0.7;
    ctx.fillText(`${dateStr}  ·  ${tag}`, cx, top + fh * 0.72);
  } else {
    ctx.fillStyle = T.accent;
    let big = (L.w < 3 ? 30 : 40) * u;
    ctx.font = `${big}px "Pinyon Script", cursive`;
    // text + holly + bow (~2.4 font-sizes of ornaments) must fit inside the paper with a margin
    const need = ctx.measureText('Last Christmas').width + (themeId === 'merry' ? big * 2.4 : 0);
    if (need > W * 0.9) { big *= (W * 0.9) / need; ctx.font = `${big}px "Pinyon Script", cursive`; }
    ctx.fillText('Last Christmas', cx, top + fh * 0.42);
    if (themeId === 'merry') {
      const half = ctx.measureText('Last Christmas').width / 2;
      drawBow(ctx, cx + half + big * 0.5, top + fh * 0.36, big * 0.36, T.accent);
      drawHolly(ctx, cx - half - big * 0.62, top + fh * 0.4, big * 0.36);
    }
    ctx.fillStyle = T.ink;
    ctx.globalAlpha = 0.62;
    ctx.font = `${(L.w < 3 ? 5.6 : 7) * u}px "Courier Prime", monospace`;
    ctx.fillText(`${dateStr}  ·  ${tag}`, cx, top + fh * 0.76);
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

function drawBow(ctx, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = s * 0.04;
  for (const dir of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.bezierCurveTo(dir * s * 1.1, -s * 0.8, dir * s * 1.25, s * 0.45, 0, 0);
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(dir * s * 0.3, s * 0.6, dir * s * 0.55, s * 1.15);
    ctx.lineTo(dir * s * 0.32, s * 1.1);
    ctx.quadraticCurveTo(dir * s * 0.15, s * 0.6, 0, 0);
    ctx.fill();
  }
  ctx.beginPath(); ctx.ellipse(0, 0, s * 0.18, s * 0.22, 0, 0, 6.283); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawHolly(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  const leaf = (ang) => {
    ctx.save(); ctx.rotate(ang);
    ctx.fillStyle = '#2f5a35';
    ctx.beginPath(); ctx.moveTo(0, 0);
    const n = 3;
    for (let i = 1; i <= n; i++) ctx.quadraticCurveTo(s * (i - 0.5) / n * 1.4, -s * 0.12, s * i / n * 1.4, -s * 0.3);
    for (let i = n; i >= 1; i--) ctx.quadraticCurveTo(s * (i - 0.5) / n * 1.4, s * 0.12, s * (i - 1) / n * 1.4, i === 1 ? 0 : s * 0.3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = s * 0.04;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s * 1.3, 0); ctx.stroke();
    ctx.restore();
  };
  leaf(-2.6); leaf(-0.5);
  for (const [bx, by] of [[-0.12, 0.08], [0.12, 0.12], [0, -0.1]]) {
    const g = ctx.createRadialGradient(bx * s - s * 0.04, by * s - s * 0.04, 0, bx * s, by * s, s * 0.16);
    g.addColorStop(0, '#e2525b'); g.addColorStop(1, '#8e141c');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(bx * s, by * s, s * 0.15, 0, 6.283); ctx.fill();
  }
  ctx.restore();
}

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
export function warmStrip(layoutId, themeId, dpi) {
  const L = LAYOUTS[layoutId];
  paperTexture(Math.round(Math.round(L.w * dpi) / 2), Math.round(Math.round(L.h * dpi) / 2), THEMES[themeId].dark, 3 + 11);
}
