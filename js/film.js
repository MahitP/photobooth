// Turns a raw webcam frame into a booth print: smart crop, tone curve, flash falloff, halation, grain.
// Seeded randomness so the print and the video render identical photos.

export const FILMS = {
  bw:    { label: 'B&W' },
  sepia: { label: 'Sepia' },
  color: { label: 'Color' },
  golden: { label: 'Golden' },
  cool:  { label: 'Cool' },
};

// Colour films: per-channel gain, saturation, black lift. Golden/Cool mirror the Life4Cuts filter menu.
const COLOR = {
  color:  { gain: [1.04, 1, 0.94], sat: 0.88, lift: [0.05, 0.045, 0.06] },
  golden: { gain: [1.1, 1.02, 0.84], sat: 0.95, lift: [0.07, 0.055, 0.04] },
  cool:   { gain: [0.95, 1.0, 1.08], sat: 0.8, lift: [0.045, 0.05, 0.07] },
};
export const isColor = (film) => film in COLOR;

// Live preview approximation of each film, applied to the <video> with CSS.
export const FILM_CSS = {
  bw: 'grayscale(1) contrast(1.18) brightness(1.04)',
  sepia: 'sepia(0.75) grayscale(0.35) contrast(1.1) brightness(1.02)',
  color: 'saturate(0.92) contrast(1.06) brightness(1.03)',
  golden: 'sepia(0.28) saturate(1.15) contrast(1.05) brightness(1.06)',
  cool: 'saturate(0.8) contrast(1.05) brightness(1.07) hue-rotate(6deg)',
};

export function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

// Smallest rect of `aspect` (w/h) around the focus box (face + hands), padded, clamped to the frame.
export function smartCrop(W, H, focus, aspect) {
  let cw, ch;
  if (focus) {
    const fx = (focus.x0 + focus.x1) / 2;
    const fw = (focus.x1 - focus.x0) * 1.45, fh = (focus.y1 - focus.y0) * 1.6;
    cw = Math.max(fw, fh * aspect, W * 0.5);
    ch = cw / aspect;
    if (ch > H) { ch = H; cw = ch * aspect; }
    if (cw > W) { cw = W; ch = cw / aspect; }
    // put the face slightly above centre, like a framed portrait
    const fy = focus.faceY ?? (focus.y0 + focus.y1) / 2;
    let x = fx - cw / 2, y = fy - ch * 0.42;
    x = Math.max(0, Math.min(W - cw, x));
    y = Math.max(0, Math.min(H - ch, y));
    return { x, y, w: cw, h: ch };
  }
  cw = Math.min(W, H * aspect); ch = cw / aspect;
  return { x: (W - cw) / 2, y: (H - ch) / 2, w: cw, h: ch };
}

const smooth = (x) => x * x * (3 - 2 * x);

// src: canvas of the raw frame. crop in src px. Returns a processed canvas w x h.
export function developPhoto(src, crop, w, h, film, seed = 1) {
  const out = canvas(w, h);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  // booth lenses are soft: blend in a slightly blurred copy
  const soft = canvas(w * 0.55, h * 0.55);
  soft.getContext('2d').drawImage(out, 0, 0, soft.width, soft.height);
  ctx.globalAlpha = 0.35;
  ctx.drawImage(soft, 0, 0, w, h);
  ctx.globalAlpha = 1;

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  // auto-levels: stretch the 1st..99.5th luminance percentile so dim rooms still print bright and punchy
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < d.length; i += 4 * 7) { hist[(d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) | 0]++; n++; }
  let lo = 0, hi = 255, acc = 0;
  for (let k = 0; k < 256; k++) { acc += hist[k]; if (acc > n * 0.01) { lo = k; break; } }
  acc = 0;
  for (let k = 255; k >= 0; k--) { acc += hist[k]; if (acc > n * 0.005) { hi = k; break; } }
  const lvLo = lo / 255, lvGain = Math.min(1.8, 1 / Math.max(0.2, (hi - lo) / 255));
  const lv = (v) => Math.max(0, (v - lvLo) * lvGain);
  const G = grainTable(seed);
  const cx = w / 2, cy = h * 0.45, maxR = Math.hypot(w / 2, h / 2);
  const grainAmp = isColor(film) ? 14 : 20;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const rr = Math.hypot(x - cx, y - cy) / maxR;
      const vig = 1.06 - 0.38 * smooth(Math.min(1, rr * 1.05)); // flash hot-spot + falloff
      const g = G[(x + y * 1031) & GRAIN_MASK] * grainAmp;
      let r = lv(d[i] / 255), gg = lv(d[i + 1] / 255), b = lv(d[i + 2] / 255);
      const C = COLOR[film];
      if (C) {
        r = curve(r * C.gain[0] * vig, C.lift[0], 0.035); gg = curve(gg * C.gain[1] * vig, C.lift[1], 0.03); b = curve(b * C.gain[2] * vig, C.lift[2], 0.05);
        const l = 0.3 * r + 0.59 * gg + 0.11 * b;
        const sat = C.sat;
        r = l + (r - l) * sat; gg = l + (gg - l) * sat; b = l + (b - l) * sat;
        const mw = 4 * l * (1 - l);
        d[i] = r * 255 + g * mw; d[i + 1] = gg * 255 + g * mw; d[i + 2] = b * 255 + g * mw;
      } else {
        // orthochromatic-ish mix: lighter skin, darker reds like old booth paper
        let l = (0.42 * r + 0.48 * gg + 0.1 * b) * vig;
        l = curve(l, 0.035, 0.02);
        const mw = 4 * l * (1 - l) + 0.15;
        const v = l * 255 + g * mw;
        if (film === 'sepia') {
          const [tr, tg, tb] = sepiaTone(l);
          d[i] = tr + g * mw; d[i + 1] = tg + g * mw; d[i + 2] = tb + g * mw;
        } else {
          d[i] = v * 1.012; d[i + 1] = v; d[i + 2] = v * 0.975; // faint warm silver tone
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  // halation: glow from highlights
  const glow = canvas(w / 10, h / 10);
  const gctx = glow.getContext('2d');
  gctx.filter = 'none';
  gctx.drawImage(out, 0, 0, glow.width, glow.height);
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = isColor(film) ? 0.1 : 0.12;
  ctx.drawImage(glow, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  return out;
}

// S-curve with lifted blacks / softened whites (paper never reaches pure black or white).
function curve(x, lift, roll) {
  x = Math.max(0, Math.min(1, x));
  const s = x < 0.5 ? 0.5 * Math.pow(2 * x, 1.55) : 1 - 0.5 * Math.pow(2 * (1 - x), 1.55);
  return lift + s * (1 - lift - roll);
}

function sepiaTone(l) {
  // shadows -> deep brown, mids -> warm umber, highlights -> cream
  const stops = [[0, [34, 22, 14]], [0.45, [128, 96, 66]], [0.8, [214, 189, 152]], [1, [246, 236, 214]]];
  for (let k = 1; k < stops.length; k++) {
    if (l <= stops[k][0]) {
      const [a0, c0] = stops[k - 1], [a1, c1] = stops[k];
      const t = (l - a0) / (a1 - a0);
      return c0.map((v, j) => v + (c1[j] - v) * t);
    }
  }
  return stops[stops.length - 1][1];
}

// Reusable paper texture: fibres + mottling. Seeded.
// Grain lookup: one seeded table of approx-gaussian noise instead of three random() calls per pixel (~3x faster).
const GRAIN_MASK = (1 << 18) - 1;
const grainTables = new Map();
function grainTable(seed) {
  if (!grainTables.has(seed)) {
    const r = rng(seed), t = new Float32Array(GRAIN_MASK + 1);
    for (let i = 0; i <= GRAIN_MASK; i++) t[i] = r() + r() + r() - 1.5;
    grainTables.set(seed, t);
  }
  return grainTables.get(seed);
}

// Paper texture is expensive (per-pixel noise + fibres) and identical for a given size, so it's built once.
const textures = new Map();
export function paperTexture(w, h, dark = false, seed = 7) {
  const k = `${w}x${h}:${dark}:${seed}`;
  if (!textures.has(k)) textures.set(k, buildPaperTexture(w, h, dark, seed));
  return textures.get(k);
}
function buildPaperTexture(w, h, dark, seed) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const rand = rng(seed);
  // low-frequency mottling
  const m = canvas(Math.ceil(w / 40), Math.ceil(h / 40));
  const mc = m.getContext('2d');
  const md = mc.createImageData(m.width, m.height);
  for (let i = 0; i < md.data.length; i += 4) {
    const v = 128 + (rand() - 0.5) * 40;
    md.data[i] = md.data[i + 1] = md.data[i + 2] = v; md.data[i + 3] = 255;
  }
  mc.putImageData(md, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(m, 0, 0, w, h);
  // fine speckle
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 26;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  // fibres
  ctx.lineWidth = Math.max(0.6, w / 1800);
  const fibres = Math.round((w * h) / 9000);
  for (let i = 0; i < fibres; i++) {
    const x = rand() * w, y = rand() * h, a = rand() * 6.28, l = 4 + rand() * 14;
    ctx.strokeStyle = `rgba(${dark ? 255 : 0},${dark ? 255 : 0},${dark ? 255 : 0},${0.04 + rand() * 0.05})`;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a + 1) * l / 2, y + Math.sin(a + 1) * l / 2, x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  return c;
}
