// /runtime/lipSync.js
export function buildVisemes(spokenText) {
  // Fake: step through a few shapes over ~0.6s
  return [
    { t: 0.00, shape: "AA", strength: 1.0 },
    { t: 0.15, shape: "O",  strength: 0.9 },
    { t: 0.30, shape: "FV", strength: 0.8 },
    { t: 0.45, shape: "AA", strength: 1.0 },
    { t: 0.60, shape: "O",  strength: 0.7 }
  ];
}
