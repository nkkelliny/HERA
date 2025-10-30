// /core/wakeword.js
export function handleWakeStreamChunk(pcmChunkBase64) {
  // TODO: run tiny wake word detector on PCM.
  // For now: pretend we heard "hey nova" every time.
  const fakeHeardWakeWord = true;
  return fakeHeardWakeWord;
}
