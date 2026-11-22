// Sticker packs: original vector art (no third-party characters), rendered as die-cut stickers
// (white border + soft shadow) and auto-placed around the photos. Placement is seeded so "shuffle" is repeatable.
import { canvas, rng } from './film.js';

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
const shine = (cx, cy, rx, ry) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" opacity=".45" transform="rotate(-30 ${cx} ${cy})"/>`;

const SHAPES = {
  heart: (c) => svg(`<path d="M50 88C19 66 7 49 7 32 7 18 18 8 31 8c9 0 15 5 19 12 4-7 10-12 19-12 13 0 24 10 24 24 0 17-12 34-43 56z" fill="${c}"/>${shine(28, 28, 9, 5)}`),
  bow: (c) => svg(`<path d="M50 50C36 30 12 22 9 36s14 30 41 14zM50 50c14-20 38-28 41-14S77 66 50 50z" fill="${c}"/><path d="M47 52 30 90l9-3 6 8 8-40zM53 52l17 38-9-3-6 8-8-40z" fill="${c}" opacity=".9"/><ellipse cx="50" cy="50" rx="9" ry="11" fill="${c}" stroke="rgba(0,0,0,.18)" stroke-width="2"/>${shine(24, 34, 7, 4)}${shine(70, 34, 7, 4)}`),
  star: (c) => svg(`<path d="M50 6l12.6 27.6L92 37l-22 20.6L76 88 50 72.8 24 88l6-30.4L8 37l29.4-3.4z" fill="${c}" stroke-linejoin="round"/>${shine(40, 30, 7, 4)}`),
  sparkle: (c) => svg(`<path d="M50 4C54 34 66 46 96 50 66 54 54 66 50 96 46 66 34 54 4 50 34 46 46 34 50 4z" fill="${c}"/>`),
  cherry: (c) => svg(`<path d="M52 12C46 30 34 44 30 58M52 12c4 20 14 34 22 44" stroke="#4f7a3a" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M52 12c10-8 26-6 32 2-10 6-24 6-32-2z" fill="#6aa04d"/><circle cx="29" cy="70" r="17" fill="${c}"/><circle cx="73" cy="66" r="17" fill="${c}"/>${shine(23, 63, 5, 3)}${shine(67, 59, 5, 3)}`),
  cloud: (c) => svg(`<path d="M24 78a18 18 0 0 1-2-36 24 24 0 0 1 45-10 18 18 0 0 1 20 22 15 15 0 0 1-3 24z" fill="${c}"/><circle cx="40" cy="58" r="3" fill="#3a2a2a"/><circle cx="60" cy="58" r="3" fill="#3a2a2a"/><path d="M45 66q5 4 10 0" stroke="#3a2a2a" stroke-width="2.5" fill="none" stroke-linecap="round"/><circle cx="34" cy="65" r="4" fill="#f6a4b4" opacity=".7"/><circle cx="66" cy="65" r="4" fill="#f6a4b4" opacity=".7"/>`),
  flower: (c) => svg(`${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="50" cy="26" rx="15" ry="22" fill="${c}" transform="rotate(${a} 50 50)"/>`).join('')}<circle cx="50" cy="50" r="13" fill="#f5c64b"/>${shine(46, 45, 4, 2.5)}`),
  snowflake: (c) => svg(`<g stroke="${c}" stroke-width="6" stroke-linecap="round" fill="none">${[0, 60, 120].map((a) => `<g transform="rotate(${a} 50 50)"><path d="M50 8v84M50 22l-9-9M50 22l9-9M50 78l-9 9M50 78l9 9"/></g>`).join('')}</g><circle cx="50" cy="50" r="6" fill="${c}"/>`),
  holly: () => svg(`<path d="M50 56C38 40 22 46 10 36c4 8 2 14 6 18-6 2-8 8-6 12 10-6 28 2 40-10z" fill="#2f6a3f"/><path d="M50 56c12-16 28-10 40-20-4 8-2 14-6 18 6 2 8 8 6 12-10-6-28 2-40-10z" fill="#3c7d4b"/><circle cx="44" cy="58" r="9" fill="#c4232e"/><circle cx="58" cy="60" r="9" fill="#d12c37"/><circle cx="51" cy="48" r="9" fill="#b81d28"/>${shine(41, 55, 3, 2)}${shine(55, 57, 3, 2)}`),
  candy: () => svg(`<path d="M62 92V34a14 14 0 0 0-28 0" stroke="#fff" stroke-width="16" fill="none" stroke-linecap="round"/><path d="M62 92V34a14 14 0 0 0-28 0" stroke="#d3222d" stroke-width="16" fill="none" stroke-linecap="butt" stroke-dasharray="9 9"/>`),
  ornament: (c) => svg(`<rect x="42" y="8" width="16" height="12" rx="3" fill="#d8b25a"/><circle cx="50" cy="58" r="34" fill="${c}"/><path d="M18 52q32 12 64 0" stroke="#f3d27a" stroke-width="5" fill="none"/><path d="M20 66q30 12 60 0" stroke="#fff" stroke-width="3" fill="none" opacity=".6"/>${shine(38, 44, 9, 5)}`),
  gift: (c) => svg(`<rect x="14" y="40" width="72" height="50" rx="5" fill="${c}"/><rect x="10" y="30" width="80" height="16" rx="4" fill="${c}"/><rect x="44" y="30" width="12" height="60" fill="#f3d27a"/><path d="M50 30C40 14 24 16 26 26s18 6 24 4zM50 30c10-16 26-14 24-4s-18 6-24 4z" fill="#f3d27a"/>`),
  tree: () => svg(`<path d="M50 8 22 46h12L16 70h18L12 90h76L66 70h18L66 46h12z" fill="#2f6a3f"/><rect x="44" y="88" width="12" height="8" fill="#7a4a2a"/><circle cx="40" cy="58" r="4" fill="#d12c37"/><circle cx="60" cy="74" r="4" fill="#f3d27a"/><circle cx="56" cy="40" r="4" fill="#f3d27a"/><circle cx="36" cy="80" r="4" fill="#d12c37"/>`),
  moon: (c) => svg(`<path d="M64 8a42 42 0 1 0 28 66A36 36 0 0 1 64 8z" fill="${c}"/>${shine(30, 40, 6, 4)}`),
  mitten: (c) => svg(`<path d="M30 92V48c0-22 8-36 26-36s22 16 22 30v8l10-6c6-3 10 4 6 9L76 72v20z" fill="${c}"/><rect x="26" y="78" width="54" height="16" rx="5" fill="#fff"/><path d="M40 40h22M40 52h22" stroke="#fff" stroke-width="4" stroke-dasharray="4 5" opacity=".8"/>`),
};

export const PACKS = {
  none:      { label: 'None', items: [] },
  christmas: { label: 'Christmas', items: [['holly'], ['bow', '#c4232e'], ['candy'], ['ornament', '#c4232e'], ['star', '#f2c14e'], ['tree'], ['gift', '#2f6a3f'], ['snowflake', '#9cc3e6']] },
  girlypop:  { label: 'Girlypop', items: [['bow', '#f29bb5'], ['heart', '#ef6f93'], ['sparkle', '#ffd1e0'], ['cherry', '#d6283c'], ['star', '#f7a8c4'], ['flower', '#f7b6cf'], ['heart', '#ffb3c7']] },
  cute:      { label: 'Cute', items: [['cloud', '#ffffff'], ['star', '#ffd75e'], ['flower', '#b9d9ff'], ['heart', '#ff8fa6'], ['moon', '#ffe28a'], ['sparkle', '#fff2a8']] },
  winter:    { label: 'Winter', items: [['snowflake', '#a9d2f3'], ['mitten', '#3d6fb6'], ['star', '#dfe6ee'], ['moon', '#f3e7b5'], ['sparkle', '#ffffff'], ['snowflake', '#dceeff']] },
};

// Sticker art -> die-cut canvas (white border + shadow), cached per shape/colour.
const cache = new Map();
function loadSticker([shape, color]) {
  const key = `${shape}:${color}`;
  if (!cache.has(key)) {
    cache.set(key, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const S = 256, pad = 22;
        const art = canvas(S, S);
        art.getContext('2d').drawImage(img, pad, pad, S - pad * 2, S - pad * 2);
        const out = canvas(S, S), o = out.getContext('2d');
        // white die-cut border: the art dilated in a ring of offsets, tinted white
        const border = canvas(S, S), b = border.getContext('2d');
        for (let i = 0; i < 16; i++) b.drawImage(art, Math.cos(i * 0.3927) * 11, Math.sin(i * 0.3927) * 11);
        b.globalCompositeOperation = 'source-in'; b.fillStyle = '#fffdf8'; b.fillRect(0, 0, S, S);
        o.shadowColor = 'rgba(0,0,0,0.28)'; o.shadowBlur = 10; o.shadowOffsetY = 4;
        o.drawImage(border, 0, 0);
        o.shadowColor = 'transparent';
        o.drawImage(art, 0, 0);
        resolve(out);
      };
      img.onerror = reject;
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SHAPES[shape](color))}`;
    }));
  }
  return cache.get(key);
}

// A preview tile for the pack picker.
export async function packPreview(packId, size = 72) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  const items = PACKS[packId].items.slice(0, 3);
  const spots = [[0.3, 0.38, 0.5, -0.3], [0.68, 0.36, 0.44, 0.25], [0.5, 0.7, 0.46, 0.05]];
  for (let i = 0; i < items.length; i++) {
    const s = await loadSticker(items[i]);
    const [x, y, w, r] = spots[i];
    ctx.save(); ctx.translate(x * size, y * size); ctx.rotate(r);
    ctx.drawImage(s, -w * size / 2, -w * size / 2, w * size, w * size);
    ctx.restore();
  }
  return c;
}

// Transparent layer the size of the strip with stickers tucked on photo corners and in the margins.
// cells: photo rects in px; footerTop: y where the footer starts; seed: change it to shuffle.
export async function stickerLayer(packId, W, H, cells, footerTop, dpi, seed = 1) {
  const items = PACKS[packId]?.items ?? [];
  if (!items.length) return null;
  const imgs = await Promise.all(items.map(loadSticker));
  const rand = rng(1000 + seed * 7919);
  const c = canvas(W, H), ctx = c.getContext('2d');
  // candidate spots: each photo's outer corners (half on the photo, half on the paper) + the footer corners
  const spots = [];
  cells.forEach((r) => {
    // bottom-left is skipped: that's where the handwritten caption starts
    for (const [fx, fy] of [[0, 0], [1, 0], [1, 1]]) spots.push({ x: r.x + fx * r.w + (fx ? -0.04 : 0.04) * dpi, y: r.y + fy * r.h + (fy ? -0.05 : 0.05) * dpi });
  });
  spots.push({ x: W * 0.12, y: footerTop + (H - footerTop) * 0.45 }, { x: W * 0.88, y: footerTop + (H - footerTop) * 0.45 });
  // shuffle spots, keep ~1 sticker per photo plus the footer pair, spaced apart
  for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
  const want = Math.min(spots.length, cells.length + 2);
  const minGap = dpi * 0.75;
  const chosen = [];
  for (const s of spots) { if (chosen.length >= want) break; if (chosen.every((q) => Math.hypot(q.x - s.x, q.y - s.y) > minGap)) chosen.push(s); }
  chosen.forEach((s, i) => {
    const img = imgs[(i + Math.floor(rand() * imgs.length)) % imgs.length];
    const size = dpi * (0.42 + rand() * 0.2) * (W / dpi < 3 ? 0.8 : 1);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate((rand() - 0.5) * 0.9);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  });
  return c;
}
