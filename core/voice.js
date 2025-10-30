// /core/voice.js
import fs from "node:fs";
import path from "node:path";

export async function synthesizeVoice(text) {
  // Later: call ElevenLabs / Coqui / custom TTS and write the actual MP3 bytes.
  // For now we just generate an empty file so audio element will 'play' (silently).

  const outDir = process.env.AUDIO_OUTPUT_DIR || "./audio_out";
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const fileName = `hera_voice_${Date.now()}.mp3`;
  const filePath = path.join(process.cwd(), outDir, fileName);

  // Empty buffer placeholder
  fs.writeFileSync(filePath, Buffer.from([]));

  return {
    filePath,
    mime: "audio/mpeg"
  };
}
