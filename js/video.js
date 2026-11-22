// "Filmed strip" video: a virtual phone camera moving over the printed strip lying on a surface,
// one frame per lyric, with handheld shake, glare, shallow focus, grain and face-aware lyrics.
// Encodes MP4 offline with WebCodecs (+ mp4-muxer); falls back to real-time MediaRecorder.
import { canvas, rng } from './film.js';

export const W = 1080, H = 1920, FPS = 30;
const LEAD = 0.35;   // seconds before the first lyric
const OUTRO = 2.6;   // pull-back to the whole strip at the end

export const LYRIC_STYLES = {
  serif:  { label: 'Serif',  font: (s) => `400 ${s}px "Libre Caslon Text", Georgia, serif`, size: 0.037, stroke: false },
  sans:   { label: 'Bold',   font: (s) => `700 ${s}px "TikTok Sans", system-ui, sans-serif`, size: 0.034, stroke: true },
  script: { label: 'Script', font: (s) => `${s}px "Pinyon Script", cursive`, size: 0.05, stroke: false },
};
export const SURFACES = { wood: 'Wood table', linen: 'Linen', stone: 'Stone' };

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- scene ----------

function makeSurface(kind, w, h, seed) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const rand = rng(seed);
  const noise = (nx, ny) => {
    const n = canvas(nx, ny), nc = n.getContext('2d'), d = nc.createImageData(nx, ny);
    for (let i = 0; i < d.data.length; i += 4) { const v = rand() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    nc.putImageData(d, 0, 0);
    return n;
  };
  const layer = (n, op, a) => { ctx.globalCompositeOperation = op; ctx.globalAlpha = a; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(n, 0, 0, w, h); };

  if (kind === 'wood') {
    ctx.fillStyle = '#b98c60'; ctx.fillRect(0, 0, w, h);
    const plank = w * 0.36; // ~3.5in boards next to a 4in print
    for (let y = -rand() * plank; y < h; y += plank) {
      // board-to-board tone variation
      const tone = rand();
      ctx.fillStyle = tone < 0.5 ? `rgba(255,228,190,${0.06 + rand() * 0.1})` : `rgba(90,52,24,${0.06 + rand() * 0.12})`;
      ctx.fillRect(0, y, w, plank);
      // grain: long, gently wavy fibres
      const lines = Math.round(plank / 2.2);
      for (let k = 0; k < lines; k++) {
        const y0 = y + rand() * plank, amp = plank * (0.01 + rand() * 0.04), f = (1 + rand() * 3) / w * 6.283, ph = rand() * 6.283;
        ctx.strokeStyle = `rgba(${70 + rand() * 30},${38 + rand() * 20},${18},${0.03 + rand() * 0.11})`;
        ctx.lineWidth = 0.4 + rand() * rand() * 3;
        ctx.beginPath();
        for (let x = 0; x <= w; x += w / 24) ctx.lineTo(x, y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.7 + ph) * amp * 0.2);
        ctx.stroke();
      }
      // a cathedral figure now and then
      if (rand() < 0.7) {
        const cx = rand() * w, cy = y + plank * (0.3 + rand() * 0.4);
        for (let r = 1; r < 9; r++) {
          ctx.strokeStyle = `rgba(80,44,20,${0.05 + rand() * 0.06})`; ctx.lineWidth = 0.8 + rand() * 1.5;
          ctx.beginPath(); ctx.ellipse(cx, cy, plank * 0.25 * r, plank * 0.035 * r, 0, Math.PI * 0.05, Math.PI * 0.95); ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(45,25,12,0.6)'; ctx.fillRect(0, y, w, Math.max(1.5, w / 900));
      ctx.fillStyle = 'rgba(255,236,210,0.16)'; ctx.fillRect(0, y + Math.max(1.5, w / 900), w, Math.max(1, w / 1500));
      for (let x = rand() * w * 0.6; x < w; x += w * (0.7 + rand() * 0.8)) { ctx.fillStyle = 'rgba(45,25,12,0.5)'; ctx.fillRect(x, y, Math.max(1.5, w / 900), plank); }
    }
    layer(noise(6, 30), 'soft-light', 0.45);           // blotchy variation
    layer(noise(Math.round(w / 10), Math.round(h / 1.5)), 'overlay', 0.08); // short fibres (stretched along x)
  } else if (kind === 'stone') {
    ctx.fillStyle = '#9d968c'; ctx.fillRect(0, 0, w, h);
    layer(noise(12, 18), 'soft-light', 0.9);
    layer(noise(60, 90), 'overlay', 0.35);
    layer(noise(w / 4, h / 4), 'overlay', 0.18);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(245,240,230,0.25)'; ctx.lineWidth = w / 900;
    for (let v = 0; v < 7; v++) {
      let x = rand() * w, y = rand() * h, a = rand() * 6.28;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 0; s < 60; s++) { a += (rand() - 0.5) * 0.7; x += Math.cos(a) * w / 70; y += Math.sin(a) * w / 70; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  } else { // linen
    ctx.fillStyle = '#e9e1d3'; ctx.fillRect(0, 0, w, h);
    layer(noise(8, 12), 'soft-light', 0.5);
    layer(noise(w / 3, 4), 'overlay', 0.1);
    layer(noise(4, h / 3), 'overlay', 0.1);
    layer(noise(w / 2, h / 2), 'overlay', 0.12);
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  return c;
}

function makeShadow(sw, sh) {
  const pad = 0.2;
  const s = 0.12; // low res is fine, it's blurred anyway
  const c = canvas(sw * (1 + 2 * pad) * s, sh * (1 + 2 * pad) * s);
  const ctx = c.getContext('2d');
  ctx.filter = `blur(${Math.round(sw * s * 0.035)}px)`;
  ctx.fillStyle = '#000';
  ctx.fillRect(sw * pad * s, sh * pad * s, sw * s, sh * s);
  return { c, pad };
}

function makeGrain(seed) {
  const rand = rng(seed);
  return [0, 1, 2].map(() => {
    const c = canvas(256, 256), x = c.getContext('2d'), d = x.createImageData(256, 256);
    for (let i = 0; i < d.data.length; i += 4) { const v = 128 + (rand() + rand() - 1) * 110; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0);
    return c;
  });
}

// ---------- camera plan ----------

function planCamera(strip, rects, beats, end, seed) {
  const rand = rng(seed);
  const sw = strip.width, sh = strip.height;
  const baseRoll = -0.24 + (rand() - 0.5) * 0.1;
  const shots = beats.map((b, i) => {
    const r = rects[i];
    const roll = baseRoll + (i % 2 ? 0.05 : -0.03) + (rand() - 0.5) * 0.04;
    // rotated cell must cover ~the full screen width
    const bw = r.w * Math.abs(Math.cos(roll)) + r.h * Math.abs(Math.sin(roll));
    const z = (W * 1.02) / bw * (r.w / r.h > 1 ? 1.22 : 1.08);
    return { t: b.lines[0].t + LEAD, cx: r.x + r.w * (0.5 + (rand() - 0.5) * 0.06), cy: r.y + r.h * (0.5 + (rand() - 0.5) * 0.05), z, roll };
  });
  const fRoll = baseRoll * 0.6;
  const bw = sw * Math.abs(Math.cos(fRoll)) + sh * Math.abs(Math.sin(fRoll));
  const bh = sw * Math.abs(Math.sin(fRoll)) + sh * Math.abs(Math.cos(fRoll));
  const full = { t: end + LEAD, cx: sw / 2, cy: sh / 2, z: Math.min((W * 0.84) / bw, (H * 0.8) / bh), roll: fRoll };
  return { shots, full, duration: end + LEAD + OUTRO, phases: [rand() * 9, rand() * 9, rand() * 9, rand() * 9] };
}

function cameraAt(plan, t) {
  const { shots, full } = plan;
  const MOVE = 0.42, PRE = 0.17;
  let cam = { ...shots[0] };
  let moving = 0;
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i], next = shots[i + 1] || null;
    if (t >= s.t - PRE || i === 0) cam = { ...s };
    if (next && t >= next.t - PRE && t < next.t - PRE + MOVE) {
      const k = (t - (next.t - PRE)) / MOVE;
      const e = ease(k);
      cam = { cx: lerp(s.cx, next.cx, e), cy: lerp(s.cy, next.cy, e), z: lerp(s.z, next.z, e) * (1 - 0.06 * Math.sin(Math.PI * k)), roll: lerp(s.roll, next.roll, e) };
      moving = Math.sin(Math.PI * k);
      break;
    }
  }
  // slow push-in while holding a frame
  const cur = [...shots].reverse().find((s) => t >= s.t) || shots[0];
  cam.z *= 1 + 0.03 * Math.min(1, Math.max(0, t - cur.t) / 2.2);
  // pull back to the full strip
  const last = shots[shots.length - 1];
  if (t > full.t - 0.1) {
    const k = Math.min(1, (t - (full.t - 0.1)) / 1.35);
    const e = ease(k);
    cam = { cx: lerp(last.cx, full.cx, e), cy: lerp(last.cy, full.cy, e), z: Math.exp(lerp(Math.log(last.z * 1.03), Math.log(full.z), e)), roll: lerp(last.roll, full.roll, e) };
    moving = Math.max(moving, Math.sin(Math.PI * k) * 0.6);
  }
  // handheld: layered sines (smooth, never repeats within the clip)
  const [a, b, c, d] = plan.phases;
  const shake = 1 + moving * 0.5;
  cam.sx = (Math.sin(t * 1.1 + a) * 5 + Math.sin(t * 2.7 + b) * 2.5 + Math.sin(t * 6.1 + c) * 0.8) * shake;
  cam.sy = (Math.sin(t * 0.9 + b) * 6 + Math.sin(t * 2.3 + c) * 2.5 + Math.sin(t * 5.3 + d) * 0.8) * shake;
  cam.roll += (Math.sin(t * 0.7 + c) * 0.006 + Math.sin(t * 1.9 + d) * 0.003);
  cam.z *= 1 + Math.sin(t * 0.5 + a) * 0.006;
  cam.moving = moving;
  return cam;
}

const camMatrix = (cam) => new DOMMatrix().translate(W / 2 + cam.sx, H / 2 + cam.sy).rotate(cam.roll * 57.2958).scale(cam.z).translate(-cam.cx, -cam.cy);

// ---------- lyrics: face-aware placement ----------
// Safe area for TikTok/Reels UI: top 12% (tabs/status), bottom ~24% (caption + music), right ~14% (action rail).
const SAFE = { top: 0.12, bottom: 0.74 };

function placeLyrics(plan, rects, faces, beats, style) {
  const size = Math.round(H * LYRIC_STYLES[style].size);
  return beats.map((b, i) => {
    const shot = plan.shots[i];
    const m = camMatrix({ ...shot, sx: 0, sy: 0 });
    const r = rects[i];
    const f = faces[i];
    const textH = size * 1.3;
    let y = H * 0.2;
    if (f) {
      const pts = [[f.x0, f.y0], [f.x1, f.y0], [f.x0, f.y1], [f.x1, f.y1]].map(([x, yy]) => m.transformPoint(new DOMPoint(r.x + x * r.w, r.y + yy * r.h)));
      const top = Math.min(...pts.map((p) => p.y)), bot = Math.max(...pts.map((p) => p.y));
      // Ranked candidates: headroom above the head, then over the hair only (top of the safe zone,
      // touching at most the top 30% of the face box, which includes hair padding), then under the chin.
      // Hands doing the pose usually sit below the face, so under-the-chin is the last resort.
      const above = top - H * 0.035 - textH;
      const below = bot + H * 0.03;
      const topSafe = H * (SAFE.top + 0.01);
      if (above >= H * SAFE.top) y = Math.min(above, H * 0.34);
      else if (topSafe + textH <= top + (bot - top) * 0.3) y = topSafe;
      else if (below + textH <= H * SAFE.bottom) y = Math.max(below, H * 0.5);
      else y = topSafe;
    }
    return { y, size, lines: b.lines.map((l) => ({ ...l, t: l.t + LEAD })) };
  });
}

// One line if it fits, otherwise two balanced lines (no orphan words).
function wrap(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return [text];
  const words = text.split(' ');
  let best = [text], score = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (w < score) { score = w; best = [a, b]; }
  }
  return best;
}

function drawLyric(ctx, placement, t, style, duration) {
  const S = LYRIC_STYLES[style];
  for (const p of placement) {
    for (let j = 0; j < p.lines.length; j++) {
      const l = p.lines[j];
      const nextT = p.lines[j + 1]?.t ?? placement[placement.indexOf(p) + 1]?.lines[0].t ?? duration - OUTRO + 0.9;
      if (t < l.t || t >= nextT) continue;
      const k = Math.min(1, (t - l.t) / 0.16);
      const fadeOut = Math.min(1, (nextT - t) / 0.08);
      ctx.save();
      ctx.globalAlpha = ease(k) * fadeOut;
      ctx.font = S.font(p.size);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const lines = wrap(ctx, l.text, W * 0.8);
      lines.forEach((txt, n) => {
        const y = p.y + (1 - ease(k)) * 10 + n * p.size * 1.2;
        const x = W * 0.5;
        if (S.stroke) {
          ctx.lineJoin = 'round'; ctx.lineWidth = p.size * 0.14; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.strokeText(txt, x, y);
        } else {
          ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = p.size * 0.5; ctx.shadowOffsetY = p.size * 0.05;
          ctx.fillStyle = '#fff'; ctx.fillText(txt, x, y); // double pass = denser halo on light paper
        }
        ctx.fillStyle = '#fff';
        ctx.fillText(txt, x, y);
        ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
        ctx.fillText(txt, x, y);
      });
      ctx.restore();
    }
  }
}

// ---------- frame renderer ----------

export function createRenderer({ strip, rects, faces, beats, end, theme = 'classic', surface = 'wood', lyricStyle = 'serif', seed = 5 }) {
  const sw = strip.width, sh = strip.height;
  const plan = planCamera(strip, rects, beats, end, seed);
  const lyrics = placeLyrics(plan, rects, faces, beats, lyricStyle);
  const SF = 2.4, SR = 0.4; // surface covers 2.4x the strip, at 40% resolution
  const surf = makeSurface(surface, sw * SF * SR, sh * SF * SR, seed + 1);
  const surfAngle = 0.32;
  const shadow = makeShadow(sw, sh);
  const grain = makeGrain(seed + 2);
  const rand = rng(seed + 3);
  const glares = [0, 1, 2].map((i) => ({ x: 0.25 + rand() * 0.5, y: 0.15 + i * 0.28 + rand() * 0.1, rx: 60 + rand() * 90, ry: 30 + rand() * 40, a: 0.3 + rand() * 0.25, rot: rand() * 3 }));

  const out = canvas(W, H), o = out.getContext('2d');
  const sharp = canvas(W, H), s = sharp.getContext('2d');
  const mid = canvas(W / 3, H / 3), small = canvas(W / 6, H / 6);
  const masked = canvas(W, H), mk = masked.getContext('2d');

  function scene(ctx, cam, t) {
    const m = camMatrix(cam);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(m);
    // surface, rotated against the strip so grain doesn't line up with it
    ctx.save();
    ctx.translate(sw / 2, sh / 2); ctx.rotate(surfAngle);
    ctx.drawImage(surf, -sw * SF / 2, -sh * SF / 2, sw * SF, sh * SF);
    ctx.restore();
    // shadows: soft ambient + tight contact
    ctx.globalAlpha = 0.5;
    ctx.drawImage(shadow.c, -sw * shadow.pad + sw * 0.018, -sh * shadow.pad + sw * 0.03, sw * (1 + 2 * shadow.pad), sh * (1 + 2 * shadow.pad));
    ctx.globalAlpha = 0.35;
    ctx.drawImage(shadow.c, -sw * shadow.pad * 0.5 + sw * 0.004, -sh * shadow.pad * 0.5 + sw * 0.006, sw * (1 + shadow.pad), sh * (1 + shadow.pad));
    ctx.globalAlpha = 1;
    ctx.drawImage(strip, 0, 0);
    // light across the print: brighter top-left, gentle curl shading toward the long edges
    let g = ctx.createLinearGradient(0, 0, sw, sh);
    g.addColorStop(0, 'rgba(255,248,235,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, sw, sh);
    g = ctx.createLinearGradient(0, 0, sw, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.07)'); g.addColorStop(0.12, 'rgba(0,0,0,0)'); g.addColorStop(0.88, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.09)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, sw, sh);
    // paper edge catching light / falling away
    const lw = sw / 700;
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(0, 0, sw, lw); ctx.fillRect(0, 0, lw, sh);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, sh - lw, sw, lw); ctx.fillRect(sw - lw, 0, lw, sh);

    // glossy reflections of overhead lights, clipped to the print; they drift a little with the camera
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const clipPath = new Path2D();
    const p = [[0, 0], [sw, 0], [sw, sh], [0, sh]].map(([x, y]) => m.transformPoint(new DOMPoint(x, y)));
    clipPath.moveTo(p[0].x, p[0].y); for (const q of p.slice(1)) clipPath.lineTo(q.x, q.y); clipPath.closePath();
    ctx.clip(clipPath);
    ctx.globalCompositeOperation = 'screen';
    for (const gl of glares) {
      const x = gl.x * W - cam.sx * 1.5 + Math.sin(t * 0.4 + gl.rot) * 12;
      const y = gl.y * H - cam.sy * 1.5 - (cam.cy / sh - 0.5) * 120;
      ctx.save(); ctx.translate(x, y); ctx.rotate(gl.rot); ctx.scale(1, gl.ry / gl.rx);
      const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, gl.rx);
      rg.addColorStop(0, `rgba(255,252,245,${gl.a})`); rg.addColorStop(0.35, `rgba(255,250,240,${gl.a * 0.55})`); rg.addColorStop(1, 'rgba(255,250,240,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, gl.rx, 0, 6.283); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function frame(t) {
    const cam = cameraAt(plan, t);
    // motion blur: average sub-frames while the camera whips between photos
    const subs = cam.moving > 0.3 ? 10 : cam.moving > 0.08 ? 5 : 1;
    for (let k = 0; k < subs; k++) {
      const tt = t - (k / subs) * (1 / FPS) * 0.9;
      if (k === 0) scene(s, cam, t);
      else { scene(mk, cameraAt(plan, tt), tt); s.globalAlpha = 1 / (k + 1); s.drawImage(masked, 0, 0); s.globalAlpha = 1; }
    }
    // shallow depth of field: blurred copy everywhere, sharp copy masked to the focus area
    mid.getContext('2d').drawImage(sharp, 0, 0, mid.width, mid.height);
    small.getContext('2d').drawImage(mid, 0, 0, small.width, small.height);
    o.drawImage(small, 0, 0, W, H);
    mk.setTransform(1, 0, 0, 1, 0, 0);
    mk.globalCompositeOperation = 'source-over';
    mk.clearRect(0, 0, W, H);
    mk.drawImage(sharp, 0, 0);
    mk.globalCompositeOperation = 'destination-in';
    const fr = H * (cam.z < plan.shots[0].z * 0.7 ? 0.75 : 0.52);
    const fg = mk.createRadialGradient(W / 2, H * 0.48, fr * 0.45, W / 2, H * 0.48, fr);
    fg.addColorStop(0, 'rgba(0,0,0,1)'); fg.addColorStop(1, 'rgba(0,0,0,0)');
    mk.fillStyle = fg; mk.fillRect(0, 0, W, H);
    mk.globalCompositeOperation = 'source-over';
    o.drawImage(masked, 0, 0);

    // grade: warm phone white-balance, vignette, sensor grain
    o.globalCompositeOperation = 'soft-light';
    o.fillStyle = 'rgba(255,196,140,0.18)'; o.fillRect(0, 0, W, H);
    o.globalCompositeOperation = 'source-over';
    const v = o.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.78);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.42)');
    o.fillStyle = v; o.fillRect(0, 0, W, H);
    o.globalCompositeOperation = 'overlay';
    o.globalAlpha = 0.07;
    const gt = grain[Math.floor(t * FPS) % 3];
    o.fillStyle = o.createPattern(gt, 'repeat');
    o.save(); o.translate(Math.floor(rand() * 256), Math.floor(rand() * 256)); o.fillRect(-256, -256, W + 512, H + 512); o.restore();
    o.globalAlpha = 1;
    o.globalCompositeOperation = 'source-over';

    drawLyric(o, lyrics, t, lyricStyle, plan.duration);
    return out;
  }

  return { frame, duration: plan.duration, canvas: out, lead: LEAD };
}

// ---------- audio ----------

export async function songSegment(buffer, song, lead, duration) {
  const rate = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * rate), rate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  const start = Math.max(0, song.segment.start - lead);
  gain.gain.setValueAtTime(0, 0);
  gain.gain.linearRampToValueAtTime(1, song.segment.fadeIn);
  gain.gain.setValueAtTime(1, Math.max(0, duration - song.segment.fadeOut));
  gain.gain.linearRampToValueAtTime(0, duration);
  src.connect(gain).connect(ctx.destination);
  src.start(0, start, duration);
  return ctx.startRendering();
}

// ---------- export ----------

export async function exportVideo(renderer, audio, onProgress = () => {}) {
  if ('VideoEncoder' in window) {
    try { return await exportWebCodecs(renderer, audio, onProgress); }
    catch (e) { console.warn('WebCodecs export failed, falling back to MediaRecorder', e); }
  }
  return exportRealtime(renderer, audio, onProgress);
}

async function exportWebCodecs(renderer, audio, onProgress) {
  const { Muxer, ArrayBufferTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs');
  const vcfg = { codec: 'avc1.640028', width: W, height: H, bitrate: 8_000_000, framerate: FPS };
  if (!(await VideoEncoder.isConfigSupported(vcfg)).supported) vcfg.codec = 'avc1.4d0028';
  if (!(await VideoEncoder.isConfigSupported(vcfg)).supported) throw new Error('H.264 encoding not supported');
  let acfg = audio && 'AudioEncoder' in window ? { codec: 'mp4a.40.2', sampleRate: audio.sampleRate, numberOfChannels: 2, bitrate: 192_000 } : null;
  if (acfg && !(await AudioEncoder.isConfigSupported(acfg)).supported) acfg = null;
  if (audio && !acfg) throw new Error('AAC encoding not supported');

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    video: { codec: 'avc', width: W, height: H, frameRate: FPS },
    audio: acfg ? { codec: 'aac', numberOfChannels: 2, sampleRate: acfg.sampleRate } : undefined,
  });
  let failed = null;
  const ve = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { failed = e; } });
  ve.configure(vcfg);

  if (acfg) {
    const ae = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { failed = e; } });
    ae.configure(acfg);
    const L = audio.getChannelData(0), R = audio.getChannelData(1);
    const N = 1024;
    for (let i = 0; i < audio.length; i += N) {
      const n = Math.min(N, audio.length - i);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: audio.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / audio.sampleRate) * 1e6), data });
      ae.encode(ad); ad.close();
    }
    await ae.flush();
  }

  const frames = Math.ceil(renderer.duration * FPS);
  for (let i = 0; i < frames; i++) {
    if (failed) throw failed;
    const cv = renderer.frame(i / FPS);
    const vf = new VideoFrame(cv, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    ve.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
    vf.close();
    if (ve.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 0));
    if (i % 5 === 0) { onProgress(i / frames); await new Promise((r) => setTimeout(r, 0)); }
  }
  await ve.flush();
  if (failed) throw failed;
  muxer.finalize();
  onProgress(1);
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), ext: 'mp4' };
}

async function exportRealtime(renderer, audio, onProgress) {
  const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const stream = renderer.canvas.captureStream(FPS);
  let actx, src;
  if (audio) {
    actx = new AudioContext({ sampleRate: audio.sampleRate });
    const dest = actx.createMediaStreamDestination();
    src = actx.createBufferSource(); src.buffer = audio; src.connect(dest);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  renderer.frame(0);
  rec.start();
  const t0 = performance.now();
  if (src) src.start();
  await new Promise((resolve) => {
    const tick = () => {
      const t = actx ? actx.currentTime : (performance.now() - t0) / 1000;
      if (t >= renderer.duration) return resolve();
      renderer.frame(t);
      onProgress(t / renderer.duration);
      requestAnimationFrame(tick);
    };
    tick();
  });
  rec.stop();
  await done;
  actx?.close();
  onProgress(1);
  return { blob: new Blob(chunks, { type: mime }), ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm' };
}
