# Hold it. (Last Christmas photobooth)

A photobooth website that takes the photo when you hit the pose. It produces a print-accurate strip (PNG) and a
"filmed strip" video set to the song, with lyrics. Everything runs in the browser and nothing is uploaded.

## Run it

```bash
python3 -m http.server 5173
```

Open http://localhost:5173. The camera only works on `localhost` or HTTPS. Use Chrome, Edge or Safari 17+.

Tests: `node --test tests/poses.test.mjs`
Render harness (dev): put any six photos in `tests/fixtures/p0.jpg … p5.jpg`, then open `/tests/harness.html`.

## Features

**Shooting**
- **Two ways to shoot:** *Pose* (hands-free: hold the pose and a 3-2-1 countdown fires) or *Timer* (3, 5 or 10 s per photo, the pose guide still shows what to do). Space snaps manually, Backspace redoes the last shot.
- **Song cues:** each pose plays just its own lyric, then waits while you pose.
- **Camera roll:** skip the camera and build the strip from your own photos.
- **Duo mode:** up to two people. Each hand belongs to the nearest face, and either person can trigger the pose.
- **Screen flash, low-light hint, auto-levels:** dim rooms still print bright.
- **Booth extras:** countdown ticks, vibration on capture, screen stays awake, full screen, camera switch (rear cameras aren't mirrored).

**The studio (after shooting)**
- **Frame:** White, Black, Pink, Green, Blue, Yellow, Purple, Maroon, Burgundy, or any custom colour. Text colour follows the paper.
- **Stickers:** None, Christmas, Girlypop, Cute, Winter (original art, die-cut look), with Shuffle.
- **Film:** B&W, Noir, Sepia, Color, Vivid, Golden, Cool, Soft.
- **Text:** a note in the footer, and switches for the date and the lyric captions.
- **Retake one photo:** hover or tap it on the strip. The other photos are kept.

**Keeping it**
- **Download strip:** 600 dpi PNG (450 dpi on phones).
- **Live GIF:** every photo plays the second before the shutter, inside the real strip. Uploaded photos get a flipbook GIF.
- **Video:** the filmed-strip MP4 with the song and lyrics. The download button appears once the video is made.
- **Send to phone (QR):** uploads a private copy of the strip, GIF or video and shows a QR code; the phone gets a page with a Save button. Links delete themselves after 24 hours. This is the only thing that ever leaves the device, and only when you tap it.
- **More:** share sheet (phones, Safari), a 9:16 story image, a 4×6 print sheet with two strips (1×4 layout).
- **Installable app:** manifest, icon and a service worker that caches the models and fonts for fast repeat visits.

## Share links (Cloudflare)

`share-worker/` is a Cloudflare Worker at `https://holdit-share.mahitp-16.workers.dev`, storing files in Workers KV
(`holdit-share-files`) with a 24-hour expiry.

- `POST /upload`: accepts PNG, JPEG, GIF, MP4 or WebM up to 24 MB, only from photobooth.mahit.dev and localhost.
- `GET /f/<id>.<ext>`: the phone page (preview + Save). `GET /raw/<id>`: the file itself.
- Free-plan limits: 1,000 uploads a day, 1 GB stored (files expire daily, so storage stays small).

Redeploy after changing it:

```bash
cd share-worker && npm install && npx cf deploy
```

## How it works

| File | Job |
|---|---|
| `js/vision.js` | MediaPipe Tasks (hands, face mesh with blendshapes, body) on the GPU, converted to mirrored "aspect space" |
| `js/poses.js` | Pure pose detectors plus the cut-out guide shapes. Thresholds are measured in face widths, so they work at any distance |
| `js/overlay.js` | Live hand skeleton, body cut-out, target rings, sparkles, the mistletoe prop |
| `js/film.js` | Smart crop around face and hands, booth film look (tone curve, flash falloff, halation, grain, paper texture) |
| `js/strip.js` | Real print sizes: 1×4 = 2×6 in, 2×2 and 2×3 = 4×6 in, rendered at 600 dpi |
| `js/video.js` | Virtual phone camera over the printed strip, then an MP4 via WebCodecs (falls back to MediaRecorder) |
| `js/songs.js` | Song packs: audio segment, lyric lines with timings, and the pose for each line |

**No OpenCV.** MediaPipe already gives 21 hand points, a 478-point face mesh, wink and brow blendshapes, and 33 body
points at about 30 fps in the browser. OpenCV.js would add 8 MB and nothing these poses need.

**Pose → photo:** hold the pose for 0.35 s, then a 3-2-1 countdown, then the shot. Breaking the pose for more than
0.9 s cancels the countdown. Space (or "Snap now") fires manually. "Hide your face" still works once your hands cover
your face, because the last known face position is remembered for 2.5 s.

## Song timing (Last Christmas)

"Once" is sung at **70.90 s** in `assets/songs/last-christmas.mp3`. This was measured with whisper.cpp word timestamps
plus a centre-channel vocal-onset scan. Line offsets: 0, 2.25, 4.82, 7.15, 10.08 / 11.63, 14.00 / 16.35, end 18.3.
I checked the exported video by transcribing its audio again: every line lands inside the frame for its photo.

To add a song: drop the mp3 in `assets/songs/`, copy the object in `js/songs.js`, set `segment.start` and the line times,
and point each beat at a pose id.

## Lyric placement: analysis and decision

What the 8 reference videos do:
- Text sits in the upper third (16–33 % from the top), centred, white, as one short line per lyric.
- It cuts exactly when the line is sung, and usually when the camera moves to the next photo.
- The serif style (TikTok "Classic serif") uses a soft drop shadow. The bold sans uses a dark outline.
- Recurring flaws: captions cross faces (5b71 "do you recognise me" sits on foreheads). White on cream paper
  disappears (d640, f555). Long lines wrap with an orphan word.

What the app does (`placeLyrics` in `js/video.js`):
1. **Safe zone first.** Text never goes in the top 12 % (status bar, For You tabs) or the bottom 26 % (caption and
   sound bar). It stays within 80 % of the width, which keeps it clear of the right-hand like/comment rail.
2. **Face-aware.** Each photo's face box (from the face mesh at capture time, padded for hair) is projected through
   the camera transform for that shot. The caption goes in the **headroom just above the head**. If there's no room,
   it goes **over the hair** (at most the top 30 % of the face box). Only after that does it go **under the chin**,
   because the posing hands are usually there.
3. **One position per photo.** Both lines of a two-line beat share the same y, so text doesn't jump while the camera
   holds still.
4. **Readable on any paper.** A double soft shadow for serif and script, a 14 % outline for bold. Lines wrap into two
   balanced lines, never with an orphan.
5. **Timing.** Fade and rise in over 160 ms on the sung syllable, out over 80 ms. The camera starts moving 170 ms
   before the line, so the new photo arrives with the word.
