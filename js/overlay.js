// Live overlay drawn above the mirrored camera: hand skeleton, pose cut-out guide, target zones, sparkles, props.
import { POSES } from './poses.js';

const HAND = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const TIPS = [4, 8, 12, 16, 20];

// Maps aspect space (poses.js) to pixels of a box showing the video with object-fit: cover.
export function coverMap(vw, vh, cw, ch) {
  const s = Math.max(cw / vw, ch / vh);
  const S = vh * s; // one aspect-space unit in px
  return { S, ox: (cw - vw * s) / 2, oy: (ch - vh * s) / 2 };
}
const px = (m, p) => ({ x: m.ox + p.x * m.S, y: m.oy + p.y * m.S });

export class Overlay {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.ghost = [0, 1, 2, 3].map(() => document.createElement('canvas'));
    this.anchor = null;
    this.sparkles = [];
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.c.width = Math.round(r.width * this.dpr);
    this.c.height = Math.round(r.height * this.dpr);
    for (const g of this.ghost) { g.width = this.c.width >> 1; g.height = this.c.height >> 1; }
    if (!this.sparkles.length) {
      for (let i = 0; i < 70; i++) this.sparkles.push({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7, ph: Math.random() * 6.28 });
    }
  }

  // state: { frame (from Vision), map, guide: {poseId, result} | null, matched, t, showGhost, showSkeleton }
  draw(state) {
    const { ctx, c } = this;
    ctx.clearRect(0, 0, c.width, c.height);
    const m = { ...state.map, S: state.map.S * this.dpr, ox: state.map.ox * this.dpr, oy: state.map.oy * this.dpr };
    const F = state.frame?.face;

    // smoothed anchor so the cut-out glides instead of jittering
    const aspect = state.frame?.aspect ?? 16 / 9;
    const target = F ? { x: F.center.x, y: F.center.y, fw: F.fw } : { x: aspect / 2, y: 0.4, fw: 0.17 };
    const a = this.anchor ?? target;
    const k = this.anchor ? 0.18 : 1;
    this.anchor = { x: a.x + (target.x - a.x) * k, y: a.y + (target.y - a.y) * k, fw: a.fw + (target.fw - a.fw) * k };

    this.drawSparkles(state.t);
    if (state.guide && state.showGhost) this.drawGhost(m, POSES[state.guide.poseId], state.matched, state.guide.result);
    if (state.guide?.result?.targets) this.drawTargets(m, state.guide.result.targets, state.t);
    if (state.progress > 0) this.drawHoldRing(m, state.progress);
    if (state.showSkeleton) for (const h of state.frame?.hands ?? []) this.drawHand(m, h);
    if (state.guide && POSES[state.guide.poseId].prop && F) drawProp(ctx, POSES[state.guide.poseId].prop, F, m, state.t);
  }

  drawHand(m, h) {
    const { ctx } = this;
    const P = h.lm.map((p) => px(m, p));
    const d = this.dpr;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,244,232,0.82)';
    ctx.lineWidth = 1.4 * d;
    ctx.shadowColor = 'rgba(255,210,200,0.6)';
    ctx.shadowBlur = 6 * d;
    ctx.beginPath();
    for (const [i, j] of HAND) { ctx.moveTo(P[i].x, P[i].y); ctx.lineTo(P[j].x, P[j].y); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,248,240,0.95)';
    for (let i = 0; i < 21; i++) {
      ctx.beginPath();
      ctx.arc(P[i].x, P[i].y, (TIPS.includes(i) ? 2.6 : 1.8) * d, 0, 6.283);
      ctx.fill();
    }
    for (const i of TIPS) star(ctx, P[i].x + 7 * d, P[i].y - 7 * d, 3.2 * d, 'rgba(255,255,255,0.9)');
    ctx.restore();
  }

  drawGhost(m, pose, matched, result) {
    const [A, B, C, D] = this.ghost;
    const half = { S: m.S / 2, ox: m.ox / 2, oy: m.oy / 2 };
    const o = px(half, this.anchor);
    const u = this.anchor.fw * half.S;
    paintGhost(A.getContext('2d'), C.getContext('2d'), o, u, pose, A.width, A.height);
    const color = matched ? '#ffd88a' : '#ffffff';
    outline(A, B, color);
    outline(C, D, color);
    // arms sit in front: hide the body outline wherever an arm covers it
    const b = B.getContext('2d');
    b.globalCompositeOperation = 'destination-out';
    b.drawImage(C, 0, 0);
    b.globalCompositeOperation = 'source-over';

    const { ctx, c } = this;
    const p = result?.progress ?? 0;
    ctx.save();
    ctx.globalAlpha = matched ? 0.04 : 0.11 - p * 0.04;
    ctx.drawImage(A, 0, 0, c.width, c.height);
    ctx.globalAlpha = matched ? 0.06 : 0.16 - p * 0.05;
    ctx.drawImage(C, 0, 0, c.width, c.height);
    ctx.globalAlpha = matched ? 0.95 : 0.78;
    ctx.shadowColor = matched ? 'rgba(255,190,90,0.9)' : 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 10 * this.dpr;
    ctx.drawImage(B, 0, 0, c.width, c.height);
    ctx.drawImage(D, 0, 0, c.width, c.height);
    ctx.restore();
  }

  drawTargets(m, targets, t) {
    const { ctx } = this;
    const d = this.dpr;
    for (const tg of targets) {
      const p = px(m, tg);
      const r = tg.r * m.S;
      ctx.save();
      if (tg.ok) {
        ctx.strokeStyle = 'rgba(255,214,140,0.95)';
        ctx.shadowColor = 'rgba(255,170,80,0.9)';
        ctx.shadowBlur = 16 * d;
        ctx.lineWidth = 3 * d;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.283); ctx.stroke();
      } else {
        const pulse = 1 + Math.sin(t * 4) * 0.05;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2 * d;
        ctx.setLineDash([6 * d, 7 * d]);
        ctx.lineDashOffset = -t * 20 * d;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * pulse, 0, 6.283); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // Progress ring around the head: fills while the pose is held, so the shot never feels random.
  drawHoldRing(m, p) {
    const { ctx } = this;
    const c = px(m, this.anchor), r = this.anchor.fw * m.S * 1.15, d = this.dpr;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 4 * d;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 6.283); ctx.stroke();
    ctx.strokeStyle = '#ffd88a';
    ctx.shadowColor = 'rgba(255,170,80,0.9)';
    ctx.shadowBlur = 14 * d;
    ctx.beginPath(); ctx.arc(c.x, c.y, r, -Math.PI / 2, -Math.PI / 2 + p * 6.283); ctx.stroke();
    ctx.restore();
  }

  drawSparkles(t) {
    const { ctx, c } = this;
    for (const s of this.sparkles) {
      const y = ((s.y + t * 0.012 * s.z) % 1) * c.height;
      const x = (s.x + Math.sin(t * 0.3 + s.ph) * 0.01) * c.width;
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.3 + s.ph));
      if (s.z > 0.85) star(ctx, x, y, 3 * s.z * this.dpr, `rgba(255,255,255,${0.7 * tw})`);
      else { ctx.fillStyle = `rgba(255,255,255,${0.45 * tw * s.z})`; ctx.fillRect(x, y, 1.6 * this.dpr * s.z, 1.6 * this.dpr * s.z); }
    }
  }
}

function star(ctx, x, y, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 ? r * 0.28 : r;
    const a = i * Math.PI / 4;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.fill();
  ctx.restore();
}

// Props are drawn both live and into the captured photo (same function, different mapping).
export function drawProp(ctx, prop, F, m, t) {
  if (prop !== 'mistletoe') return;
  const head = px(m, { x: F.center.x, y: F.top.y });
  const u = F.fw * m.S;
  const hx = head.x, hy = head.y - 0.55 * u;
  const sw = Math.sin(t * 1.6) * 0.05;
  ctx.save();
  ctx.translate(hx, 0);
  ctx.rotate(sw);
  // ribbon string
  ctx.strokeStyle = '#b3242c';
  ctx.lineWidth = Math.max(1.5, u * 0.018);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, hy); ctx.stroke();
  ctx.translate(0, hy);
  const s = u * 0.42;
  // leaves
  const leaf = (ang, len, col) => {
    ctx.save(); ctx.rotate(ang);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, col); g.addColorStop(1, '#1f3d27');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.bezierCurveTo(len * 0.38, len * 0.25, len * 0.3, len * 0.85, 0, len);
    ctx.bezierCurveTo(-len * 0.3, len * 0.85, -len * 0.38, len * 0.25, 0, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,240,200,0.35)'; ctx.lineWidth = len * 0.03;
    ctx.beginPath(); ctx.moveTo(0, len * 0.08); ctx.lineTo(0, len * 0.9); ctx.stroke();
    ctx.restore();
  };
  leaf(0.75, s, '#5f8f55'); leaf(-0.75, s, '#4f7f4a'); leaf(0.25, s * 0.9, '#3f6e44'); leaf(-0.25, s * 0.9, '#6b9a5d');
  // berries
  for (const [bx, by] of [[-0.1, 0.18], [0.1, 0.2], [0, 0.32]]) {
    const g = ctx.createRadialGradient(bx * s - s * 0.03, by * s - s * 0.03, 1, bx * s, by * s, s * 0.09);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#d9dccf');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(bx * s, by * s, s * 0.085, 0, 6.283); ctx.fill();
  }
  // bow
  ctx.fillStyle = '#c0262f';
  for (const dir of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.bezierCurveTo(dir * s * 0.45, -s * 0.3, dir * s * 0.5, s * 0.12, 0, 0); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.lineTo(dir * s * 0.18, s * 0.42); ctx.lineTo(dir * s * 0.06, s * 0.4); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#8e1820';
  ctx.beginPath(); ctx.arc(0, 0, s * 0.07, 0, 6.283); ctx.fill();
  ctx.restore();
}

// Body silhouette into `a`, arms + hands into `b` (separate so arms can be outlined on top of the body).
function paintGhost(a, b, o, u, pose, w, h) {
  const P = ([x, y]) => [o.x + x * u, o.y + y * u];
  for (const g of [a, b]) { g.clearRect(0, 0, w, h); g.fillStyle = g.strokeStyle = '#fff'; g.lineCap = g.lineJoin = 'round'; }
  a.beginPath(); a.ellipse(o.x, o.y - 0.12 * u, 0.56 * u, 0.76 * u, 0, 0, 6.283); a.fill();
  a.fillRect(o.x - 0.24 * u, o.y + 0.4 * u, 0.48 * u, 0.9 * u);
  a.beginPath();
  a.moveTo(...P([-0.3, 1.15]));
  a.quadraticCurveTo(...P([-1.0, 1.25]), ...P([-1.35, 1.6]));
  a.lineTo(...P([-1.25, 5])); a.lineTo(...P([1.25, 5])); a.lineTo(...P([1.35, 1.6]));
  a.quadraticCurveTo(...P([1.0, 1.25]), ...P([0.3, 1.15]));
  a.closePath(); a.fill();
  for (const arm of pose.ghost) {
    b.lineWidth = 0.46 * u;
    b.beginPath();
    b.moveTo(...P([Math.sign(arm.elbow[0]) * 1.18, 1.7])); b.lineTo(...P(arm.elbow)); b.lineTo(...P(arm.wrist)); b.lineTo(...P(arm.hand));
    b.stroke();
    b.beginPath(); b.ellipse(...P(arm.hand), 0.3 * arm.size * u, 0.36 * arm.size * u, 0, 0, 6.283); b.fill();
  }
}

// dst = src dilated by ~1.6px minus src, tinted.
function outline(src, dst, color) {
  const b = dst.getContext('2d');
  b.clearRect(0, 0, dst.width, dst.height);
  b.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 8; i++) b.drawImage(src, Math.cos(i * 0.785) * 1.6, Math.sin(i * 0.785) * 1.6);
  b.globalCompositeOperation = 'destination-out';
  b.drawImage(src, 0, 0);
  b.globalCompositeOperation = 'source-in';
  b.fillStyle = color;
  b.fillRect(0, 0, dst.width, dst.height);
  b.globalCompositeOperation = 'source-over';
}

// Small static ghost icon for the pose tray: faint body, bright arms.
export function ghostIcon(poseId, size = 96) {
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
  const out = mk(), body = mk(), arms = mk();
  paintGhost(body.getContext('2d'), arms.getContext('2d'), { x: size / 2, y: size * 0.3 }, size / 5.6, POSES[poseId], size, size);
  const o = out.getContext('2d');
  o.globalAlpha = 0.35; o.drawImage(body, 0, 0);
  o.globalAlpha = 0.95; o.drawImage(arms, 0, 0);
  return out;
}
