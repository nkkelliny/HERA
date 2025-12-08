HERA — Human Emulated Responsive Assistant
==========================================

![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg) ![Version](https://img.shields.io/badge/version-1.0.0-orange.svg) ![Platform](https://img.shields.io/badge/platform-Electron-47848F.svg) ![Status](https://img.shields.io/badge/status-Experimental-orange.svg)

HERA is a desktop assistant with a 3D head that talks, listens, and reacts to you. It runs in **Electron** and uses:

*   **Three.js** to render an animated 3D head (`head.glb`)
*   **Whisper.cpp** for local speech-to-text (offline speech recognition)
*   **OpenAI API** for language + personality
*   **Browser TTS** (`speechSynthesis`) for voice output
*   **Camera analysis** to estimate presence and mood and adapt tone

HERA is not just a chatbot window. It is meant to feel present, like a holographic companion living on your desktop.

* * *

Project Layout
--------------

```
.
├─ main.js              Electron main process (ESM)
├─ preload.cjs          Secure bridge between renderer & main (CommonJS)
├─ /renderer
│  ├─ index.html        UI shell
│  ├─ index.js          Frontend logic (mic loop, UI state, etc.)
│  ├─ threeHead.js      Loads and animates the 3D head in Three.js
│  ├─ vision.js         Camera capture + facial mood estimation
│  ├─ libs/
│     ├─ three.module.js
│     ├─ GLTFLoader.js
├─ /core
│  ├─ aiBrain.js        Personality + reply generation using OpenAI
├─ /whisper-bin
│  ├─ whisper-cli.exe   or main.exe from whisper.cpp build
├─ /models
│  ├─ ggml-base.en.bin  Whisper model file
└─ package.json
```

The app uses ES modules for most of the code (`"type": "module"` in `package.json`), but `preload.cjs` stays CommonJS so Electron can inject it cleanly.

* * *

Main Components
---------------

### Electron main (`main.js`)

*   Creates the app window and loads `renderer/index.html`.
*   Owns **worldState** (mic on/off, cam on/off, user mood, etc.).
*   Receives audio chunks from the renderer, runs Whisper, gets transcript.
*   Calls `generateAIReply()` in `aiBrain.js`.
*   Sends the AI's reply back to the renderer via `assistantSpeech`.

### Preload bridge (`preload.cjs`)

*   Exposes a safe `window.heraAPI` object to the renderer.
*   Lets the renderer:
    *   send mic audio chunks → main
    *   send vision state (mood, presence) → main
    *   toggle mic/cam state
    *   subscribe to:
        *   `worldStateUpdate`
        *   `assistantSpeech`
*   **Security note:** `contextIsolation: true` in Electron means renderer JS never directly touches Node APIs.

### Renderer (`/renderer/index.js`)

*   Renders the UI (status indicators, mic toggle, etc.).
*   Captures microphone audio in 10-second bursts.
*   Converts WebM → WAV (16-bit PCM) in the browser.
*   Sends base64 WAV to main via `heraAPI.sendAudioChunk()`.
*   Handles `assistantSpeech` events:
    *   Triggers browser TTS to speak the reply.
    *   Animates the mouth / visemes on the 3D head while speaking.

### 3D Head (`/renderer/threeHead.js`)

*   Loads `head.glb` with `GLTFLoader` from Three.js.
*   Positions the head in a transparent WebGL canvas.
*   Stores morph target names for mouth shapes (AA, EE, O, M, etc.).
*   Exposes `driveVisemesFrame()` so lips can move in sync with speech.

### Vision (`/renderer/vision.js`)

*   Optionally activates the webcam (only if the user turns it on).
*   Runs a lightweight face/landmark model to estimate:
    *   `userPresent`: are you in front of the camera?
    *   `emotion`: "happy", "tired", "sad", "frustrated", "neutral".
*   Sends these signals to main via `heraAPI.sendVisionUpdate()`.
*   Main includes that emotional context when asking OpenAI for a reply.

### AI Brain (`/core/aiBrain.js`)

*   Builds HERA's personality context:
    *   supportive but honest
    *   short, natural sentences
    *   never pretends to literally be human
*   Sends conversation to OpenAI.
*   Returns:
    *   `text` (what HERA says)
    *   `visemes` (timeline of mouth shapes)

* * *

How Voice Interaction Works
---------------------------

### Listening

1.  You click **Mic ON**.
2.  Renderer records ~10 seconds of audio from your mic using `MediaRecorder`.
3.  Renderer converts that audio to 16-bit mono WAV and base64-encodes it.
4.  Renderer calls `window.heraAPI.sendAudioChunk(base64Wav)`.

### Transcription

1.  Main receives the audio chunk.
2.  Main writes a temp `.wav` file.
3.  Main runs the local Whisper binary (`whisper.cpp`) with your `ggml-*.bin` model to get text.
4.  Main logs that transcript and (optionally) buffers short bursts into a full "user sentence".

### Reply Generation

1.  Main calls `generateAIReply()` with:
    *   your words
    *   your inferred mood (if camera is on)
    *   whether you're present or walked away
2.  `generateAIReply()` talks to OpenAI with a structured prompt (HERA persona).
3.  It builds a response and a rough viseme timeline.

### Speaking Back

1.  Main sends an `assistantSpeech` event to the renderer with:
    *   `text`
    *   `visemes`
2.  Renderer:
    *   Calls `speechSynthesis.speak()` to speak out loud.
    *   While speaking, animates the mouth shapes frame-by-frame using `driveVisemesFrame()`.
    *   Shows UI state: _"HERA speaking…"_, then cooldown, then _"listening…"_ again.

* * *

Privacy & Control
-----------------

*   **Mic** is off until you click **Mic ON**. When off, no audio is recorded or sent to Whisper.
*   **Camera** is off until you click **Cam ON**. When off, no image data is analyzed.
*   Mood detection is local. We only send a simple label like `{"emotion":"tired","userPresent":true}` to the AI — not raw video frames.
*   HERA reminds you she is an AI simulation, not a human, and cannot guarantee medical, legal, or safety advice.

You stay in control. You can disable mic, disable cam, or close the app any time.

* * *

To Use
------

To clone and run this repository, you'll need [Git](https://git-scm.com), [Node.js](https://nodejs.org/en/download/) (which comes with [npm](http://npmjs.com)), and [Electron](https://www.electronjs.org/) installed on your computer.

From your command line:

**1. Clone this repository**

```bash
git clone https://github.com/your-username/hera.git
cd hera
```

**2. Install dependencies**

```bash
npm install
```

**3. Set up Whisper**

Put your Whisper binary in `/whisper-bin` and your model file in `/models`.

**4. Set up the 3D head**

Put your 3D head at `/renderer/assets/head.glb` (or update the path in `threeHead.js`).

**5. Configure OpenAI**

Set your OpenAI API key in `core/aiBrain.js`.

**6. Run the application**

```bash
npx electron .
```

**7. Start interacting**

Click **Mic ON**, say something, pause — HERA should answer out loud and animate her mouth.

Note: If you hear nothing but you see transcript logs in terminal, check Windows speech output device and/or let HERA respond to text by typing into the box and pressing "Say."

* * *

Roadmap / Next Steps
--------------------

*   **Better lipsync:** swap rough visemes for phoneme-accurate timing or baked animation clips from Blender.
*   **Custom TTS voice:** generate a WAV + exact viseme timestamps instead of relying on `speechSynthesis`.
*   **Wake word:** passive always-listening loop (e.g. "HERA?") with an automatic cooldown so HERA doesn't transcribe herself.
*   **On-screen memory / context:** optional panel of recent user turns so you can "scroll back" what was heard/said.

* * *

Acknowledgments
---------------

*   [Three.js](https://threejs.org/) for rendering & morph targets
*   [whisper.cpp](https://github.com/ggerganov/whisper.cpp) for on-device speech recognition
*   [OpenAI API](https://openai.com/) for conversational reasoning and persona
*   [MediaPipe](https://mediapipe.dev/) style face landmarks for mood / presence detection
*   [Electron](https://www.electronjs.org/)

HERA's goal is simple: real-time presence, not just text bubbles.
