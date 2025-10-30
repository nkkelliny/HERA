// preload.cjs (CommonJS)

const { contextBridge, ipcRenderer } = require("electron");

console.log("[PRELOAD] running preload.cjs");

// Expose safe, structured API to the renderer
contextBridge.exposeInMainWorld("heraAPI", {
  // mic audio burst -> whisper -> AI
  sendAudioChunk: (base64Wav) => {
    console.log("[PRELOAD] sendAudioChunk -> main");
    return ipcRenderer.invoke("sendAudioChunk", base64Wav);
  },

  // typed text -> AI
  sayText: (text) => {
    console.log("[PRELOAD] sayText -> main", text);
    return ipcRenderer.invoke("sayText", text);
  },

  // mic toggle
  setMicActive: (active) => {
    console.log("[PRELOAD] setMicActive -> main", active);
    return ipcRenderer.invoke("setMicActive", active);
  },

  // camera toggle
  setCamActive: (active) => {
    console.log("[PRELOAD] setCamActive -> main", active);
    return ipcRenderer.invoke("setCamActive", active);
  },

  // vision state (presence + emotion)
  sendVisionUpdate: (summary) => {
    console.log("[PRELOAD] sendVisionUpdate -> main", summary);
    return ipcRenderer.invoke("sendVisionUpdate", summary);
  },

  // listen for world state (mic/cam LEDs, presence, mood)
  onWorldStateUpdate: (cb) => {
    ipcRenderer.on("worldStateUpdate", (_event, data) => {
      try {
        cb(data);
      } catch (err) {
        console.error("[PRELOAD] onWorldStateUpdate cb error:", err);
      }
    });
  },

  // listen for assistant speech events (AI reply ready)
  onAssistantSpeech: (cb) => {
    ipcRenderer.on("assistantSpeech", (_event, data) => {
      try {
        cb(data);
      } catch (err) {
        console.error("[PRELOAD] onAssistantSpeech cb error:", err);
      }
    });
  }
});
