// /renderer/vision.js

// We'll keep a ref to the video element and an interval
let visionInterval = null;
let visionVideoEl = null;

// crude last-sent values so we don't spam main on every frame if unchanged
let lastPresence = null;
let lastEmotion = null;

// start camera, run periodic mood check
export async function initVision(videoEl, onTick) {
  visionVideoEl = videoEl;

  // request webcam (video only)
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 320, height: 240 },
    audio: false
  });

  visionVideoEl.srcObject = stream;
  visionVideoEl.play();

  // run every ~1s
  visionInterval = setInterval(async () => {
    const frame = await grabFrame(visionVideoEl);
    const analysis = await analyzeFrameForMood(frame);

    // analysis like: { userPresent: true, emotion: "tired" }
    if (onTick) {
      onTick(analysis);
    }

    // only send to main if changed
    if (window.heraAPI) {
      if (
        analysis.userPresent !== lastPresence ||
        analysis.emotion !== lastEmotion
      ) {
        lastPresence = analysis.userPresent;
        lastEmotion = analysis.emotion;

        window.heraAPI.sendVisionUpdate({
          userPresent: analysis.userPresent,
          emotion: analysis.emotion
        });
      }
    }
  }, 1000);
}

// stop camera / loop
export function stopVision() {
  if (visionInterval) {
    clearInterval(visionInterval);
    visionInterval = null;
  }
  if (visionVideoEl && visionVideoEl.srcObject) {
    const tracks = visionVideoEl.srcObject.getTracks();
    tracks.forEach(t => t.stop());
  }
}

// Draw current frame to canvas and read pixels
async function grabFrame(videoEl) {
  if (!videoEl || videoEl.readyState < 2) return null;
  const w = videoEl.videoWidth || 320;
  const h = videoEl.videoHeight || 240;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  return {
    data: imageData.data,
    width: w,
    height: h
  };
}

// This is a placeholder emotion estimator.
// Replace this with a real model (like face-api or mediapipe facial landmarks).
async function analyzeFrameForMood(frame) {
  if (!frame) {
    return {
      userPresent: false,
      emotion: "neutral"
    };
  }

  // crude presence check: average brightness in the center region
  const centerBox = sampleCenterBrightness(frame);
  const present = centerBox.avgBrightness > 20; // arbitrary threshold

  // dumb "mood" guess:
  // brighter = "happy", darker = "tired"
  // you will replace with a facial-expression classifier
  let emotion = "neutral";
  if (centerBox.avgBrightness > 130) emotion = "happy";
  else if (centerBox.avgBrightness < 40) emotion = "tired";

  return {
    userPresent: present,
    emotion
  };
}

// sample pixels in a small square in the middle of the frame
function sampleCenterBrightness(frame) {
  const { data, width, height } = frame;
  const boxW = Math.floor(width * 0.2);
  const boxH = Math.floor(height * 0.2);
  const startX = Math.floor(width * 0.4);
  const startY = Math.floor(height * 0.4);

  let total = 0;
  let count = 0;

  for (let y = startY; y < startY + boxH; y++) {
    for (let x = startX; x < startX + boxW; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx + 0];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const brightness = 0.299*r + 0.587*g + 0.114*b;
      total += brightness;
      count++;
    }
  }

  return {
    avgBrightness: count > 0 ? total / count : 0
  };
}
