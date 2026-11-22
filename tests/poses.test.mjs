// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handInfo, evaluatePose } from '../js/poses.js';

// Synthetic upright hand: knuckles at (cx, cy), wrist below. `ext` = which fingers are straight.
function makeHand(cx, cy, s, ext = {}, thumbOut = true) {
  const p = Array(21);
  p[0] = { x: cx, y: cy + s };
  const fingers = [[5, -0.3, 'index'], [9, -0.1, 'middle'], [13, 0.1, 'ring'], [17, 0.3, 'pinky']];
  for (const [b, ox, name] of fingers) {
    const x = cx + ox * s;
    p[b] = { x, y: cy };
    p[b + 1] = { x, y: cy - 0.35 * s };
    p[b + 2] = ext[name] ? { x, y: cy - 0.55 * s } : { x, y: cy - 0.2 * s };
    p[b + 3] = ext[name] ? { x, y: cy - 0.75 * s } : { x, y: cy + 0.05 * s };
  }
  p[1] = { x: cx - 0.3 * s, y: cy + 0.7 * s };
  p[2] = { x: cx - 0.5 * s, y: cy + 0.5 * s };
  p[3] = { x: cx - 0.65 * s, y: cy + 0.3 * s };
  p[4] = thumbOut ? { x: cx - 0.95 * s, y: cy + 0.1 * s } : { x: cx - 0.3 * s, y: cy + 0.15 * s };
  return p;
}
const shift = (pts, dx, dy) => pts.map((q) => ({ x: q.x + dx, y: q.y + dy }));
const OPEN = { index: true, middle: true, ring: true, pinky: true };

const face = {
  eyes: [{ x: 0.82, y: 0.4 }, { x: 0.96, y: 0.4 }], mouth: { x: 0.89, y: 0.52 }, center: { x: 0.89, y: 0.44 },
  chin: { x: 0.89, y: 0.6 }, top: { x: 0.89, y: 0.26 }, fw: 0.3, blend: null,
};
const run = (id, hands, f = face) => evaluatePose(id, { face: f, hands: hands.map(handInfo) }, {}, 0);

test('finger extension', () => {
  const h = handInfo(makeHand(0.5, 0.5, 0.1, { index: true }));
  assert.deepEqual(h.fingers, { index: true, middle: false, ring: false, pinky: false });
  assert.equal(handInfo(makeHand(0.5, 0.5, 0.1, OPEN)).open, 4);
});

test('bite: fingertip at the lips', () => {
  const h = makeHand(0.5, 0.5, 0.1, { index: true });
  const tip = h[8];
  assert.equal(run('bite', [shift(h, face.mouth.x - tip.x, face.mouth.y - tip.y)]).ok, true);
  assert.equal(run('bite', [h]).ok, false);
});

test('distance: open palm beside the face only', () => {
  const beside = makeHand(face.center.x + 0.4, face.center.y, 0.12, OPEN);
  assert.equal(run('distance', [beside]).ok, true);
  assert.equal(run('distance', [makeHand(face.center.x + 0.4, face.center.y, 0.12, { index: true })]).ok, false);
});

test('shrug: open hands both sides', () => {
  const y = face.chin.y + 0.2;
  const L = makeHand(face.center.x - 0.5, y, 0.1, OPEN), R = makeHand(face.center.x + 0.5, y, 0.1, OPEN);
  assert.equal(run('shrug', [L, R]).ok, true);
  assert.equal(run('shrug', [L]).ok, false);
});

test('hide: works after the face is covered (memory)', () => {
  const mem = {};
  evaluatePose('hide', { face, hands: [] }, mem, 0);
  const hands = [makeHand(0.84, 0.47, 0.1, OPEN), makeHand(0.95, 0.47, 0.1, OPEN)].map(handInfo);
  assert.equal(evaluatePose('hide', { face: null, hands }, mem, 500).ok, true);
  assert.equal(evaluatePose('hide', { face: null, hands }, mem, 5000).ok, false); // memory expired
});

test('eye: pinch circle over an eye', () => {
  const h = makeHand(0.5, 0.5, 0.1, { middle: true, ring: true, pinky: true });
  h[4] = { ...h[8] }; // thumb tip meets index tip
  const ring = h[8];
  assert.equal(run('eye', [shift(h, face.eyes[0].x - ring.x, face.eyes[0].y - ring.y)]).ok, true);
});

test('duo: either person can trigger, hands go to the nearest face', () => {
  const other = { ...face, eyes: [{ x: 0.22, y: 0.4 }, { x: 0.36, y: 0.4 }], mouth: { x: 0.29, y: 0.52 }, center: { x: 0.29, y: 0.44 }, chin: { x: 0.29, y: 0.6 }, top: { x: 0.29, y: 0.26 } };
  const h = makeHand(0.5, 0.5, 0.1, { index: true });
  const atOtherMouth = shift(h, other.mouth.x - h[8].x, other.mouth.y - h[8].y);
  const r = evaluatePose('bite', { face, faces: [face, other], hands: [handInfo(atOtherMouth)] }, {}, 0);
  assert.equal(r.ok, true);
  // the same hand at person 2's mouth must not count as person 1 biting
  const solo = evaluatePose('bite', { face, faces: [face], hands: [handInfo(atOtherMouth)] }, {}, 0);
  assert.equal(solo.ok, false);
});
