// /renderer/index.js
import { initHead, driveVisemesFrame } from "./threeHead.js";
import { initVision, stopVision } from "./vision.js";

console.log("[RENDERER] index.js loaded");

// mic capture state
let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let keepListening = false;
let currentlyRecording = false;

// turn-taking state
let heraSpeaking = false;
let heraCooldown = false;
let lastHeraReplyText = "";

// DOM refs (assigned on DOMContentLoaded)
let talkStateEl = null;

// wait helper
function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -------------------------------------------------
// MIC CAPTURE: record 10s burst
// -------------------------------------------------
function recordBurstOnce() {
  return new Promise(async (resolve, reject) => {
    try {
      if (!mediaStream) {
        console.log("[RENDERER] requesting getUserMedia for mic...");
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false
        });
        console.log("[RENDERER] mic stream acquired:", mediaStream);
      }

      recordedChunks = [];
      mediaRecorder = new MediaRecorder(mediaStream, {
        mimeType: "audio/webm"
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(recordedChunks, { type: "audio/webm" });
        console.log("[RENDERER] burst stop, blob size:", blob.size);
        resolve(blob);
      };

      mediaRecorder.start();
      currentlyRecording = true;
      console.log("[RENDERER] burst recording started");

      setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === "recording") {
          console.log("[RENDERER] burst stopping after 10s");
          mediaRecorder.stop();
          currentlyRecording = false;
        }
      }, 10000);
    } catch (err) {
      console.error("[RENDERER] recordBurstOnce error (mic probably blocked):", err);
      reject(err);
    }
  });
}

// convert webm/opus to WAV base64
async function convertWebmToWavBase64(webmBlob) {
  const arrayBuf = await webmBlob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuf);

  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;

  const wavBuffer = floatTo16BitWav(channelData, sampleRate);
  const wavBytes = new Uint8Array(wavBuffer);

  let bin = "";
  for (let i = 0; i < wavBytes.length; i++) {
    bin += String.fromCharCode(wavBytes[i]);
  }
  return btoa(bin);
}

function floatTo16BitWav(float32Array, sampleRate) {
  const numSamples = float32Array.length;
  const bytesPerSample = 2;
  const blockAlign = 1 * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, 1, true);  // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // 16-bit
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, s, true);
    offset += 2;
  }

  return buffer;
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// -------------------------------------------------
// TALK STATE PILL
// -------------------------------------------------
function setTalkState(mode, label) {
  if (!talkStateEl) return;
  talkStateEl.classList.remove("idle", "listening", "speaking");
  talkStateEl.classList.add(mode);
  talkStateEl.textContent = label;
}

// -------------------------------------------------
// MIC LISTEN LOOP
// -------------------------------------------------
async function micListeningLoop() {
  console.log("[RENDERER] micListeningLoop start");

  while (keepListening) {
    if (currentlyRecording) {
      await waitMs(200);
      continue;
    }

    // record 10 seconds
    let blob;
    try {
      blob = await recordBurstOnce();
    } catch (err) {
      console.error("[RENDERER] micListeningLoop record error:", err);
      break;
    }

    if (!keepListening) break;

    // turn into wav b64
    let wavBase64;
    try {
      wavBase64 = await convertWebmToWavBase64(blob);
      console.log("[RENDERER] wav base64 length:", wavBase64.length);
    } catch (err) {
      console.error("[RENDERER] micListeningLoop convert error:", err);
      continue;
    }

    // don't send while she's talking or in cooldown
    if (heraSpeaking || heraCooldown) {
      console.log("[RENDERER] skipping chunk (speaking/cooldown)");
      await waitMs(150);
      continue;
    }

    // show listening pill
    setTalkState("listening", "listening…");

    // send audio chunk up to main
    if (window.heraAPI && wavBase64) {
      console.log("[RENDERER] sending audio chunk to main");
      try {
        await window.heraAPI.sendAudioChunk(wavBase64);
      } catch (err) {
        console.error("[RENDERER] sendAudioChunk error:", err);
      }
    } else {
      console.warn("[RENDERER] heraAPI missing OR no wavBase64");
    }

    await waitMs(200);
  }

  console.log("[RENDERER] micListeningLoop stop");

  if (heraSpeaking) {
    setTalkState("speaking", "HERA speaking…");
  } else if (heraCooldown) {
    setTalkState("speaking", "…");
  } else {
    setTalkState("idle", "idle");
  }
}

// animate lips after the fact if we had no audio timing
function fallbackLipAnimation(headController, visemes) {
  const start = performance.now();
  function stepFallback() {
    const now = performance.now();
    const elapsedSec = (now - start) / 1000;
    if (headController) {
      driveVisemesFrame(headController, visemes, elapsedSec);
    }
    if (elapsedSec < 1.5) {
      requestAnimationFrame(stepFallback);
    } else if (headController) {
      driveVisemesFrame(headController, [], 999);
    }
  }
  stepFallback();
}

// -------------------------------------------------
// BOOTSTRAP RENDERER
// -------------------------------------------------
window.addEventListener("DOMContentLoaded", async () => {
  console.log("[RENDERER] DOMContentLoaded");

  const ledMic = document.getElementById("ledMic");
  const ledCam = document.getElementById("ledCam");
  const presenceLabel = document.getElementById("presenceLabel");
  const moodLabel = document.getElementById("moodLabel");
  const chatText = document.getElementById("chatText");
  const sayBtn = document.getElementById("sayBtn");
  const micToggle = document.getElementById("micToggle");
  const camToggle = document.getElementById("camToggle");
  const camPreview = document.getElementById("camPreview");
  const stageCanvas = document.getElementById("stage");
  talkStateEl = document.getElementById("talkStateIndicator");

  setTalkState("idle", "idle");

  // local UI state
  let micActive = false;
  let camActive = false;
  let headController = null;

  // init 3D head
  try {
    headController = await initHead({
      canvas: stageCanvas
    });
  } catch (err) {
    console.error("[RENDERER] initHead error:", err);
  }

  // preload bridge present?
  if (!window.heraAPI) {
    console.error("[RENDERER] window.heraAPI missing (preload didn't load)");
  } else {
    console.log("[RENDERER] window.heraAPI available");

    // world state updates from main (mood/presence/mic/cam LEDs)
    window.heraAPI.onWorldStateUpdate((st) => {
      console.log("[RENDERER] worldStateUpdate", st);

      ledMic.classList.toggle("on", st.micActive);
      ledMic.classList.toggle("mic", st.micActive);

      ledCam.classList.toggle("on", st.camActive);
      ledCam.classList.toggle("cam", st.camActive);

      presenceLabel.textContent = `User: ${st.userPresent ? "Present" : "Away"}`;
      moodLabel.textContent = `Mood: ${st.userEmotion}`;
    });

    // AI reply from main
    window.heraAPI.onAssistantSpeech(async (data) => {
      console.log("=======================================");
      console.log("[RENDERER] assistantSpeech event fired. Payload:", data);

      if (!data) {
        console.warn("[RENDERER] assistantSpeech with no data");
        return;
      }

      console.log("[RENDERER] HERA should say:", data.text);

      heraSpeaking = true;
      heraCooldown = false;
      lastHeraReplyText = data.text || "";

      setTalkState("speaking", "HERA speaking…");

      let usedSpeechSynthesis = false;

      // Browser TTS path
      if (window.speechSynthesis && data.text) {
        usedSpeechSynthesis = true;

        console.log("[RENDERER] using browser speechSynthesis");

        const utter = new SpeechSynthesisUtterance(data.text);
        utter.rate = 1.0;
        utter.pitch = 1.0;
        utter.volume = 1.0;

        let speaking = true;

        utter.onstart = () => {
          console.log("[RENDERER] utter.onstart fired");
          const start = performance.now();
          function animateWhileTalking() {
            if (!speaking) return;
            const now = performance.now();
            const elapsedSec = (now - start) / 1000;
            if (headController) {
              driveVisemesFrame(headController, data.visemes || [], elapsedSec);
            }
            requestAnimationFrame(animateWhileTalking);
          }
          animateWhileTalking();
        };

        utter.onend = () => {
          console.log("[RENDERER] utter.onend fired");
          speaking = false;

          if (headController) {
            driveVisemesFrame(headController, [], 999);
          }

          heraSpeaking = false;
          heraCooldown = true;
          setTalkState("speaking", "…");

          setTimeout(() => {
            heraCooldown = false;
            if (micActive && keepListening) {
              setTalkState("listening", "listening…");
            } else {
              setTalkState("idle", "idle");
            }
          }, 1200);
        };

        speechSynthesis.speak(utter);
      } else {
        console.warn("[RENDERER] NOT using speechSynthesis (missing or no text)");
      }

      // External audio file path (future TTS)
      if (data.audioPath) {
        console.log("[RENDERER] external audioPath found:", data.audioPath);
        try {
          const audio = new Audio(`file://${data.audioPath}`);
          audio.play();

          const start = performance.now();
          function driveFromAudio() {
            const now = performance.now();
            const elapsedSec = (now - start) / 1000;
            if (headController) {
              driveVisemesFrame(headController, data.visemes || [], elapsedSec);
            }
            if (!audio.paused && !audio.ended) {
              requestAnimationFrame(driveFromAudio);
            } else if (headController) {
              driveVisemesFrame(headController, [], 999);
            }
          }
          driveFromAudio();

          audio.addEventListener("ended", () => {
            console.log("[RENDERER] audio ended");
            heraSpeaking = false;
            heraCooldown = true;
            setTalkState("speaking", "…");

            setTimeout(() => {
              heraCooldown = false;
              if (micActive && keepListening) {
                setTalkState("listening", "listening…");
              } else {
                setTalkState("idle", "idle");
              }
            }, 1200);
          });
        } catch (err) {
          console.error("[RENDERER] failed playing audioPath:", err);
        }
      }

      // If neither speechSynthesis nor audioPath fired, animate something anyway
      if (!usedSpeechSynthesis && !data.audioPath) {
        console.warn("[RENDERER] fallbackLipAnimation()");
        fallbackLipAnimation(headController, data.visemes || []);
        heraSpeaking = false;
        heraCooldown = true;
        setTalkState("speaking", "…");
        setTimeout(() => {
          heraCooldown = false;
          if (micActive && keepListening) {
            setTalkState("listening", "listening…");
          } else {
            setTalkState("idle", "idle");
          }
        }, 1200);
      }
    });
  }

  // send typed text manually
  sayBtn.addEventListener("click", async () => {
    const txt = chatText.value.trim();
    if (!txt) return;
    chatText.value = "";
    console.log("[RENDERER] sayBtn click:", txt);

    if (window.heraAPI) {
      await window.heraAPI.sayText(txt);
    } else {
      console.warn("[RENDERER] heraAPI.sayText not available");
    }
  });

  chatText.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sayBtn.click();
    }
  });

  // toggle mic on/off -> loop
  micToggle.addEventListener("click", async () => {
    micActive = !micActive;
    micToggle.textContent = micActive ? "Mic ON" : "Mic OFF";
    console.log("[RENDERER] micToggle ->", micActive);

    if (window.heraAPI) {
      await window.heraAPI.setMicActive(micActive);
    }

    if (micActive) {
      keepListening = true;

      if (heraSpeaking) {
        setTalkState("speaking", "HERA speaking…");
      } else if (heraCooldown) {
        setTalkState("speaking", "…");
      } else {
        setTalkState("listening", "listening…");
      }

      micListeningLoop();
    } else {
      keepListening = false;

      if (heraSpeaking) {
        setTalkState("speaking", "HERA speaking…");
      } else if (heraCooldown) {
        setTalkState("speaking", "…");
      } else {
        setTalkState("idle", "idle");
      }
    }
  });

  // toggle camera / vision
  camToggle.addEventListener("click", async () => {
    camActive = !camActive;
    camToggle.textContent = camActive ? "Cam ON" : "Cam OFF";
    console.log("[RENDERER] camToggle ->", camActive);

    if (camActive) {
      await initVision(camPreview, (visionSummary) => {
        console.log("[RENDERER] visionSummary ->", visionSummary);

        if (window.heraAPI) {
          window.heraAPI.sendVisionUpdate(visionSummary);
        }
      });

      camPreview.style.display = "block";
    } else {
      stopVision();
      camPreview.srcObject = null;
      camPreview.style.display = "none";

      if (window.heraAPI) {
        window.heraAPI.sendVisionUpdate({ userPresent: false });
      }
    }

    if (window.heraAPI) {
      await window.heraAPI.setCamActive(camActive);
    }
  });

  console.log("[RENDERER] setup complete");
});
