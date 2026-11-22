import { POSES, evaluatePose } from './poses.js';
import { Overlay, coverMap, drawProp, ghostIcon } from './overlay.js';
import { FILMS, FILM_CSS, developPhoto, smartCrop, canvas } from './film.js';
import { LAYOUTS, THEMES, renderStrip, cellRects, cellAspect, printSheet } from './strip.js';
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
const SHARE_TEXT = 'last christmas photobooth, one pose per lyric #lastchristmas #photobooth #christmas';

// ---------- settings (remembered per browser) ----------
const store = {
  get(k, d, valid) { try { const v = localStorage.getItem(`pb.${k}`); return v && (!valid || valid[v]) ? v : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`pb.${k}`, v); } catch { /* private mode */ } },
};
const GROUPS = { film: FILMS, theme: THEMES, lyric: LYRIC_STYLES, surface: SURFACES, layout: LAYOUTS };
const opts = {
  layout: store.get('layout', '2x3', LAYOUTS), film: store.get('film', 'bw', FILMS), theme: store.get('theme', 'merry', THEMES),
  lyric: store.get('lyric', 'serif', LYRIC_STYLES), surface: store.get('surface', 'wood', SURFACES),
  flash: store.get('flash', 'on') === 'on',
};

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
}
function setOpt(g, v) {
  if (opts[g] === v) return;
  opts[g] = v; store.set(g, v); syncChips();
  if (['layout', 'film', 'theme'].includes(g)) renderPreview();
  if (['film', 'theme'].includes(g) && $('#result').classList.contains('active')) developStrip(false);
  if (['lyric', 'surface'].includes(g)) markVideoStale();
}

function show(id) {
  const swap = () => { for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === id); window.scrollTo(0, 0); };
  // native cross-document-free transition between screens; plain swap when unsupported or reduced motion
  if (document.startViewTransition && !REDUCED) document.startViewTransition(swap); else swap();
}
function setText(sel, text) { const el = $(sel); if (el.textContent !== text) el.textContent = text; }

const fontsReady = () => Promise.all(['40px "Pinyon Script"', '20px "Homemade Apple"', '12px "Courier Prime"', '600 20px "Bodoni Moda"',
  '40px "Libre Caslon Text"', '700 40px "TikTok Sans"'].map((f) => document.fonts.load(f))).catch(() => {});

// ---------- home preview ----------
const PREVIEW_TONES = { bw: ['#9a9692', '#4a4846'], sepia: ['#8a6c50', '#4a3626'], color: ['#b9a596', '#6b5a52'], golden: ['#c4a47c', '#6e5238'], cool: ['#a7b0b7', '#535e68'] };
async function renderPreview() {
  await fontsReady();
  const L = LAYOUTS[opts.layout];
  const rects = cellRects(opts.layout, 150);
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
  const strip = renderStrip({ layoutId: opts.layout, themeId: opts.theme, photos, captions: beats.map((b) => b.caption), note: store.get('note', ''), dpi: 150 });
  $('#preview').src = strip.toDataURL('image/jpeg', 0.9);
}

// ---------- audio ----------
let actx = null, songBuffer = null, songEl = null, muted = false;
const audioCtx = () => (actx ??= new AudioContext());

async function loadSong() {
  try {
    const r = await fetch(song.src);
    if (!r.ok) throw new Error(r.status);
    songBuffer = await audioCtx().decodeAudioData(await r.arrayBuffer());
    songEl = new Audio(song.src);
    songEl.volume = 0.35;
    // loop the verse section quietly while shooting
    const a = Math.max(0, song.segment.start - 4), b = song.segment.start + song.end + 1;
    songEl.addEventListener('timeupdate', () => { if (songEl.currentTime > b || songEl.currentTime < a - 1) songEl.currentTime = a; });
  } catch {
    songBuffer = null;
  }
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
  memory: {}, frame: null, hold: null, lost: null, cdStart: 0, cdShown: 0, manual: false, poseStart: 0,
  stream: null, mirrored: true, devices: [], devIdx: 0, wake: null, dark: false, lightAt: 0,
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

async function startCamera(deviceId) {
  B.stream?.getTracks().forEach((t) => t.stop());
  const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  B.stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: 'user', ...size }, audio: false });
  video.srcObject = B.stream;
  await video.play();
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
    memory: {}, phase: 'loading', hold: null, lost: null, active: true });
  show('booth');
  buildTray();
  video.style.filter = FILM_CSS[opts.film];
  $('#loading').classList.remove('hide');
  setText('#loading p', 'warming up the booth…');
  setText('#instruction', ''); setText('#meta', ''); setText('#hint', '');
  $('#undo').hidden = true;
  overlay.resize();

  try {
    await startCamera();
  } catch (e) {
    setText('#loading p', 'The booth needs your camera. Allow camera access, then try again.');
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
  if (songEl && !muted) { songEl.currentTime = Math.max(0, song.segment.start - 4); songEl.play().catch(() => {}); }
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
  songEl?.pause();
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

function loop() {
  if (!B.active) return;
  requestAnimationFrame(loop);
  const now = performance.now();
  const t = now / 1000;
  // show() swaps screens inside a view transition, so the booth may still have been hidden (0×0) when entered
  if (!overlay.c.width && overlay.c.clientWidth) overlay.resize();
  if (!overlay.c.width) return;
  if (vision && video.readyState >= 2) B.frame = vision.detect(video, B.mirrored);
  checkLight(now);
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
    setText('#hint', ok ? 'hold it…' : stuck ? 'having trouble? press space to snap' : darkHint || (result?.hint ?? ''));
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
  B.phase = 'pose'; B.hold = null; B.poseStart = performance.now();
  setPoseUI();
}

function startCountdown(manual) {
  B.phase = 'countdown'; B.cdStart = performance.now(); B.manual = manual; B.lost = null; B.cdShown = 0;
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
  if (B.phase !== 'pose' || !B.history.length) return;
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
  const k = B.cur;
  const beat = B.beats[k];
  const flash = $('#flash');
  // screen flash: light the face with a white screen for a moment before the frame is grabbed, like a selfie flash
  if (opts.flash) { flash.classList.remove('go'); flash.classList.add('fill'); await wait(170); }

  const vw = video.videoWidth, vh = video.videoHeight;
  const raw = canvas(vw, vh);
  const ctx = raw.getContext('2d');
  if (B.mirrored) { ctx.translate(vw, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, vw, vh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const F = B.frame?.face || B.memory.face;
  const prop = POSES[beat.pose].prop;
  if (prop && F) drawProp(ctx, prop, F, { S: vh, ox: 0, oy: 0 }, performance.now() / 1000);

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
  B.photos[k] = { raw, face, focus, caption: beat.caption, thumb: url };

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
  B.cur = B.queue.shift();
  beginPoses();
}

// ---------- result ----------
const R = { photos: null, beats: null, end: 0, layout: '2x3', strip: null, stripBlob: null, rects: null, faces: null, stripUrl: null,
  videoUrl: null, videoBlob: null, videoExt: 'mp4', rendering: false, token: 0, dev: null, note: store.get('note', '') };

async function finish() {
  leaveBooth();
  Object.assign(R, { photos: B.photos, beats: B.beats, end: B.end, layout: B.layout, dev: null });
  show('result');
  syncChips(); // chips were hidden while the booth ran, so place their highlight now
  $('#video-box').hidden = true;
  $('#audio-note').hidden = !!songBuffer;
  $('#audio-note').textContent = songBuffer ? '' : `Add ${song.src} to put the song in the video.`;
  $('#dl-print').hidden = R.layout !== '1x4';
  $('#note').value = R.note;
  $('#retake-chips').innerHTML = R.beats.map((b, k) => `<button type="button" data-k="${k}" aria-label="Retake photo ${k + 1}, ${b.caption}">${k + 1}</button>`).join('');
  clearVideo();
  await wait(30);
  await developStrip(true);
}

// (Re)builds the strip from the raw shots. Film changes re-develop the photos; frame / note changes reuse them.
async function developStrip(animate) {
  const token = ++R.token;
  await fontsReady();
  const rects = cellRects(R.layout, DPI);
  if (!R.dev || R.dev.film !== opts.film) {
    const aspect = cellAspect(R.layout);
    const out = [];
    for (let i = 0; i < R.photos.length; i++) {
      const p = R.photos[i];
      const crop = smartCrop(p.raw.width, p.raw.height, p.focus, aspect);
      const img = developPhoto(p.raw, crop, rects[i].w, rects[i].h, opts.film, 101 + i);
      const face = p.face && { x0: (p.face.x0 - crop.x) / crop.w, x1: (p.face.x1 - crop.x) / crop.w, y0: (p.face.y0 - crop.y) / crop.h, y1: (p.face.y1 - crop.y) / crop.h };
      out.push({ img, face });
      if (!animate) await wait(0); // keep the UI responsive while restyling
      if (token !== R.token) return;
    }
    R.dev = { film: opts.film, imgs: out.map((d) => d.img), faces: out.map((d) => d.face) };
  }
  const strip = renderStrip({ layoutId: R.layout, themeId: opts.theme, photos: R.dev.imgs, captions: R.photos.map((p) => p.caption), note: R.note, dpi: DPI });
  const blob = await new Promise((r) => strip.toBlob(r, 'image/png'));
  if (token !== R.token) return;
  Object.assign(R, { strip, stripBlob: blob, rects, faces: R.dev.faces });
  if (R.stripUrl) URL.revokeObjectURL(R.stripUrl);
  R.stripUrl = URL.createObjectURL(blob);
  const img = $('#strip-img');
  img.src = R.stripUrl;
  await img.decode().catch(() => {});
  const res = $('#result');
  if (animate) { res.classList.remove('printing'); void res.offsetWidth; res.classList.add('printing'); }
  markVideoStale();
}

function clearVideo() {
  if (R.videoUrl) URL.revokeObjectURL(R.videoUrl);
  Object.assign(R, { videoUrl: null, videoBlob: null });
  $('#video-out').hidden = true;
  $('#video-actions').hidden = true;
  $('#make-video').textContent = 'Make the video';
}
function markVideoStale() { if (R.videoUrl) $('#make-video').textContent = 'Re-make the video'; }

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
}

const fileBase = () => `hold-it-last-christmas-${R.layout}`;

async function makeVideo() {
  if (R.rendering || !R.strip) return;
  R.rendering = true;
  const btn = $('#make-video');
  btn.disabled = true;
  $('#video-box').hidden = false;
  $('#video-out').hidden = true; $('#video-actions').hidden = true;
  const bar = $('.progress i');
  bar.style.width = '0%';
  setText('.progress-label', 'filming your strip…');
  try {
    await fontsReady();
    const renderer = createRenderer({ strip: R.strip, rects: R.rects, faces: R.faces, beats: R.beats, end: R.end, theme: opts.theme, surface: opts.surface, lyricStyle: opts.lyric });
    const audio = songBuffer ? await songSegment(songBuffer, song, renderer.lead, renderer.duration) : null;
    const { blob, ext } = await exportVideo(renderer, audio, (p) => { bar.style.width = `${Math.round(p * 100)}%`; });
    if (R.videoUrl) URL.revokeObjectURL(R.videoUrl);
    Object.assign(R, { videoUrl: URL.createObjectURL(blob), videoBlob: blob, videoExt: ext });
    const v = $('#video-out');
    v.src = R.videoUrl; v.hidden = false; v.play().catch(() => {});
    $('#video-actions').hidden = false;
    setText('.progress-label', `done · ${(blob.size / 1048576).toFixed(1)} MB`);
    btn.textContent = 'Re-make the video';
  } catch (e) {
    console.error(e);
    setText('.progress-label', 'Could not make the video in this browser. Try Chrome, Edge or Safari.');
  } finally {
    R.rendering = false;
    btn.disabled = false;
  }
}

// 9:16 still of the strip lying on the table (the video's last frame, no lyrics): ready for a story or a wallpaper.
async function storyImage() {
  if (!R.strip) return;
  await fontsReady();
  const r = createRenderer({ strip: R.strip, rects: R.rects, faces: R.faces, beats: R.beats, end: R.end, theme: opts.theme, surface: opts.surface, lyricStyle: opts.lyric });
  const c = r.frame(r.duration - 0.05);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  shareOrDownload(blob, `${fileBase()}-story.png`);
}

async function printSheetDownload() {
  if (!R.strip) return;
  const blob = await new Promise((res) => printSheet(R.strip).toBlob(res, 'image/png'));
  downloadBlob(blob, `${fileBase()}-4x6-print.png`);
}

// Tap a photo on the strip to retake just that one.
function stripCellAt(ev) {
  const rect = ev.currentTarget.getBoundingClientRect();
  const s = R.strip.width / rect.width;
  const x = (ev.clientX - rect.left) * s, y = (ev.clientY - rect.top) * s;
  return R.rects.findIndex((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
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
  else if (B.phase === 'pose') startCountdown(true);
}

$('#start').addEventListener('click', () => enterBooth());
$('#exit').addEventListener('click', exitToHome);
$('#loading-back').addEventListener('click', exitToHome);
$('#snap').addEventListener('click', manualSnap);
$('#undo').addEventListener('click', undo);
$('#mute').addEventListener('click', (e) => {
  muted = !muted;
  e.currentTarget.setAttribute('aria-pressed', muted);
  if (songEl) { if (muted) songEl.pause(); else if (B.active) songEl.play().catch(() => {}); }
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

$('#dl-strip').addEventListener('click', () => R.stripBlob && downloadBlob(R.stripBlob, `${fileBase()}.png`));
$('#share-strip').hidden = !CAN_SHARE_FILES;
$('#share-strip').addEventListener('click', () => R.stripBlob && shareOrDownload(R.stripBlob, `${fileBase()}.png`));
$('#make-video').addEventListener('click', makeVideo);
$('#dl-video').addEventListener('click', () => R.videoBlob && downloadBlob(R.videoBlob, `${fileBase()}.${R.videoExt}`));
$('#share-video').hidden = !CAN_SHARE_FILES;
$('#share-video').addEventListener('click', () => R.videoBlob && shareOrDownload(R.videoBlob, `${fileBase()}.${R.videoExt}`));
$('#copy-caption').addEventListener('click', async (e) => {
  try { await navigator.clipboard.writeText(SHARE_TEXT); e.currentTarget.textContent = 'Caption copied'; } catch { e.currentTarget.textContent = SHARE_TEXT; }
});
$('#dl-story').addEventListener('click', storyImage);
$('#dl-print').addEventListener('click', printSheetDownload);
$('#strip-img').addEventListener('click', (e) => { const k = R.strip ? stripCellAt(e) : -1; if (k >= 0) enterBooth(k); });
$('#retake-chips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) enterBooth(+b.dataset.k); });
let noteTimer;
$('#note').addEventListener('input', (e) => {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { R.note = e.target.value; store.set('note', R.note); developStrip(false); renderPreview(); }, 350);
});
$('#retake').addEventListener('click', () => enterBooth());
$('#home-btn').addEventListener('click', () => show('home'));
addEventListener('resize', () => { if (B.active) overlay.resize(); syncChips(); });
addEventListener('keydown', (e) => {
  if (!B.active || e.repeat) return;
  if (e.code === 'Space') { e.preventDefault(); manualSnap(); }
  if (e.code === 'Backspace') { e.preventDefault(); undo(); }
  if (e.code === 'Escape' && !document.fullscreenElement) exitToHome();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

buildChips();
glitter();
renderPreview();
loadSong();
