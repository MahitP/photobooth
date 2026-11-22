# Posebooth: design brief

Goal: make the booth feel like a real photo booth you step into, with motion that
is physical, rhythmic and earned. Keep the app lean: one dependency at most.

## 1. Name

Current: **Posebooth** (the mechanic is the pose, so the name is already right).

Candidates, strongest first:

| Name | Why it works | Risk to check |
|---|---|---|
| **Hold Still** | The whole mechanic is holding a pose and waiting for the shutter. Short, warm, says what to do. | Common phrase, so search app stores and domains. |
| **Strike** | "Strike a pose." One word, punchy, works as a logo. | Very crowded name in tech and sports. |
| **Stillbooth** | Keeps the booth, adds the stillness of the photo. | Check domains. |
| **Hold That Pose** | Friendly and playful, great for the tagline. | Long for an app icon. |
| **Posebooth** (keep) | Already in the code and the repo. Searchable, clear. | Likely taken in some stores; check. |

Recommendation: **Hold Still**, with "Posebooth" kept as the product name if the
domain and handle checks fail. I could not run live trademark or domain searches
from here, so check these before committing: App Store, Google Play, the USPTO
trademark search, a domain lookup, and the Instagram and TikTok handles.

## 2. Tagline

- Primary: **"Hold the pose. We'll take it from here."**
- Short: **"Strike it. Keep it."**
- Subtitle on the home screen: "A photobooth that shoots the moment you hold still."

## 3. Colour

Keep the current palette. It already reads as analog photo booth (velvet curtain, red,
cream paper), so changing it would lose identity. Lock it as tokens and add two modes.

| Token | Hex | Use |
|---|---|---|
| `--velvet` | `#2b070a` to `#7b1a20` | Home and result backdrop, curtain feel |
| `--red` | `#9d1c24` | Primary action, script accents, countdown shadow |
| `--red-deep` | `#6f1218` | Hover, pressed |
| `--paper` | `#f3ece1` | Print, cream surfaces, body background |
| `--ink` | `#2a2320` | Text |
| `--gold` | `#e9c27a` | "Now" marker in the tray, the ready state |
| `--flash` | `#fffaf2` | Shutter flash, never pure white |

Booth mode (camera on) is dark and cinematic. Print mode (strip, result) is cream.
Contrast: `--ink` on `--paper` is about 13:1. Check the white script on the booth
against bright camera frames, and keep the text-shadow that already exists.

## 4. Motion system

Three durations, one easing family. Use them everywhere, so the app feels like one object.

- Micro (buttons, chips, hover): 120 to 180 ms, `cubic-bezier(.2,.8,.2,1)`
- Standard (panels, tray, text): 300 to 450 ms, spring-like `cubic-bezier(.2,.9,.25,1.15)` (already in the CSS)
- Event (shutter, print eject, develop): 600 to 4800 ms, bespoke keyframes

Signature moments, in order of importance:

1. **The hold ring.** A thin SVG ring fills over the 0.35 s hold (`stroke-dashoffset`),
   so the user sees the shot coming. This is the single most useful feedback in the app.
2. **Countdown.** Each number arrives with overshoot (the existing `tick`), then a tiny
   shake on the last "1". Use a synthesized click (WebAudio, no file) on each tick.
3. **Shutter.** A 60 ms flash in `--flash`, a 30 ms scale-down of the camera frame
   (1.0 to 0.985 and back), and a mechanical click. Trigger it from the same event that
   captures the frame, so it is never out of sync.
4. **Print eject.** The print slides out of a slot at the top with a spring that
   overshoots once, then settles with a slight rotation (-3deg to -2deg). Use Motion's
   spring (`stiffness ~180, damping ~18`) so it responds to real velocity.
5. **Develop.** Keep the current idea (brightness and contrast go from washed out to
   correct) but add a warm tint that fades, and a soft blur-to-sharp over 1.2 s. It is
   the moment people screenshot, so make it the best-looking second in the app.
6. **Screen changes.** Use the native View Transitions API. The printed strip morphs
   from the booth preview into the result slot (`view-transition-name`). Fall back to
   a plain fade where it is not supported.
7. **Layout and chip selection.** A sliding indicator under the selected chip (one
   absolutely positioned element that moves) instead of recolouring each button.
8. **Lyrics.** Keep the existing fade and rise timings. Add a per-word reveal on the
   sung syllable, which fits the "sung at this moment" idea in the README.

Reduced motion: keep the same sequence, but replace movement with fades and
instant state changes, and keep the countdown and flash. The existing
`prefers-reduced-motion` block only shortens durations; it should also drop transforms.

## 5. Libraries

Recommended:

- **Motion** (motion.dev, the successor to Framer Motion for vanilla JS): springs for the eject, the ring and the tray. Small, no build step needed.
- **Native Web Animations API** (`element.animate`): use it for the flash, the shake and the tick. No library needed.
- **Native View Transitions API**: screen and strip morphs. Zero cost.

Optional, only if a feature needs it:

- **GSAP**: if you want a full timeline for the end-of-session reveal. It is free for this use now.
- **Rive** (or Lottie): an animated shutter icon or a wax-seal "ta-da" on the result screen, if you want a hand-made feel. Only add it if the designer asset exists.
- **WebGL (OGL, or a small raw shader)**: a live film grade in the booth preview, for halation and grain. Do it later, because it costs battery and the current canvas film effect may already be enough.

Avoid: a UI framework (React, Vue) or Tailwind for this app. The app is a single page
with a few screens, and the UI is mostly custom art. Plain CSS and the native APIs above are enough.

Sound: synthesize the shutter and countdown ticks with WebAudio. No audio assets, no
extra download. The song is already in `assets/songs/`.

## 6. Fonts

Keep the current pairing, which already matches the theme:

- **Pinyon Script**: display, the wordmark and countdown
- **Cormorant Garamond**: body, italic leads
- **Courier Prime**: labels and captions, the "typed on a booth card" feel
- **Homemade Apple**: handwritten captions on the print
- **Bodoni Moda**: optional, for the result title if you want more contrast

Limit to three on any single screen.

## 7. Iconography and details

- Icons: one line weight (1.6 to 1.8 px), round caps, matching the mute and exit icons.
- Corners: 6 px on tray cells and 14 px on option cards; pill buttons stay pills.
- Print detail: paper grain via the existing texture, a faint perforated edge on
  the strip, and handwritten date stamp (Homemade Apple) in one corner.
- Haptics: `navigator.vibrate(12)` on the shutter on Android. It does nothing on iOS, which is fine.

## 8. Experience flow

1. Home: velvet curtain, the strip preview tilts on hover (existing), and the chosen
   film and frame are visible before you start.
2. Booth: the camera fills the screen, a hold ring appears at the body cut-out, and
   the countdown runs over the live image.
3. Between shots: the tray shows the current cell glowing gold, with a small pulse.
4. Result: the strip develops from the slot, then the buttons appear one by one (stagger 80 ms).
5. Video: a progress bar that fills with a soft gloss, then the video fades in and loops.

## 9. Build order (smallest first)

1. Hold ring and shutter flash (highest impact, under 100 lines).
2. Countdown click and shake.
3. Print eject with a Motion spring.
4. Develop refinement and staggered result buttons.
5. View Transitions for the strip morph.
6. Sliding chip indicator and reduced-motion pass.
7. Name and tagline swap (once the checks pass).

## 10. Checks before shipping

- Test on an iPhone Safari 17+ and Chrome on Android; the camera and flash must not drop frames.
- Confirm every animation has a reduced-motion path and nothing relies on sound alone.
- Keep the total JS small; the design should add under 15 KB gzipped beyond the current app.
