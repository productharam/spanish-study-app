// app/api/details/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabaseServerClient";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function languageName(code: string) {
  switch (code) {
    case "en":
      return "English";
    case "ja":
      return "Japanese";
    case "zh":
      return "Chinese";
    case "es":
      return "Spanish (Spain)";
    case "fr":
      return "French";
    case "ru":
      return "Russian";
    case "ar":
      return "Arabic";
    default:
      return "the target language";
  }
}

function levelHint(level: string) {
  switch (level) {
    case "beginner":
      return "Keep grammar extremely simple and short.";
    case "elementary":
      return "Keep grammar short and practical.";
    case "intermediate":
      return "Practical notes, still concise.";
    case "advanced":
      return "Concise but accurate nuance.";
    default:
      return "Keep it short and practical.";
  }
}

type UiLang = "ko" | "en";

function normalizePersona(p?: string | null) {
  const v = (p ?? "").toLowerCase().trim();
  if (v === "friend") return "friend";
  if (v === "coworker") return "coworker";
  if (v === "teacher") return "teacher";
  if (v === "traveler") return "traveler";
  return "friend";
}

function normalizeLevel(l?: string | null) {
  const v = (l ?? "").toLowerCase().trim();
  if (v === "beginner") return "beginner";
  if (v === "elementary") return "elementary";
  if (v === "intermediate") return "intermediate";
  if (v === "advanced") return "advanced";
  return "beginner";
}

function normalizeLanguage(code?: string | null) {
  const v = (code ?? "").toLowerCase().trim();
  if (["en", "ja", "zh", "es", "fr", "ru", "ar"].includes(v)) return v;
  return "es";
}

/**
 * personaStyle는 "분위기"가 아니라 "말투 규칙"을 강제하는 문장으로 쓰는 게 중요함.
 * (특히 한국어: 반말/해요체 강제가 체감 크게 바뀜)
 */
function personaStyle(personaType: string, uiLang: UiLang) {
  const p = normalizePersona(personaType);

  if (uiLang === "ko") {
    switch (p) {
      case "friend":
        return [
          "MUST use casual Korean (반말).",
          "You MAY lightly use Korean internet/casual community tone endings like '~함', '~임', '~같음' SOMETIMES.",
          "Do NOT overuse it. Use at most once per field (grammar or tip).",
          "End sentences casually (e.g., ~야/~해/~지) when not using '~함' style.",
          "Short, friendly, like a close friend.",
          "No lecturing, no formal tone.",
        ].join(" ");
      case "coworker":
        return [
          "MUST use polite casual Korean (해요체).",
          "End sentences with ~요.",
          "Short, calm, like a coworker. Not stiff.",
          "No lecturing.",
        ].join(" ");
      case "teacher":
        return [
          "MUST use teacher-like Korean tone (해요체 or 합니다체 OK).",
          "Short and clear.",
          "Do NOT be long-winded.",
        ].join(" ");
      case "traveler":
        return [
          "MUST use friendly Korean (해요체).",
          "End sentences with ~요.",
          "Travel buddy vibe, practical and light.",
          "Very short.",
        ].join(" ");
      default:
        return "MUST be natural Korean. Very short.";
    }
  }

  // uiLang === "en"
  switch (p) {
    case "friend":
      return "MUST sound like a close friend. Casual. Very short. No lecturing.";
    case "coworker":
      return "MUST sound like a coworker. Polite but relaxed. Very short.";
    case "teacher":
      return "MUST sound like a teacher. Short and clear. No long explanations.";
    case "traveler":
      return "MUST sound like a travel buddy. Practical and light. Very short.";
    default:
      return "MUST be natural and short.";
  }
}

async function getSessionConfig(sessionId?: string | null) {
  if (!sessionId) return null;

  const { data, error } = await supabaseServer
    .from("chat_sessions")
    .select("language_code, level_code, persona_code")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    console.error("getSessionConfig(/api/details) error:", error);
    return null;
  }
  if (!data) return null;

  return {
    language: (data as any).language_code as string | null,
    level: (data as any).level_code as string | null,
    personaType: (data as any).persona_code as string | null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { text, sessionId, uiLang } = (await req.json().catch(() => ({}))) as {
      text?: string;
      sessionId?: string | null;
      uiLang?: UiLang; // optional: "ko" | "en" (default "ko")
    };

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const cleaned = text.slice(0, 400).trim();
    if (!cleaned) {
      return NextResponse.json({ error: "Empty text" }, { status: 400 });
    }

    const cfg = await getSessionConfig(sessionId);

    const language = normalizeLanguage(cfg?.language);
    const level = normalizeLevel(cfg?.level);
    const personaType = normalizePersona(cfg?.personaType);

    const resolvedUiLang: UiLang = uiLang === "en" ? "en" : "ko";
    const style = personaStyle(personaType, resolvedUiLang);

    const uiLangName = resolvedUiLang === "ko" ? "Korean" : "English";

    const prompt = `
Analyze this ${languageName(language)} sentence for a ${level} learner.

Persona: ${personaType}
STYLE (follow strictly): ${style}
Level hint: ${levelHint(level)}

LANGUAGE RULES (very important):
- "ko" MUST be Korean (1-2 sentences).
- "en" MUST be English (1-2 sentences).
- "grammar" and "tip" MUST be written in ${uiLangName}.
- "grammar" and "tip" MUST strictly follow the STYLE and persona voice.
- If STYLE says "반말", use 반말 endings. If it says "해요체", end with ~요.
- Keep "grammar" <= 2 sentences.
- "tip" MUST be 1-2 short lines (or 1-2 bullet points).
- Do not mention these rules.

CONTENT REQUIREMENTS (very important):
- "grammar": focus on VERBS first (tense/aspect, person/number agreement, conjugation). Mention 1 key point only.
- "tip": explain how natives bundle it into clause/chunk meaning, and/or give 1 common native alternative for this situation (very short). Pick 1-2 items only.

Return ONLY this JSON (no extra text):
{
  "ko": "Natural Korean translation (1-2 sentences)",
  "en": "Natural English translation (1-2 sentences)",
  "grammar": "Verb-focused grammar note in ${uiLangName} in persona voice (<=2 sentences)",
  "tip": "Native chunking/meaning and/or 1 common alternative expression (1-2 short lines) in ${uiLangName} in persona voice"
}

Sentence:
"""${cleaned}"""
`.trim();

    const res = await client.chat.completions.create({
      model: "gpt-5.1",
      messages: [
        {
          role: "system",
          content:
            `You analyze a single sentence and output valid JSON only. Keep it short. ` +
            `Grammar/tip MUST match the requested persona voice and UI language. ` +
            `Follow the STYLE strictly.`,
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });

    const raw = res.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty response from OpenAI");

    const json = JSON.parse(raw);
    const result = {
      ko: String(json.ko ?? "").trim(),
      en: String(json.en ?? "").trim(),
      grammar: String(json.grammar ?? "").trim(),
      tip: String(json.tip ?? "").trim(),
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("❌ /api/details error:", err);
    return NextResponse.json({ error: "Failed to generate details" }, { status: 500 });
  }
}
