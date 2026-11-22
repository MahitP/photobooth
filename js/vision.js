// MediaPipe Tasks (hands + face mesh w/ blendshapes + body). Runs in-browser on the GPU; no server, no OpenCV needed.
import { FilesetResolver, HandLandmarker, FaceLandmarker, PoseLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs';
import { handInfo, faceFromMesh, faceFromBody } from './poses.js';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm';
const MODELS = 'https://storage.googleapis.com/mediapipe-models';

export class Vision {
  async init(onStatus = () => {}) {
    onStatus('loading the pose models…');
    const files = await FilesetResolver.forVisionTasks(WASM);
    const make = async (Task, path, extra) => {
      for (const delegate of ['GPU', 'CPU']) {
        try {
          return await Task.createFromOptions(files, { baseOptions: { modelAssetPath: `${MODELS}/${path}`, delegate }, runningMode: 'VIDEO', ...extra });
        } catch (e) { if (delegate === 'CPU') throw e; }
      }
    };
    [this.hands, this.face, this.body] = await Promise.all([
      make(HandLandmarker, 'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', { numHands: 4, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5 }),
      make(FaceLandmarker, 'face_landmarker/face_landmarker/float16/1/face_landmarker.task', { numFaces: 2, outputFaceBlendshapes: true }),
      make(PoseLandmarker, 'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', { numPoses: 1 }),
    ]);
    this.frameNo = 0;
    this.lastTs = 0;
    this.bodyPts = null;
  }

  // Returns landmarks converted to mirrored aspect space (see poses.js).
  // mirrored: true for a selfie camera (preview is flipped), false for a rear camera.
  detect(video, mirrored = true) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return null;
    const aspect = vw / vh;
    const ts = Math.max(performance.now(), this.lastTs + 1); // timestamps must strictly increase
    this.lastTs = ts;
    const conv = (pts) => pts.map((p) => ({ x: (mirrored ? 1 - p.x : p.x) * aspect, y: p.y, visibility: p.visibility }));

    const h = this.hands.detectForVideo(video, ts);
    const f = this.face.detectForVideo(video, ts);
    // Body is only a fallback for the face, so every 3rd frame is plenty.
    if (this.frameNo++ % 3 === 0) {
      const b = this.body.detectForVideo(video, ts);
      this.bodyPts = b.landmarks?.[0] ? conv(b.landmarks[0]) : null;
    }

    const faces = (f.faceLandmarks ?? []).map((lm, k) => {
      const blend = {};
      for (const c of f.faceBlendshapes?.[k]?.categories ?? []) blend[c.categoryName] = c.score;
      // Mirroring swaps the person's left/right eye on screen; keep names as the user sees them.
      if (mirrored) [blend.eyeBlinkLeft, blend.eyeBlinkRight] = [blend.eyeBlinkRight, blend.eyeBlinkLeft];
      return faceFromMesh(conv(lm), blend);
    }).sort((a, b) => b.fw - a.fw); // biggest (closest) face first = primary
    const face = faces[0] || faceFromBody(this.bodyPts);

    const hands = (h.landmarks ?? []).map((lm) => handInfo(conv(lm)));
    return { aspect, face, faces, hands, body: this.bodyPts };
  }
}
