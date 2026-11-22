// Pose geometry + detectors. Pure functions (no DOM) so they can be unit tested in Node.
// Points are {x, y} in "aspect space": x in [0, aspect], y in [0, 1], mirrored like the preview,
// so distances are true proportions. Face width (fw) is the unit for every threshold, which makes
// detection independent of how far the person stands from the camera.

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (...p) => ({ x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length });
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ---- hands (21 MediaPipe landmarks) ----
export function handInfo(lm) {
  const size = dist(lm[0], lm[9]); // wrist -> middle knuckle
  const ext = (tip) => dist(lm[0], lm[tip]) > dist(lm[0], lm[tip - 2]) * 1.12; // tip beyond the PIP joint
  const fingers = { index: ext(8), middle: ext(12), ring: ext(16), pinky: ext(20) };
  const thumb = dist(lm[4], lm[5]) > size * 0.5;
  const open = Object.values(fingers).filter(Boolean).length;
  const center = mid(lm[0], lm[5], lm[9], lm[13], lm[17]);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of lm) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { lm, size, fingers, thumb, open, center, box: { x0, y0, x1, y1 } };
}

// ---- face (478 FaceLandmarker points, or 33 PoseLandmarker points as a fallback) ----
export function faceFromMesh(lm, blend = null) {
  const eyes = [mid(lm[33], lm[133]), mid(lm[362], lm[263])].sort((a, b) => a.x - b.x);
  const mouth = mid(lm[13], lm[14]);
  const fw = dist(lm[234], lm[454]);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of lm) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { eyes, mouth, nose: lm[1], chin: lm[152], top: lm[10], fw, center: mid(eyes[0], eyes[1], mouth), box: { x0, y0, x1, y1 }, blend };
}

export function faceFromBody(p) {
  if (!p || !p[0] || (p[0].visibility ?? 1) < 0.5) return null;
  const eyes = [p[2], p[5]].sort((a, b) => a.x - b.x);
  const fw = dist(p[2], p[5]) * 2.3;
  const mouth = mid(p[9], p[10]);
  const nose = p[0];
  const center = mid(eyes[0], eyes[1], mouth);
  return {
    eyes, mouth, nose, fw, center, blend: null, fromBody: true,
    chin: { x: nose.x, y: nose.y + fw * 0.62 }, top: { x: nose.x, y: nose.y - fw * 0.8 },
    box: { x0: center.x - fw / 2, x1: center.x + fw / 2, y0: nose.y - fw * 0.8, y1: nose.y + fw * 0.62 },
  };
}

// ---- detectors ----
// Each returns { ok, progress 0..1, hint, targets: [{x, y, r, ok}] } for the guide overlay.

const NEED_FACE = { ok: false, progress: 0, hint: 'step into the frame', targets: [] };

function bite(F, hands) {
  const tips = hands.flatMap((h) => [h.lm[8], h.lm[4], h.lm[12]]);
  const best = tips.length ? Math.min(...tips.map((t) => dist(t, F.mouth))) / F.fw : 9;
  const ok = best < 0.34;
  return { ok, progress: clamp01(1.25 - best), hint: hands.length ? 'bring a fingertip to your lips' : 'raise a hand to your mouth',
    targets: [{ x: F.mouth.x, y: F.mouth.y, r: 0.2 * F.fw, ok }] };
}

function hide(F, hands, faceLost) {
  const near = (h) => dist(h.center, F.center) / F.fw < (faceLost ? 0.95 : 0.78);
  const covering = hands.filter(near).length;
  const ok = hands.length >= 2 && covering >= 2;
  const targets = F.eyes.map((e) => ({ x: e.x, y: e.y + 0.05 * F.fw, r: 0.3 * F.fw, ok: hands.some((h) => dist(h.center, e) < 0.6 * F.fw) }));
  return { ok, progress: covering / 2, hint: hands.length < 2 ? 'use both hands' : 'cover your face', targets };
}

function distance(F, hands) {
  const palms = hands.filter((h) => h.open >= 4);
  const placed = palms.filter((h) => Math.abs(h.center.x - F.center.x) > 0.55 * F.fw
    && h.center.y > F.top.y - 0.6 * F.fw && h.center.y < F.chin.y + 1.6 * F.fw);
  const ok = placed.length > 0;
  const ref = placed[0] || palms[0] || hands[0];
  const side = ref ? Math.sign(ref.center.x - F.center.x) || 1 : 1;
  return { ok, progress: ok ? 1 : palms.length ? 0.6 : hands.length ? 0.3 : 0,
    hint: palms.length ? 'move your palm beside your face' : 'open your hand flat toward the camera',
    targets: [{ x: F.center.x + side * 1.3 * F.fw, y: F.center.y, r: 0.48 * F.fw, ok }] };
}

function eye(F, hands) {
  let best = 9;
  for (const h of hands) {
    if (dist(h.lm[4], h.lm[8]) > h.size * 0.42) continue; // thumb + index must pinch into a circle
    const ring = mid(h.lm[4], h.lm[8]);
    best = Math.min(best, ...F.eyes.map((e) => dist(ring, e) / F.fw));
  }
  const b = F.blend;
  const wink = b && Math.abs((b.eyeBlinkLeft ?? 0) - (b.eyeBlinkRight ?? 0)) > 0.4 && Math.max(b.eyeBlinkLeft, b.eyeBlinkRight) > 0.5
    && hands.some((h) => h.center.y < F.chin.y + 0.4 * F.fw);
  const ok = best < 0.5 || !!wink;
  return { ok, progress: ok ? 1 : best < 9 ? clamp01(1.4 - best) : hands.length ? 0.25 : 0,
    hint: best < 9 ? 'bring the circle up to your eye' : 'make an OK circle with your fingers',
    targets: F.eyes.map((e) => ({ x: e.x, y: e.y, r: 0.2 * F.fw, ok })) };
}

function point(F, hands) {
  const inZone = (h) => Math.abs(h.center.x - F.center.x) < 1.15 * F.fw && h.center.y > F.chin.y - 0.1 * F.fw && h.center.y < F.chin.y + 2.6 * F.fw;
  const pointing = (h) => h.open <= 2 && !h.fingers.middle; // fist with (at most) the index out
  const ok = hands.some((h) => inZone(h) && pointing(h));
  return { ok, progress: ok ? 1 : hands.some(inZone) ? 0.6 : hands.length ? 0.3 : 0,
    hint: hands.some(inZone) ? 'curl your fingers, point with one' : 'point at your chest',
    targets: [{ x: F.center.x, y: F.chin.y + 1.0 * F.fw, r: 0.42 * F.fw, ok }] };
}

function shrug(F, hands) {
  const open = hands.filter((h) => h.open >= 3 && h.center.y > F.chin.y - 0.9 * F.fw && h.center.y < F.chin.y + 3 * F.fw);
  const left = open.some((h) => h.center.x < F.center.x - 0.85 * F.fw);
  const right = open.some((h) => h.center.x > F.center.x + 0.85 * F.fw);
  const ok = left && right;
  const y = F.chin.y + 1.0 * F.fw;
  return { ok, progress: (left + right) / 2, hint: hands.length < 2 ? 'both hands out, palms up' : 'spread your hands wider',
    targets: [{ x: F.center.x - 1.75 * F.fw, y, r: 0.5 * F.fw, ok: left }, { x: F.center.x + 1.75 * F.fw, y, r: 0.5 * F.fw, ok: right }] };
}

// Start gesture: two "L" hands (index up, other fingers curled) either side of the face.
function frame(F, hands) {
  const L = hands.filter((h) => h.fingers.index && !h.fingers.middle && !h.fingers.ring && h.center.y < F.chin.y + 1.4 * F.fw);
  const left = L.some((h) => h.center.x < F.center.x - 0.5 * F.fw);
  const right = L.some((h) => h.center.x > F.center.x + 0.5 * F.fw);
  const ok = left && right;
  const y = F.center.y + 0.3 * F.fw;
  return { ok, progress: (left + right) / 2, hint: 'make an L with each hand',
    targets: [{ x: F.center.x - 1.35 * F.fw, y, r: 0.42 * F.fw, ok: left }, { x: F.center.x + 1.35 * F.fw, y, r: 0.42 * F.fw, ok: right }] };
}

// ---- pose catalogue ----
// ghost: arm paths for the cut-out guide, in face-width units relative to the face centre (+x screen-right, +y down).
// Each arm = [elbow, wrist, hand]; `hand` also gets a size multiplier.
const DOWN_L = { elbow: [-1.55, 2.7], wrist: [-1.5, 3.9], hand: [-1.5, 4.3], size: 1 };
const DOWN_R = { elbow: [1.55, 2.7], wrist: [1.5, 3.9], hand: [1.5, 4.3], size: 1 };

export const POSES = {
  frame:    { name: 'start', instruction: 'make an L with both hands to begin', detect: frame,
              ghost: [{ elbow: [-1.6, 2.4], wrist: [-1.4, 1.2], hand: [-1.35, 0.45], size: 0.9 }, { elbow: [1.6, 2.4], wrist: [1.4, 1.2], hand: [1.35, 0.45], size: 0.9 }] },
  bite:     { name: 'the bite', instruction: 'bite your fingertip', detect: bite,
              ghost: [{ elbow: [-0.95, 2.7], wrist: [-0.35, 1.45], hand: [-0.08, 0.72], size: 0.8 }, DOWN_R] },
  hide:     { name: 'the hide', instruction: 'hide your face behind both hands', detect: hide,
              ghost: [{ elbow: [-1.05, 2.5], wrist: [-0.45, 1.15], hand: [-0.3, 0.15], size: 1 }, { elbow: [1.05, 2.5], wrist: [0.45, 1.15], hand: [0.3, 0.15], size: 1 }] },
  distance: { name: 'the distance', instruction: 'hold your palm out to the camera', detect: distance,
              ghost: [DOWN_L, { elbow: [1.95, 2.1], wrist: [1.4, 0.95], hand: [1.3, 0.1], size: 1.35 }] },
  eye:      { name: 'the eye', instruction: 'make an OK circle around one eye', detect: eye,
              ghost: [{ elbow: [-1.45, 2.3], wrist: [-0.75, 0.95], hand: [-0.42, -0.08], size: 0.85 }, DOWN_R] },
  point:    { name: 'the look', instruction: 'point at yourself, eyebrows up', detect: point,
              ghost: [{ elbow: [-1.25, 2.85], wrist: [-0.5, 2.15], hand: [-0.1, 1.85], size: 0.8 }, DOWN_R] },
  shrug:    { name: 'the shrug', instruction: 'shrug, palms up, under the mistletoe', detect: shrug, prop: 'mistletoe',
              ghost: [{ elbow: [-1.75, 2.6], wrist: [-1.95, 1.85], hand: [-1.85, 1.5], size: 1 }, { elbow: [1.75, 2.6], wrist: [1.95, 1.85], hand: [1.85, 1.5], size: 1 }] },
};

// Duo mode: with two people, each hand belongs to the nearest face (in face widths), each person is checked
// with their own hands, and the pose counts when either person nails it.
export function assignHands(faces, hands) {
  const groups = faces.map(() => []);
  for (const h of hands) {
    let best = 0, bd = Infinity;
    faces.forEach((f, k) => { const d = dist(h.center, f.center) / f.fw; if (d < bd) { bd = d; best = k; } });
    groups[best].push(h);
  }
  return groups;
}

// memory: { face, faceAt } remembered between frames so "hide" still works once the face is covered.
export function evaluatePose(id, frameData, memory, now) {
  const { face, hands, faces } = frameData;
  if (faces && faces.length > 1) {
    memory.face = face; memory.faceAt = now;
    const groups = assignHands(faces, hands);
    const results = faces.map((f, k) => POSES[id].detect(f, groups[k], false));
    return results.find((r) => r.ok) || results.reduce((a, r) => (r.progress > a.progress ? r : a));
  }
  let F = face, faceLost = false;
  if (face) { memory.face = face; memory.faceAt = now; }
  else if (memory.face && now - memory.faceAt < 2500) { F = memory.face; faceLost = true; }
  if (!F) return NEED_FACE;
  return POSES[id].detect(F, hands, faceLost);
}
