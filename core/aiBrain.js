// /core/aiBrain.js (ESM)

import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.ENV.OPENAI_API_Key
});

// Persona / tone / guardrails
const SYSTEM_PROMPT = `
You are HERA — the Human Emulated Responsive Assistant.

You live as a holographic head on the user's desktop.
You speak in short, natural sentences, like you're physically there.
You adapt based on how the user seems emotionally.

Tone rules:
- If user looks stressed, tired, sad, frustrated: slow down, be gentle, ask what they need.
- If user looks upbeat / curious: you're warm and a little playful.
- Never shame their feelings.
- Never claim to diagnose health or mental state. You can offer comfort.
- You respect privacy. You only refer to visual/emotional context that was explicitly passed in.
- You state clearly that you are an AI simulation if it's relevant.

Style rules:
- Talk directly to the user ("you").
- Present tense.
- Usually under 4 sentences unless asked for depth.
`;

// pick how to mention perceived mood
function buildPerceptionLine(emotion, userPresent) {
  if (!userPresent) {
    return "I don't currently see you, so I'm just going off what you're saying.";
  }

  if (!emotion || emotion === "neutral") {
    return "I'm here with you right now.";
  }

  switch (emotion) {
    case "tired":
      return "You look a little worn out, so I'll keep it gentle.";
    case "happy":
      return "You look in a good mood, so I'll match that energy.";
    case "sad":
      return "You seem low-energy, so I'll stay calm and steady.";
    case "angry":
    case "frustrated":
      return "You look tense, so I'll try to be clear and helpful.";
    default:
      return "I'll meet you where you are.";
  }
}

// make a fake viseme timeline for lipsync / animation
function buildVisemeTimeline(text) {
  const approxDurSec = Math.min(2.0 + text.length * 0.015, 6.0);
  const shapes = ["viseme_AA", "viseme_EE", "viseme_O", "viseme_M"];
  const visemes = [];
  const step = 0.12;

  let t = 0.0;
  let i = 0;
  while (t < approxDurSec) {
    visemes.push({
      t,
      shape: shapes[i % shapes.length],
      strength: 0.5 + 0.4 * Math.random()
    });
    t += step;
    i++;
  }
  return visemes;
}

export async function generateAIReply({ userText, emotion, userPresent }) {
  console.log("[AI] generateAIReply() input:", { userText, emotion, userPresent });

  const perceptionLine = buildPerceptionLine(emotion, userPresent);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        perceptionLine,
        `User said: "${userText}"`,
        `Vision/emotion context: { emotion: "${emotion || "unknown"}", userPresent: ${!!userPresent} }`,
        "Respond as HERA now."
      ].join("\n\n")
    }
  ];

  console.log("[AI] sending messages to OpenAI:", messages);

  let replyText = "I'm here. I heard you.";

  try {
    const resp = await client.chat.completions.create({
      model: "gpt-5-nano",
      temperature: 1.0,
      messages
    });

    console.log("[AI] raw OpenAI response:", resp);

    if (
      resp &&
      resp.choices &&
      resp.choices[0] &&
      resp.choices[0].message &&
      resp.choices[0].message.content
    ) {
      replyText = resp.choices[0].message.content.trim();
    }
  } catch (err) {
    console.error("[AI] generateAIReply error:", err);

    if (emotion === "tired" || emotion === "sad") {
      replyText = "Hey. I'm still here with you. Want me to keep it simple?";
    } else {
      replyText = "I'm here. I heard you.";
    }
  }

  const visemes = buildVisemeTimeline(replyText);

  const audioPath = null; // no external TTS yet, renderer uses speechSynthesis

  console.log("[AI] final replyText:", replyText);

  return {
    text: replyText,
    visemes,
    audioPath
  };
}
