// main.js (ESM)

import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { generateAIReply } from "./core/aiBrain.js";

// Recreate __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths for Whisper
const WHISPER_BIN = path.join(__dirname, "whisper-bin", "whisper-cli.exe"); // or main.exe
const WHISPER_MODEL = path.join(__dirname, "models", "ggml-base.en.bin");

// Shared world state that renderer displays
let worldState = {
  micActive: false,
  camActive: false,
  userPresent: false,
  userEmotion: "neutral"
};

let convoBuffer = "";

let mainWindow;

// ----------------------------------------
// Utility: push current worldState to renderer
// ----------------------------------------
function pushWorldState() {
  if (!mainWindow) return;
  console.log("[MAIN] pushWorldState ->", worldState);
  mainWindow.webContents.send("worldStateUpdate", worldState);
}

// ----------------------------------------
// Whisper runner (tries 2 CLI arg styles)
// ----------------------------------------
function transcribeWithWhisper(wavPath) {
  return new Promise((resolve) => {
    const trySets = [
      {
        desc: "main.exe-style args",
        args: [
          "-m", WHISPER_MODEL,
          "-f", wavPath,
          "--language", "en",
          "--no-timestamps"
        ]
      },
      {
        desc: "whisper-cli-style args",
        args: [
          "--model", WHISPER_MODEL,
          "--file", wavPath,
          "--language", "en",
          "--no-timestamps"
        ]
      }
    ];

    let attemptIndex = 0;
    let finalTranscript = "";

    const runAttempt = () => {
      if (attemptIndex >= trySets.length) {
        console.log("[MAIN] whisper attempts done. transcript:", finalTranscript);
        resolve(finalTranscript.trim());
        return;
      }

      const attempt = trySets[attemptIndex];
      console.log("[MAIN] spawning whisper using:", attempt.desc);

      const child = spawn(WHISPER_BIN, attempt.args);

      let stdoutData = "";
      let stderrData = "";

      child.stdout.on("data", (chunk) => {
        const str = chunk.toString();
        stdoutData += str;
        console.log("[WHISPER stdout]", str);
      });

      child.stderr.on("data", (chunk) => {
        const str = chunk.toString();
        stderrData += str;
        console.warn("[WHISPER stderr]", str);
      });

      child.on("close", (code) => {
        console.log("[MAIN] whisper exited code", code);

        const lines = stdoutData
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(l => l.length > 0);

        if (lines.length > 0) {
          finalTranscript = lines[lines.length - 1];
        }

        if (finalTranscript) {
          resolve(finalTranscript.trim());
        } else {
          attemptIndex += 1;
          runAttempt();
        }
      });
    };

    runAttempt();
  });
}

// ----------------------------------------
// Save base64 WAV temp file for Whisper
// ----------------------------------------
function saveTempWav(base64Data) {
  const wavBuffer = Buffer.from(base64Data, "base64");
  const tmpPath = path.join(app.getPath("temp"), `hera_${Date.now()}.wav`);
  fs.writeFileSync(tmpPath, wavBuffer);
  console.log("[MAIN] wrote temp wav:", tmpPath);
  return tmpPath;
}

// ----------------------------------------
// Create browser window
// ----------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 425.6,
    height: 567.2,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    webPreferences: {
      // IMPORTANT: preload is CommonJS now
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true
    }
  });

  console.log("[MAIN] preload path:", path.join(__dirname, "preload.cjs"));

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Open DevTools in a separate window
  mainWindow.webContents.openDevTools({ mode: "detach" });

  // Log failures / lifecycle
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[MAIN] render-process-gone:", details);
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDesc, validatedURL) => {
    console.error("[MAIN] did-fail-load:", { errorCode, errorDesc, validatedURL });
  });

  mainWindow.webContents.on("did-finish-load", () => {
    console.log("[MAIN] renderer finished load");
    // Send initial world state so LEDs/presence/mood initialize
    pushWorldState();
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ----------------------------------------
// IPC HANDLERS
// ----------------------------------------

// Mic audio burst from renderer
ipcMain.handle("sendAudioChunk", async (_event, base64Wav) => {
  console.log("--------------------------------------------------");
  console.log("[MAIN] sendAudioChunk received, len:", base64Wav?.length);

  if (!worldState.micActive) {
    console.log("[MAIN] mic not active, ignoring chunk");
    return true;
  }

  const tmpPath = saveTempWav(base64Wav);

  const transcript = await transcribeWithWhisper(tmpPath);
  console.log("[MAIN] transcript from whisper:", transcript);

  // 1. if Whisper gave us nothing, bail quietly
  if (!transcript || !transcript.trim()) {
    console.log("[MAIN] empty transcript, skipping");
    return true;
  }

  // 2. append to running buffer
  convoBuffer += (convoBuffer ? " " : "") + transcript.trim();
  console.log("[MAIN] convoBuffer now:", convoBuffer);

  // 3. decide if it's "enough" to answer
  //    rule: at least 3 words OR ends with question mark OR ends with period
  const wordCount = convoBuffer.trim().split(/\s+/).length;
  const endsClean = /[.?!]$/.test(convoBuffer.trim());

  if (wordCount < 3 && !endsClean) {
    console.log("[MAIN] holding buffer, not responding yet");
    return true;
  }

  // 4. now we consider convoBuffer the full user utterance
  const finalUserUtterance = convoBuffer.trim();
  convoBuffer = ""; // reset buffer so we start fresh for next thought
  console.log("[MAIN] finalUserUtterance:", finalUserUtterance);

  // 5. generate HERA reply
  let reply;
  try {
    reply = await generateAIReply({
      userText: finalUserUtterance,
      emotion: worldState.userEmotion,
      userPresent: worldState.userPresent
    });
    console.log("[MAIN] generateAIReply() resolved:", reply);
  } catch (err) {
    console.error("[MAIN] ERROR in generateAIReply:", err);
    reply = {
      text: "I heard you. I'm having trouble forming a response right now, but I'm here.",
      visemes: [],
      audioPath: null
    };
  }

  if (!reply || !reply.text) {
    console.error("[MAIN] reply invalid:", reply);
    return true;
  }

  console.log("[MAIN] sending assistantSpeech to renderer");
  if (mainWindow) {
    mainWindow.webContents.send("assistantSpeech", reply);
  } else {
    console.error("[MAIN] mainWindow missing; cannot send assistantSpeech");
  }

  return true;
});


// User typed text and hit "Say"
ipcMain.handle("sayText", async (_event, text) => {
  console.log("--------------------------------------------------");
  console.log("[MAIN] sayText:", text);

  let reply;
  try {
    reply = await generateAIReply({
      userText: text,
      emotion: worldState.userEmotion,
      userPresent: worldState.userPresent
    });
    console.log("[MAIN] generateAIReply() resolved:", reply);
  } catch (err) {
    console.error("[MAIN] ERROR in generateAIReply (typed):", err);
    reply = {
      text: "I'm here with you. Something glitched in my brain, but I'm still listening.",
      visemes: [],
      audioPath: null
    };
  }

  if (mainWindow && reply) {
    console.log("[MAIN] sending assistantSpeech (typed) to renderer");
    mainWindow.webContents.send("assistantSpeech", reply);
  }

  return true;
});

// Mic toggle from renderer
ipcMain.handle("setMicActive", async (_event, active) => {
  worldState.micActive = !!active;
  console.log("[MAIN] micActive ->", worldState.micActive);
  pushWorldState();
  return true;
});

// Cam toggle from renderer
ipcMain.handle("setCamActive", async (_event, active) => {
  worldState.camActive = !!active;
  console.log("[MAIN] camActive ->", worldState.camActive);
  pushWorldState();
  return true;
});

// Vision updates from renderer
ipcMain.handle("sendVisionUpdate", async (_event, visionSummary) => {
  console.log("[MAIN] sendVisionUpdate:", visionSummary);

  if (visionSummary.userPresent !== undefined) {
    worldState.userPresent = !!visionSummary.userPresent;
  }
  if (visionSummary.emotion) {
    worldState.userEmotion = visionSummary.emotion;
  }

  pushWorldState();
  return true;
});
