import { POSES, evaluatePose } from './poses.js';
import { Overlay, coverMap, ghostIcon } from './overlay.js';
import { FILMS, FILM_CSS, developPhoto, smartCrop, canvas } from './film.js';
import { LAYOUTS, FRAMES, frameTheme, renderStrip, cellRects, cellAspect, footerTop, stripSize, printSheet, warmStrip } from './strip.js';
import { PACKS, packPreview, stickerLayer } from './stickers.js';
import { SONGS, DEFAULT_SONG, beatsFor } from './songs.js';
import { createRenderer, exportVideo, songSegment, LYRIC_STYLES, SURFACES } from './video.js';

const $ = (s) => document.querySelector(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const song = SONGS[DEFAULT_SONG];
// Print + video resolution. Phones / low-memory devices get 450 dpi so big canvases don't crash the tab.
const LOW_MEM = (navigator.deviceMemory && navigator.deviceMemory <= 4) || matchMedia('(pointer: coarse)').matches;
const DPI = LOW_MEM ? 450 : 600;
const HOLD_MS = 350, COUNT_MS = 650, LOST_MS = 900;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const motionMs = (ms) => (REDUCED ? 1 : ms);
// Damped-spring curve as a CSS linear() easing, so the print lands with physical weight (fallback: a bezier overshoot).
const springEase = (zeta = 0.5, w = 13) => {
  const wd = w * Math.sqrt(1 - zeta * zeta), pts = [];
  for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push((1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + (zeta * w / wd) * Math.sin(wd * t))).toFixed(4)); }
  return `linear(${pts.join(',')})`;
};
const EASE_SPRING = CSS.supports('transition-timing-function', 'linear(0, 1)') ? springEase() : 'cubic-bezier(.2,.9,.25,1.15)';
const SHARE_API = 'https://holdit-share.mahitp-16.workers.dev'; // share-worker/: QR links, files expire after 24 h
const SHARE_TEXT = 'last christmas photobooth, one pose per lyric #lastchristmas #photobooth #christmas';

// ---------- settings (remembered per browser) ----------
const store = {
  get(k, d, valid) { try { const v = localStorage.getItem(`pb.${k}`); return v != null && (!valid || valid[v]) ? v : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`pb.${k}`, v); } catch { /* private mode */ } },
};
const MODES = { pose: 'Pose', timer: 'Timer' };
const TIMERS = { 3: '3s', 5: '5s', 10: '10s' };
const GROUPS = { film: FILMS, lyric: LYRIC_STYLES, surface: SURFACES, layout: LAYOUTS, mode: MODES, timer: TIMERS };
const opts = {
  layout: store.get('layout', '2x3', LAYOUTS), film: store.get('film', 'bw', FILMS),
  lyric: store.get('lyric', 'serif', LYRIC_STYLES), surface: store.get('surface', 'wood', SURFACES),
  mode: store.get('mode', 'pose', MODES), timer: store.get('timer', '5', TIMERS),
  frame: store.get('frame', 'white'), custom: store.get('custom', '#e8d8c3'), pack: store.get('pack', 'none', PACKS),
  seed: 1, showDate: store.get('showDate', '1') === '1', showCaptions: store.get('showCaptions', '1') === '1',
  flash: store.get('flash', 'on') === 'on',
};
const frameHex = () => (opts.frame === 'custom' ? opts.custom : (FRAMES[opts.frame] ?? FRAMES.white).hex);

function buildChips() {
  for (const el of document.querySelectorAll('.chips[data-group]')) {
    const g = el.dataset.group;
    el.setAttribute('role', 'radiogroup');
    el.innerHTML = Object.entries(GROUPS[g]).map(([id, v]) => `<button type="button" role="radio" data-id="${id}" aria-checked="${opts[g] === id}">${typeof v === 'string' ? v : v.label}</button>`).join('');
    el.insertAdjacentHTML('afterbegin', '<i class="pill" aria-hidden="true"></i>'); // sliding highlight behind the chosen option
    el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setOpt(g, b.dataset.id); });
  }
  $('.layouts').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setOpt('layout', b.dataset.layout); });
  syncChips();
}
function syncChips() {
  for (const el of document.querySelectorAll('.chips[data-group]')) {
    for (const b of el.querySelectorAll('button')) b.setAttribute('aria-checked', b.dataset.id === opts[el.dataset.group]);
    const pill = el.querySelector('.pill'), on = el.querySelector('[aria-checked="true"]');
    if (pill && on) Object.assign(pill.style, { left: `${on.offsetLeft}px`, top: `${on.offsetTop}px`, width: `${on.offsetWidth}px`, height: `${on.offsetHeight}px` });
  }
  for (const b of document.querySelectorAll('.layouts button')) b.setAttribute('aria-checked', b.dataset.layout === opts.layout);
  // the timer lengths only matter in timer mode
  $('#timer-chips').hidden = opts.mode !== 'timer';
  $('#mode-hint').textContent = opts.mode === 'pose'
    ? 'Hands-free: the camera fires the moment you match each pose.'
    : `A ${opts.timer}-second countdown for every photo. The pose guide still shows you what to do.`;
}
function setOpt(g, v) {
  if (opts[g] === v) return;
  opts[g] = v; store.set(g, v); syncChips();
  if (g === 'mode' || g === 'timer') requestAnimationFrame(syncChips); // timer chips just became visible
  if (['layout', 'film'].includes(g)) renderPreview();
  if (g === 'film' && $('#result').classList.contains('active')) developStrip(false);
  if (['lyric', 'surface'].includes(g)) markVideoStale();
}

function show(id) {
  const swap = () => { for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === id); window.scrollTo(0, 0); };
  // native cross-document-free transition between screens; plain swap when unsupported or reduced motion
  if (document.startViewTransition && !REDUCED) document.startViewTransition(swap); else swap();
}
function setText(sel, text) { const el = $(sel); if (el.textContent !== text) el.textContent = text; }
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
}

const fontsReady = () => Promise.all(['40px "Pinyon Script"', '20px "Homemade Apple"', '12px "Courier Prime"', '600 20px "Bodoni Moda"',
  '40px "Libre Caslon Text"', '700 40px "TikTok Sans"'].map((f) => document.fonts.load(f))).catch(() => {});

// ---------- home preview ----------
const PREVIEW_TONES = { bw: ['#9a9692', '#4a4846'], noir: ['#8a8784', '#232221'], sepia: ['#8a6c50', '#4a3626'], color: ['#b9a596', '#6b5a52'],
  vivid: ['#c9a28c', '#6e4a40'], golden: ['#c4a47c', '#6e5238'], cool: ['#a7b0b7', '#535e68'], soft: ['#cbbdb2', '#8c7e76'] };
let previewToken = 0;
async function renderPreview() {
  const token = ++previewToken;
  await fontsReady();
  const L = LAYOUTS[opts.layout];
  const dpi = 150;
  const rects = cellRects(opts.layout, dpi);
  const beats = song.beats.slice(0, L.count);
  const tone = PREVIEW_TONES[opts.film];
  const photos = rects.map((r, i) => {
    const c = canvas(r.w, r.h), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, r.h);
    g.addColorStop(0, tone[0]); g.addColorStop(1, tone[1]);
    x.fillStyle = g; x.fillRect(0, 0, r.w, r.h);
    const icon = ghostIcon(beats[i].pose, Math.round(Math.min(r.w, r.h) * 0.95));
    x.drawImage(icon, (r.w - icon.width) / 2, r.h - icon.height * 0.92);
    return c;
  });
  const { W, H } = stripSize(opts.layout, dpi);
  const stickers = await stickerLayer(opts.pack, W, H, rects, footerTop(opts.layout, dpi), dpi, opts.seed).catch(() => null);
  if (token !== previewToken) return;
  const strip = renderStrip({ layoutId: opts.layout, frame: frameHex(), photos, captions: opts.showCaptions ? beats.map((b) => b.caption) : [], note: store.get('note', ''), showDate: opts.showDate, stickers, dpi });
  $('#preview').src = strip.toDataURL('image/jpeg', 0.9);
}

// ---------- audio ----------
let actx = null, songBuffer = null, muted = false;
const audioCtx = () => (actx ??= new AudioContext());

async function loadSong() {
  try {
    const r = await fetch(song.src);
    if (!r.ok) throw new Error(r.status);
    songBuffer = await audioCtx().decodeAudioData(await r.arrayBuffer());
  } catch {
    songBuffer = null;
  }
}

// The song as a cue: each pose plays just its own lyric ("once bitten…"), then goes quiet while you pose.
// The next line only plays once the photo is taken, so the song walks you through the shoot.
let cue = null;
function stopCue(fade = 0.12) {
  if (!cue) return;
  const ac = audioCtx(), now = ac.currentTime;
  cue.gain.gain.cancelScheduledValues(now);
  cue.gain.gain.setValueAtTime(cue.gain.gain.value, now);
  cue.gain.gain.linearRampToValueAtTime(0, now + fade);
  cue.src.stop(now + fade + 0.02);
  cue = null;
}
function playCue(k, vol = 0.75) {
  stopCue();
  if (muted || !songBuffer) return;
  const ac = audioCtx(), now = ac.currentTime;
  const t = song.beats[k].lines[0].t;
  const next = song.beats[k + 1]?.lines[0].t ?? song.end;
  const lead = 0.12; // don't clip the first syllable
  const dur = next - t + lead;
  const src = ac.createBufferSource(), gain = ac.createGain();
  src.buffer = songBuffer;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(vol, now + 0.06);
  gain.gain.setValueAtTime(vol, now + dur - 0.4);
  gain.gain.linearRampToValueAtTime(0, now + dur);
  src.connect(gain).connect(ac.destination);
  src.start(now, song.segment.start + t - lead, dur);
  cue = { src, gain };
}

function noiseBurst(at, dur, freq, vol) {
  const ac = audioCtx();
  const n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
  const src = ac.createBufferSource(); src.buffer = buf;
  const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.9;
  const g = ac.createGain(); g.gain.value = vol;
  src.connect(f).connect(g).connect(ac.destination);
  src.start(ac.currentTime + at);
}
function shutter() {
  navigator.vibrate?.(35);
  if (muted) return;
  noiseBurst(0, 0.05, 2600, 0.9); noiseBurst(0.07, 0.09, 1500, 0.7);
}
// soft blip on each countdown number, higher on the last one
function tick(n) {
  if (muted) return;
  const ac = audioCtx();
  const o = ac.createOscillator(), g = ac.createGain();
  o.frequency.value = n === 1 ? 1320 : 880;
  g.gain.setValueAtTime(0.0001, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.12, ac.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.12);
  o.connect(g).connect(ac.destination);
  o.start(); o.stop(ac.currentTime + 0.13);
  noiseBurst(0, 0.02, 3200, 0.25); // mechanical click under the blip
}

// ---------- booth ----------
const video = $('#cam');
const overlay = new Overlay($('#overlay'));
let vision = null;
const B = {
  active: false, phase: 'idle', cur: 0, queue: [], history: [], photos: [], beats: [], end: 0, layout: '2x3', retakeOne: false,
  memory: {}, frame: null, hold: null, lost: null, cdStart: 0, cdShown: 0, manual: false, poseStart: 0, timerEnd: 0,
  stream: null, mirrored: true, devices: [], devIdx: 0, wake: null, dark: false, lightAt: 0, ring: [], ringAt: 0,
};

function trayIcon(li, k) {
  li.innerHTML = '';
  const p = B.photos[k];
  if (p) { const im = new Image(); im.src = p.thumb; im.alt = p.caption; im.style.filter = FILM_CSS[opts.film]; li.append(im); }
  else li.append(ghostIcon(B.beats[k].pose, 96));
}
function buildTray() {
  const tray = $('#tray');
  tray.style.setProperty('--cell', cellAspect(B.layout));
  tray.innerHTML = '';
  B.beats.forEach((b, k) => {
    const li = document.createElement('li');
    li.title = b.caption;
    trayIcon(li, k);
    tray.append(li);
  });
}

const HAS_RVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
function watchFrames() {
  if (!HAS_RVFC) return;
  const onFrame = () => { B.newFrame = true; if (B.stream) video.requestVideoFrameCallback(onFrame); };
  video.requestVideoFrameCallback(onFrame);
}

async function startCamera(deviceId) {
  B.stream?.getTracks().forEach((t) => t.stop());
  const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  B.stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: 'user', ...size }, audio: false });
  video.srcObject = B.stream;
  await video.play();
  watchFrames();
  // a rear camera shouldn't be mirrored, a selfie camera should
  const s = B.stream.getVideoTracks()[0]?.getSettings() ?? {};
  B.mirrored = s.facingMode !== 'environment';
  video.style.transform = B.mirrored ? 'scaleX(-1)' : 'none';
  B.devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  B.devIdx = Math.max(0, B.devices.findIndex((d) => d.deviceId === s.deviceId));
  $('#flip').hidden = B.devices.length < 2;
}

async function keepAwake() {
  try { B.wake = await navigator.wakeLock?.request('screen'); } catch { /* not supported / denied */ }
}

// only: index of a single photo to retake from the result screen
async function enterBooth(only = null) {
  audioCtx().resume();
  document.activeElement?.blur();
  const retakeOne = Number.isInteger(only) && !!R.photos;
  const layout = retakeOne ? R.layout : opts.layout;
  const { beats, end } = retakeOne ? { beats: R.beats, end: R.end } : beatsFor(song, LAYOUTS[layout].count);
  const queue = retakeOne ? [only] : beats.map((_, k) => k);
  Object.assign(B, { beats, end, layout, retakeOne, photos: retakeOne ? R.photos.slice() : [], queue, cur: queue.shift(), history: [],
    memory: {}, phase: 'loading', hold: null, lost: null, active: true, ring: [] });
  show('booth');
  buildTray();
  video.style.filter = FILM_CSS[opts.film];
  $('#loading').classList.remove('hide');
  setText('#loading p', 'warming up the booth…');
  setText('#instruction', ''); setText('#meta', ''); setText('#hint', '');
  $('#undo').hidden = true;
  $('#timer-pill').hidden = true;
  overlay.resize();

  try {
    await startCamera();
  } catch (e) {
    setText('#loading p', 'The booth needs your camera. Allow camera access, or go back and use photos from your camera roll.');
    return;
  }
  if (!vision) {
    try {
      const { Vision } = await import('./vision.js');
      const v = new Vision();
      await v.init((s) => setText('#loading p', s));
      vision = v;
    } catch (e) {
      console.error(e);
      setText('#hint', 'Pose detection could not load here. Use the snap button for each pose.');
    }
  }
  if (!B.active) return;
  $('#loading').classList.add('hide');
  keepAwake();
  if (retakeOne) beginPoses(); else { B.phase = 'start'; B.poseStart = performance.now(); }
  requestAnimationFrame(loop);
}

function leaveBooth() {
  B.active = false;
  B.phase = 'idle';
  B.stream?.getTracks().forEach((t) => t.stop());
  B.stream = null;
  B.wake?.release().catch(() => {});
  B.wake = null;
  stopCue();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// average brightness of a tiny copy of the frame, about once a second
const lightCanvas = canvas(24, 14);
function checkLight(now) {
  if (now - B.lightAt < 1000 || video.readyState < 2) return;
  B.lightAt = now;
  const x = lightCanvas.getContext('2d', { willReadFrequently: true });
  x.drawImage(video, 0, 0, 24, 14);
  const d = x.getImageData(0, 0, 24, 14).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
  B.dark = sum / (d.length / 4) < 62;
}

// "Live photo": keep the last ~1.1 s of small frames so each photo also has a moving clip for the GIF.
const CLIP_W = 360, CLIP_N = 12, CLIP_MS = 90;
function recordClip(now) {
  if (now - B.ringAt < CLIP_MS || !video.videoWidth) return;
  B.ringAt = now;
  const c = canvas(CLIP_W, Math.round(CLIP_W * video.videoHeight / video.videoWidth)), x = c.getContext('2d');
  if (B.mirrored) { x.translate(c.width, 0); x.scale(-1, 1); }
  x.drawImage(video, 0, 0, c.width, c.height);
  B.ring.push(c);
  if (B.ring.length > CLIP_N) B.ring.shift();
}

function loop() {
  if (!B.active) return;
  requestAnimationFrame(loop);
  const now = performance.now();
  const t = now / 1000;
  // show() swaps screens inside a view transition, so the booth may still have been hidden (0×0) when entered
  if (!overlay.c.width && overlay.c.clientWidth) overlay.resize();
  if (!overlay.c.width) return;
  // the camera delivers ~30 fps but the screen refreshes at 60-120 Hz: only run the models on a new frame
  if (vision && video.readyState >= 2 && (B.newFrame || !HAS_RVFC)) { B.newFrame = false; B.frame = vision.detect(video, B.mirrored); }
  checkLight(now);
  if (B.phase === 'pose' || B.phase === 'countdown' || B.phase === 'timer') recordClip(now);
  const map = coverMap(video.videoWidth || 16, video.videoHeight || 9, overlay.c.clientWidth, overlay.c.clientHeight);
  const poseId = B.phase === 'start' ? 'frame' : B.beats[B.cur]?.pose;
  const result = poseId && B.frame ? evaluatePose(poseId, B.frame, B.memory, now) : null;
  const ok = !!result?.ok;
  const darkHint = B.dark ? 'a little dark here: face a lamp or window' : '';

  if (B.phase === 'start') {
    setText('#meta', 'or press space');
    setText('#instruction', POSES.frame.instruction);
    trackHold(ok, now, 800, () => beginPoses());
    setText('#hint', ok ? 'hold it…' : darkHint);
  } else if (B.phase === 'pose') {
    trackHold(ok, now, HOLD_MS, () => startCountdown(false));
    const stuck = now - B.poseStart > 9000;
    if (now - B.poseStart > 11000 && !B.cueAgain) { B.cueAgain = true; playCue(B.cur, 0.45); } // one gentle reminder
    setText('#hint', ok ? 'hold it…' : stuck ? 'having trouble? press space to snap' : darkHint || (result?.hint ?? ''));
  } else if (B.phase === 'timer') {
    const left = Math.ceil((B.timerEnd - now) / 1000);
    if (left <= 0) capture();
    else if (left <= 3) { $('#timer-pill').hidden = true; setCountdown(left); }
    else { const pill = $('#timer-pill'); pill.hidden = false; setText('#timer-pill', String(left)); }
    setText('#hint', ok ? 'perfect, hold it…' : darkHint || (result?.hint ?? ''));
  } else if (B.phase === 'countdown') {
    if (ok) B.lost = null; else B.lost ??= now;
    if (!B.manual && B.lost && now - B.lost > LOST_MS) {
      B.phase = 'pose'; B.hold = null; setCountdown('');
      setText('#hint', 'hold the pose until the flash');
    } else {
      const n = 3 - Math.floor((now - B.cdStart) / COUNT_MS);
      if (n <= 0) capture(); else setCountdown(n);
    }
  }

  const progress = B.hold ? Math.min(1, (now - B.hold) / (B.phase === 'start' ? 800 : HOLD_MS)) : 0;
  overlay.draw({ frame: B.frame, map, guide: poseId && B.phase !== 'capture' ? { poseId, result } : null, matched: ok, t, progress, showGhost: true, showSkeleton: true });
}

function trackHold(ok, now, need, done) {
  if (ok) { B.hold ??= now; B.lost = null; if (now - B.hold >= need) { B.hold = null; done(); } }
  else if (B.hold) { B.lost ??= now; if (now - B.lost > 250) { B.hold = null; B.lost = null; } }
}

function setPoseUI() {
  const beat = B.beats[B.cur];
  const lyric = beat.lines.map((l) => l.text).join(' ');
  setText('#meta', `${B.retakeOne ? 'retake · ' : ''}pose ${B.cur + 1} of ${B.beats.length}  ·  “${lyric}”`);
  setText('#instruction', POSES[beat.pose].instruction);
  [...$('#tray').children].forEach((li, k) => li.classList.toggle('now', k === B.cur));
  $('#undo').hidden = !B.history.length;
}

function beginPoses() {
  B.hold = null; B.poseStart = performance.now(); B.cueAgain = false; B.ring = [];
  // timer mode: every photo gets the same countdown, the pose guide is advisory
  if (opts.mode === 'timer') { B.phase = 'timer'; B.timerEnd = B.poseStart + Number(opts.timer) * 1000; B.cdShown = 0; }
  else B.phase = 'pose';
  setPoseUI();
  playCue(B.cur);
}

function startCountdown(manual) {
  B.phase = 'countdown'; B.cdStart = performance.now(); B.manual = manual; B.lost = null; B.cdShown = 0;
  $('#timer-pill').hidden = true;
}

function setCountdown(n) {
  const el = $('#countdown');
  if (B.cdShown === n) return;
  B.cdShown = n;
  el.textContent = n;
  el.classList.remove('tick'); void el.offsetWidth;
  if (n) {
    el.classList.add('tick'); tick(n);
    // the last "1" jolts like a flash bulb going off
    if (n === 1) el.animate([{ translate: '0 0' }, { translate: '-10px 0' }, { translate: '9px 0' }, { translate: '-5px 0' }, { translate: '0 0' }], { duration: motionMs(360) });
  }
}

// Go back one shot: forget the last photo and pose it again.
function undo() {
  if (!['pose', 'timer'].includes(B.phase) || !B.history.length) return;
  const k = B.history.pop();
  B.queue.unshift(B.cur);
  B.cur = k;
  B.photos[k] = undefined;
  trayIcon($('#tray').children[k], k);
  beginPoses();
}

async function capture() {
  B.phase = 'capture';
  setCountdown('');
  $('#timer-pill').hidden = true;
  const k = B.cur;
  const beat = B.beats[k];
  const clip = B.ring.slice(); // the live-photo frames leading up to the shot
  B.ring = [];
  const flash = $('#flash');
  // screen flash: light the face with a white screen for a moment before the frame is grabbed, like a selfie flash
  if (opts.flash) { flash.classList.remove('go'); flash.classList.add('fill'); await wait(170); }

  const vw = video.videoWidth, vh = video.videoHeight;
  const raw = canvas(vw, vh);
  const ctx = raw.getContext('2d');
  if (B.mirrored) { ctx.translate(vw, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, vw, vh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const F = B.frame?.face || B.memory.face; // props like the mistletoe are on-screen guides only, never in the photo

  // focus box (px): every face incl. hair + every hand, used for smart cropping; faces alone for lyric placement
  const faces = B.frame?.faces?.length ? B.frame.faces : F ? [F] : [];
  let face = null, focus = null;
  const grow = (a, b) => (a ? { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) } : { ...b });
  for (const f of faces) {
    const h = f.box.y1 - f.box.y0;
    face = grow(face, { x0: f.box.x0 * vh, x1: f.box.x1 * vh, y0: (f.box.y0 - h * 0.35) * vh, y1: f.box.y1 * vh });
  }
  if (face) {
    focus = { ...face, faceY: (faces.reduce((s, f) => s + f.center.y, 0) / faces.length) * vh };
    for (const hd of B.frame?.hands ?? []) focus = { ...grow(focus, { x0: hd.box.x0 * vh, x1: hd.box.x1 * vh, y0: hd.box.y0 * vh, y1: hd.box.y1 * vh }), faceY: focus.faceY };
  }

  const crop = smartCrop(vw, vh, focus, cellAspect(B.layout));
  const thumb = canvas(640, 640 / cellAspect(B.layout));
  thumb.getContext('2d').drawImage(raw, crop.x, crop.y, crop.w, crop.h, 0, 0, thumb.width, thumb.height);
  const url = thumb.toDataURL('image/jpeg', 0.85);
  // a couple of frames after the shutter too, so the live clip doesn't end abruptly
  B.photos[k] = { raw, face, focus, caption: beat.caption, thumb: url, clip: [...clip, raw] };

  flash.classList.remove('fill'); void flash.offsetWidth; flash.classList.add('go');
  // the lens squeezes a touch on the shot
  const camBase = B.mirrored ? 'scaleX(-1)' : 'scaleX(1)';
  video.animate([{ transform: camBase }, { transform: `${camBase} scale(.975)` }, { transform: camBase }], { duration: motionMs(300), easing: 'ease-out' });
  shutter();

  // the print drops in, then flies into its tray slot
  const card = $('#print');
  const img = card.querySelector('img');
  img.src = url; img.style.filter = FILM_CSS[opts.film];
  // the caption writes itself in, one word at a time, on the shot's lyric
  card.querySelector('span').replaceChildren(...beat.caption.split(' ').map((w, i) => {
    const s = document.createElement('i');
    s.textContent = `${w} `; s.style.setProperty('--i', i);
    return s;
  }));
  const base = 'translate(-50%, -50%) rotate(-3deg)';
  await card.animate([{ opacity: 0, transform: 'translate(-50%, -62%) rotate(-9deg) scale(1.08)' }, { opacity: 1, transform: base }],
    { duration: motionMs(900), easing: EASE_SPRING, fill: 'forwards' }).finished;
  await wait(950);
  const slot = $('#tray').children[k];
  const sr = slot.getBoundingClientRect(), cr = card.getBoundingClientRect();
  const dx = sr.left + sr.width / 2 - (cr.left + cr.width / 2), dy = sr.top + sr.height / 2 - (cr.top + cr.height / 2);
  await card.animate([{ opacity: 1, transform: base }, { opacity: 0.2, transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(0deg) scale(${sr.width / cr.width})` }],
    { duration: 520, easing: 'cubic-bezier(.55,0,.7,.2)', fill: 'forwards' }).finished;
  card.getAnimations().forEach((a) => a.cancel());
  trayIcon(slot, k);
  if (!B.active) return;

  B.history.push(k);
  if (!B.queue.length) return finish();
  predevelop(k);
  B.cur = B.queue.shift();
  beginPoses();
}

// ---------- upload: use photos from the camera roll instead of the camera ----------
async function fromUpload(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (!list.length) return;
  const { beats, end } = beatsFor(song, LAYOUTS[opts.layout].count);
  if (list.length < beats.length) toast(`Picked ${list.length} of ${beats.length}, repeating some to fill the strip`);
  const aspect = cellAspect(opts.layout);
  const photos = [];
  for (let k = 0; k < beats.length; k++) {
    const file = list[k % list.length];
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) { toast('One of those photos could not be opened'); return; }
    const s = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
    const raw = canvas(bmp.width * s, bmp.height * s);
    raw.getContext('2d').drawImage(bmp, 0, 0, raw.width, raw.height);
    const crop = smartCrop(raw.width, raw.height, null, aspect);
    const thumb = canvas(640, 640 / aspect);
    thumb.getContext('2d').drawImage(raw, crop.x, crop.y, crop.w, crop.h, 0, 0, thumb.width, thumb.height);
    photos.push({ raw, face: null, focus: null, caption: beats[k].caption, thumb: thumb.toDataURL('image/jpeg', 0.85), clip: null });
  }
  Object.assign(B, { photos, beats, end, layout: opts.layout, retakeOne: false });
  finish();
}

// ---------- result ----------
const R = { photos: null, beats: null, end: 0, layout: '2x3', strip: null, stripBlob: null, rects: null, faces: null, stripUrl: null,
  videoUrl: null, videoBlob: null, videoExt: 'mp4', rendering: false, token: 0, stripBlobFor: null, note: store.get('note', ''), stickers: new Map() };

async function finish() {
  leaveBooth();
  Object.assign(R, { photos: B.photos, beats: B.beats, end: B.end, layout: B.layout });
  show('result');
  requestAnimationFrame(syncChips); // chips were hidden while the booth ran, so place their highlight now
  closeVideo();
  clearVideo();
  $('#audio-note').hidden = !!songBuffer;
  $('#audio-note').textContent = songBuffer ? '' : `Add ${song.src} to put the song in the video.`;
  $('#dl-print').hidden = R.layout !== '1x4';
  $('#note').value = R.note;
  $('#show-date').checked = opts.showDate;
  $('#show-captions').checked = opts.showCaptions;
  await wait(30);
  await developStrip(true);
}

// One photo, developed for a film at print size. Cached on the photo, so restyling back and forth is instant.
function developOne(p, k, layout, film) {
  p.dev ??= {};
  if (p.dev[film]) return p.dev[film];
  const rect = cellRects(layout, DPI)[k];
  const crop = smartCrop(p.raw.width, p.raw.height, p.focus, cellAspect(layout));
  const img = developPhoto(p.raw, crop, rect.w, rect.h, film, 101 + k);
  const face = p.face && { x0: (p.face.x0 - crop.x) / crop.w, x1: (p.face.x1 - crop.x) / crop.w, y0: (p.face.y0 - crop.y) / crop.h, y1: (p.face.y1 - crop.y) / crop.h };
  return (p.dev[film] = { img, face });
}

// Develop each shot while the next pose is being set up, so the strip is nearly ready the moment the last photo lands.
const idle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 400));
function predevelop(k) {
  const p = B.photos[k], layout = B.layout, film = opts.film;
  idle(() => { if (B.photos[k] === p) developOne(p, k, layout, film); });
  if (k === 0) idle(() => warmStrip(layout, frameHex(), DPI)); // paper texture, built once
}

async function stickersFor(layout) {
  if (opts.pack === 'none') return null;
  const key = `${layout}:${opts.pack}:${opts.seed}`;
  if (!R.stickers.has(key)) {
    const { W, H } = stripSize(layout, DPI);
    R.stickers.set(key, await stickerLayer(opts.pack, W, H, cellRects(layout, DPI), footerTop(layout, DPI), DPI, opts.seed));
  }
  return R.stickers.get(key);
}

// (Re)builds the strip from the developed shots. Only shots not developed yet are processed here.
async function developStrip(animate) {
  const token = ++R.token;
  await fontsReady();
  const rects = cellRects(R.layout, DPI);
  const devs = [];
  for (let k = 0; k < R.photos.length; k++) {
    const cached = R.photos[k].dev?.[opts.film];
    devs.push(cached || developOne(R.photos[k], k, R.layout, opts.film));
    if (!cached) { await wait(0); if (token !== R.token) return; } // let frames through between photos
  }
  const stickers = await stickersFor(R.layout);
  if (token !== R.token) return;
  const strip = renderStrip({ layoutId: R.layout, frame: frameHex(), photos: devs.map((d) => d.img), captions: opts.showCaptions ? R.photos.map((p) => p.caption) : [],
    note: R.note, showDate: opts.showDate, stickers, dpi: DPI });
  // JPEG for the on-screen preview (fast to encode); the lossless PNG for download is made in the background.
  const preview = await new Promise((r) => strip.toBlob(r, 'image/jpeg', 0.92));
  if (token !== R.token) return;
  Object.assign(R, { strip, stripBlob: null, gifBlob: null, rects, faces: devs.map((d) => d.face) });
  if (R.stripUrl) URL.revokeObjectURL(R.stripUrl);
  R.stripUrl = URL.createObjectURL(preview);
  const img = $('#strip-img');
  img.src = R.stripUrl;
  await img.decode().catch(() => {});
  placeRetakeTargets();
  const res = $('#result');
  if (animate) { res.classList.remove('printing'); void res.offsetWidth; res.classList.add('printing'); }
  markVideoStale();
  idle(() => stripPng());
}

// Invisible buttons over each photo on the strip: hover / focus shows "Retake", click retakes just that one.
function placeRetakeTargets() {
  const sheet = $('#sheet');
  sheet.querySelectorAll('.cell-hit').forEach((b) => b.remove());
  const { W, H } = stripSize(R.layout, DPI);
  R.rects.forEach((r, k) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cell-hit';
    b.setAttribute('aria-label', `Retake photo ${k + 1}, ${R.beats[k].caption}`);
    Object.assign(b.style, { left: `${(r.x / W) * 100}%`, top: `${(r.y / H) * 100}%`, width: `${(r.w / W) * 100}%`, height: `${(r.h / H) * 100}%` });
    b.innerHTML = '<span>Retake</span>';
    b.addEventListener('click', () => enterBooth(k));
    sheet.append(b);
  });
}

// Lossless PNG of the current strip, made once per version of the strip.
async function stripPng() {
  const strip = R.strip;
  if (R.stripBlob && R.stripBlobFor === strip) return R.stripBlob;
  const blob = await new Promise((r) => strip.toBlob(r, 'image/png'));
  if (R.strip === strip) Object.assign(R, { stripBlob: blob, stripBlobFor: strip });
  return blob;
}

function clearVideo() {
  if (R.videoUrl) URL.revokeObjectURL(R.videoUrl);
  Object.assign(R, { videoUrl: null, videoBlob: null });
}
function markVideoStale() { if (R.videoUrl) { clearVideo(); videoStep('setup'); } }

function download(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
}
function downloadBlob(blob, name) { const u = URL.createObjectURL(blob); download(u, name); setTimeout(() => URL.revokeObjectURL(u), 4000); }

// Web Share with files (phones, Safari, Chrome on Windows/ChromeOS) opens the system sheet: TikTok, Instagram, Messages…
const CAN_SHARE_FILES = (() => { try { return !!navigator.canShare?.({ files: [new File([''], 'x.png', { type: 'image/png' })] }); } catch { return false; } })();
async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (CAN_SHARE_FILES && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text: SHARE_TEXT }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  downloadBlob(blob, name);
  toast('Saved to your downloads');
}

const fileBase = () => `hold-it-last-christmas-${R.layout}`;

// ---------- video card: options -> progress -> result. Download only exists once there is a video. ----------
function videoStep(step) {
  $('.v-setup').hidden = step !== 'setup';
  $('.v-progress').hidden = step !== 'progress';
  $('.v-done').hidden = step !== 'done';
}
function openVideo() {
  $('#studio').classList.add('video-open');
  $('#video-card').hidden = false;
  videoStep(R.videoUrl ? 'done' : 'setup');
  requestAnimationFrame(syncChips);
  $('#video-card').scrollIntoView({ block: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' });
}
function closeVideo() {
  $('#studio').classList.remove('video-open');
  $('#video-card').hidden = true;
  $('#video-out').pause?.();
}

async function makeVideo() {
  if (R.rendering || !R.strip) return;
  R.rendering = true;
  videoStep('progress');
  const bar = $('.progress i');
  bar.style.width = '0%';
  setText('.progress-label', 'filming your strip…');
  try {
    await fontsReady();
    const renderer = createRenderer({ strip: R.strip, rects: R.rects, faces: R.faces, beats: R.beats, end: R.end, surface: opts.surface, lyricStyle: opts.lyric });
    const audio = songBuffer ? await songSegment(songBuffer, song, renderer.lead, renderer.duration) : null;
    const { blob, ext } = await exportVideo(renderer, audio, (p) => { bar.style.width = `${Math.round(p * 100)}%`; setText('.progress-label', `filming your strip… ${Math.round(p * 100)}%`); });
    clearVideo();
    Object.assign(R, { videoUrl: URL.createObjectURL(blob), videoBlob: blob, videoExt: ext });
    const v = $('#video-out');
    v.src = R.videoUrl;
    videoStep('done');
    v.play().catch(() => {});
  } catch (e) {
    console.error(e);
    videoStep('setup');
    toast('Could not make the video in this browser. Try Chrome, Edge or Safari.');
  } finally {
    R.rendering = false;
  }
}

// ---------- GIF ----------
// Built once per version of the strip, then reused for download and for the QR link.
async function buildGif(onProgress = () => {}) {
  if (R.gifBlob && R.gifFor === R.strip) return R.gifBlob;
  const strip = R.strip;
  const { liveStripGif, flipbookGif } = await import('./gif.js');
  await fontsReady();
  const live = R.photos.some((p) => p.clip?.length);
  const blob = live
    ? await liveStripGif({ layoutId: R.layout, frame: frameHex(), photos: R.photos, captions: opts.showCaptions ? R.photos.map((p) => p.caption) : [], note: R.note,
      showDate: opts.showDate, stickers: await stickersFor(R.layout), film: opts.film, onProgress })
    : await flipbookGif({ photos: R.photos, captions: R.photos.map((p) => p.caption), film: opts.film, frameHex: frameHex(), ink: frameTheme(frameHex()).ink, onProgress });
  Object.assign(R, { gifBlob: blob, gifFor: strip, gifLive: live });
  return blob;
}

let gifBusy = false;
async function makeGif() {
  if (gifBusy || !R.strip) return;
  gifBusy = true;
  const btn = $('#dl-gif'), label = btn.querySelector('span');
  btn.classList.add('busy');
  try {
    const blob = await buildGif((p) => { label.textContent = `Making GIF ${Math.round(p * 100)}%`; btn.style.setProperty('--p', p); });
    shareOrDownload(blob, `${fileBase()}${R.gifLive ? '-live' : ''}.gif`);
  } catch (e) {
    console.error(e);
    toast('Could not make the GIF here');
  } finally {
    gifBusy = false;
    btn.classList.remove('busy'); btn.style.removeProperty('--p');
    label.textContent = 'Live GIF';
  }
}

// ---------- send to phone: upload on request, show a QR the phone can scan ----------
let qrKind = 'strip', qrUrl = '';
function qrView(step, status = '') {
  $('.qr-pick').hidden = step !== 'pick';
  $('.qr-result').hidden = step !== 'result';
  $('#qr-status').textContent = status;
}
function openQr() {
  const video = $('#qr-kind [data-kind=video]');
  video.disabled = !R.videoBlob;
  video.title = R.videoBlob ? '' : 'Make the video first';
  if (qrKind === 'video' && !R.videoBlob) qrKind = 'strip';
  for (const b of document.querySelectorAll('#qr-kind button')) b.setAttribute('aria-checked', b.dataset.kind === qrKind);
  qrView('pick');
  $('#qr-dialog').showModal();
}
async function makeQr() {
  const btn = $('#qr-make');
  btn.disabled = true;
  try {
    let blob;
    // a high-quality JPEG for the phone: ~2-3 MB instead of a ~16 MB lossless PNG, looks identical on a screen
    if (qrKind === 'strip') { qrView('pick', 'preparing the strip…'); blob = await new Promise((r) => R.strip.toBlob(r, 'image/jpeg', 0.93)); }
    else if (qrKind === 'gif') blob = await buildGif((p) => qrView('pick', `making the GIF… ${Math.round(p * 100)}%`));
    else blob = R.videoBlob;
    if (!blob) throw new Error('nothing to send');
    if (blob.size > 24 * 1024 * 1024) { qrView('pick', 'That file is too big to send. Download it instead.'); return; }
    qrView('pick', `uploading ${(blob.size / 1048576).toFixed(1)} MB…`);
    const res = await fetch(`${SHARE_API}/upload`, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
    if (!res.ok) throw new Error(`upload ${res.status}`);
    qrUrl = (await res.json()).url;
    const { default: qrcode } = await import('https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/+esm');
    const qr = qrcode(0, 'M');
    qr.addData(qrUrl);
    qr.make();
    $('#qr-code').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
    qrView('result');
  } catch (e) {
    console.error(e);
    qrView('pick', 'Could not upload right now. Check your connection and try again.');
  } finally {
    btn.disabled = false;
  }
}

// 9:16 still of the strip lying on the table (the video's last frame, no lyrics): ready for a story or a wallpaper.
async function storyImage() {
  if (!R.strip) return;
  await fontsReady();
  const r = createRenderer({ strip: R.strip, rects: R.rects, faces: R.faces, beats: R.beats, end: R.end, surface: opts.surface, lyricStyle: opts.lyric });
  const c = r.frame(r.duration - 0.05);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  shareOrDownload(blob, `${fileBase()}-story.png`);
}

async function printSheetDownload() {
  if (!R.strip) return;
  const blob = await new Promise((res) => printSheet(R.strip).toBlob(res, 'image/png'));
  downloadBlob(blob, `${fileBase()}-4x6-print.png`);
  toast('4×6 print saved');
}

// ---------- studio controls: tabs, swatches, sticker packs, text ----------
function buildTabs() {
  const tabs = [...document.querySelectorAll('.tabs [role=tab]')];
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
      $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
    }
    if (focus) tab.focus();
    const ink = $('.tab-ink');
    Object.assign(ink.style, { left: `${tab.offsetLeft}px`, width: `${tab.offsetWidth}px` });
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });
  buildTabs.sync = () => select(tabs.find((t) => t.getAttribute('aria-selected') === 'true'));
}

function buildSwatches() {
  const el = $('#swatches');
  el.innerHTML = Object.entries(FRAMES).map(([id, f]) => `<button type="button" role="radio" class="sw" data-id="${id}" aria-label="${f.label}" title="${f.label}" style="--c:${f.hex}"></button>`).join('')
    + `<label class="sw custom" title="Custom colour" style="--c:${opts.custom}"><input type="color" id="custom-color" value="${opts.custom}" aria-label="Custom frame colour"><span>Custom</span></label>`;
  el.addEventListener('click', (e) => { const b = e.target.closest('button.sw'); if (b) setFrame(b.dataset.id); });
  let t;
  $('#custom-color').addEventListener('input', (e) => {
    opts.custom = e.target.value; store.set('custom', opts.custom);
    el.querySelector('.custom').style.setProperty('--c', opts.custom);
    clearTimeout(t); t = setTimeout(() => setFrame('custom', true), 120);
  });
  syncSwatches();
}
function syncSwatches() {
  for (const b of document.querySelectorAll('#swatches .sw')) {
    const id = b.dataset.id ?? 'custom';
    b.classList.toggle('on', id === opts.frame);
    if (b.tagName === 'BUTTON') b.setAttribute('aria-checked', id === opts.frame);
  }
}
function setFrame(id, force) {
  if (opts.frame === id && !force) return;
  opts.frame = id; store.set('frame', id); syncSwatches();
  renderPreview();
  if ($('#result').classList.contains('active')) developStrip(false);
}

async function buildPacks() {
  const el = $('#packs');
  el.innerHTML = Object.entries(PACKS).map(([id, p]) => `<button type="button" role="radio" class="pack" data-id="${id}" aria-checked="${opts.pack === id}"><span class="art"></span><span>${p.label}</span></button>`).join('');
  el.addEventListener('click', (e) => { const b = e.target.closest('.pack'); if (b) setPack(b.dataset.id); });
  for (const b of el.querySelectorAll('.pack')) {
    if (b.dataset.id === 'none') { b.querySelector('.art').classList.add('none'); continue; }
    packPreview(b.dataset.id, 112).then((c) => b.querySelector('.art').append(c)).catch(() => {});
  }
}
function setPack(id) {
  if (opts.pack === id) return;
  opts.pack = id; store.set('pack', id);
  for (const b of document.querySelectorAll('#packs .pack')) b.setAttribute('aria-checked', b.dataset.id === id);
  $('#shuffle').hidden = id === 'none';
  renderPreview();
  if ($('#result').classList.contains('active')) developStrip(false);
}

// ---------- wiring ----------
function glitter() {
  const c = canvas(180, 180), x = c.getContext('2d');
  x.fillStyle = '#fdfaf6'; x.fillRect(0, 0, 180, 180);
  for (let i = 0; i < 1400; i++) {
    const r = 0.4 + Math.random() * 1.4;
    x.fillStyle = ['rgba(255,255,255,0.95)', 'rgba(255,205,215,0.85)', 'rgba(200,205,215,0.8)', 'rgba(255,235,200,0.9)'][i % 4];
    x.beginPath(); x.arc(Math.random() * 180, Math.random() * 180, r, 0, 6.283); x.fill();
  }
  document.documentElement.style.setProperty('--glitter', `url(${c.toDataURL()})`);
}

function exitToHome() { leaveBooth(); show(R.photos && B.retakeOne ? 'result' : 'home'); }
function manualSnap() {
  if (B.phase === 'start') beginPoses();
  else if (B.phase === 'pose' || B.phase === 'timer') startCountdown(true);
}
function toggleMenu(open) {
  const menu = $('#more-menu'), btn = $('#more-btn');
  const on = open ?? menu.hidden;
  menu.hidden = !on; btn.setAttribute('aria-expanded', on);
  if (on) menu.querySelector('button:not([hidden])')?.focus();
}

$('#start').addEventListener('click', () => enterBooth());
$('#upload').addEventListener('change', (e) => { fromUpload(e.target.files); e.target.value = ''; });
$('#exit').addEventListener('click', exitToHome);
$('#loading-back').addEventListener('click', exitToHome);
$('#snap').addEventListener('click', manualSnap);
$('#undo').addEventListener('click', undo);
$('#mute').addEventListener('click', (e) => {
  muted = !muted;
  e.currentTarget.setAttribute('aria-pressed', muted);
  if (muted) stopCue(); else if (B.active && ['pose', 'timer'].includes(B.phase)) playCue(B.cur);
});
$('#flash-btn').setAttribute('aria-pressed', !opts.flash);
$('#flash-btn').addEventListener('click', (e) => {
  opts.flash = !opts.flash; store.set('flash', opts.flash ? 'on' : 'off');
  e.currentTarget.setAttribute('aria-pressed', !opts.flash);
});
$('#flip').addEventListener('click', async () => {
  if (B.devices.length < 2) return;
  try { await startCamera(B.devices[(B.devIdx + 1) % B.devices.length].deviceId); } catch (e) { console.warn(e); }
});
$('#fullscreen').hidden = !document.fullscreenEnabled;
$('#fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else $('#booth').requestFullscreen?.().catch(() => {});
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && B.active) keepAwake(); });

$('#dl-strip').addEventListener('click', async () => { if (!R.strip) return; downloadBlob(await stripPng(), `${fileBase()}.png`); toast('Strip saved'); });
$('#dl-gif').addEventListener('click', makeGif);
// big red Download video: saves it if made, otherwise opens the video card to make it
$('#open-video').addEventListener('click', () => { if (R.videoBlob) { downloadBlob(R.videoBlob, `${fileBase()}.${R.videoExt}`); toast('Video saved'); } else openVideo(); });
$('#close-video').addEventListener('click', closeVideo);
$('#make-video').addEventListener('click', makeVideo);
$('#redo-video').addEventListener('click', () => videoStep('setup'));
$('#dl-video').addEventListener('click', () => { if (R.videoBlob) { downloadBlob(R.videoBlob, `${fileBase()}.${R.videoExt}`); toast('Video saved'); } });
$('#share-video').hidden = !CAN_SHARE_FILES;
$('#share-video').addEventListener('click', () => R.videoBlob && shareOrDownload(R.videoBlob, `${fileBase()}.${R.videoExt}`));
$('#copy-caption').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(SHARE_TEXT); toast('Caption copied'); } catch { toast(SHARE_TEXT); }
});
$('#more-btn').addEventListener('click', () => toggleMenu());
$('#more-menu').addEventListener('click', () => toggleMenu(false));
document.addEventListener('click', (e) => { if (!e.target.closest('.more-wrap')) toggleMenu(false); });
$('#send-phone').addEventListener('click', openQr);
$('#qr-kind').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || b.disabled) return; qrKind = b.dataset.kind; for (const x of document.querySelectorAll('#qr-kind button')) x.setAttribute('aria-checked', x === b); });
$('#qr-make').addEventListener('click', makeQr);
$('#qr-again').addEventListener('click', () => qrView('pick'));
$('#qr-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(qrUrl); toast('Link copied'); } catch { toast(qrUrl); } });
$('#share-strip').addEventListener('click', async () => R.strip && shareOrDownload(await stripPng(), `${fileBase()}.png`));
$('#dl-story').addEventListener('click', storyImage);
$('#dl-print').addEventListener('click', printSheetDownload);
$('#shuffle').addEventListener('click', () => { opts.seed++; renderPreview(); developStrip(false); });
$('#shuffle').hidden = opts.pack === 'none';
let noteTimer;
$('#note').addEventListener('input', (e) => {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { R.note = e.target.value; store.set('note', R.note); developStrip(false); renderPreview(); }, 350);
});
for (const [id, key] of [['#show-date', 'showDate'], ['#show-captions', 'showCaptions']]) {
  $(id).addEventListener('change', (e) => { opts[key] = e.target.checked; store.set(key, e.target.checked ? '1' : '0'); developStrip(false); renderPreview(); });
}
$('#retake').addEventListener('click', () => enterBooth());
$('#home-btn').addEventListener('click', () => { show('home'); requestAnimationFrame(syncChips); });
addEventListener('resize', () => { if (B.active) overlay.resize(); syncChips(); buildTabs.sync?.(); });
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#more-menu').hidden) { toggleMenu(false); $('#more-btn').focus(); return; }
  if (!B.active || e.repeat) return;
  if (e.code === 'Space') { e.preventDefault(); manualSnap(); }
  if (e.code === 'Backspace') { e.preventDefault(); undo(); }
  if (e.code === 'Escape' && !document.fullscreenElement) exitToHome();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

buildChips();
buildTabs();
buildSwatches();
buildPacks();
glitter();
renderPreview();
loadSong();
