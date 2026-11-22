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

- **Pose-triggered shots:** hold the pose and a 3-2-1 countdown fires the shot. Space snaps manually, and Backspace redoes the last shot.
- **Duo mode:** up to two people (two faces, four hands). Each hand belongs to the nearest face, and either person can trigger the pose.
- **Screen flash:** the screen goes white for a moment before each shot to light your face, like a selfie flash. You can turn it off in the booth.
- **Low-light hint, plus auto-levels** on every photo, so dim rooms still print bright.
- **Films:** B&W, Sepia, Color, Golden, Cool. **Frames:** Classic, Merry, Midnight.
- **Restyle after shooting:** change the film, the frame, or the note on the strip without retaking.
- **Retake one photo:** tap it on the strip or use the number buttons. The other photos are kept.
- **Downloads:** the strip as a 600 dpi PNG (450 dpi on phones), a 9:16 story image, a 4×6 print sheet with two strips for the 1×4, and the MP4 video (about 8 Mbps).
- **Share:** opens the system share sheet with the file where the browser supports it (phones, Safari), and downloads otherwise.
- **Booth extras:** countdown ticks and a vibration on capture, the screen stays awake, full screen, a camera switch when there's more than one camera (a rear camera isn't mirrored).
- **Installable app:** a manifest and icon, plus a service worker that caches the pose models, WASM and fonts, so repeat visits load almost instantly and work offline.

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
