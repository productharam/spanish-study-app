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

function personaStyle(personaType: string, uiLang: UiLang) {
  if (uiLang === "ko") {
    switch (personaType) {
      case "friend":
        return "친한 친구 말투로 짧게. 편한 톤(반말 가능). 가르치려 들지 말기.";
      case "coworker":
        return "직장 동료 말투로 짧게. 예의는 있지만 부담 없는 톤.";
      case "teacher":
        return "선생님 말투로 짧게. 명확하지만 장황한 설명 금지.";
      case "traveler":
        return "여행 친구 말투로 짧게. 실전 상황 중심으로.";
      default:
        return "자연스럽고 짧게.";
    }
  }

  switch (personaType) {
    case "friend":
      return "Write like a close friend. Casual. Very short. No lecturing.";
    case "coworker":
      return "Write like a coworker. Polite but not stiff. Very short.";
    case "teacher":
      return "Write like a teacher. Short and clear. No long explanations.";
    case "traveler":
      return "Write like a travel buddy. Practical. Very short.";
    default:
      return "Natural and short.";
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

    const language = cfg?.language ?? "es";
    const level = cfg?.level ?? "beginner";
    const personaType = cfg?.personaType ?? "friend";

    const resolvedUiLang: UiLang = uiLang === "en" ? "en" : "ko";
    const style = personaStyle(personaType, resolvedUiLang);

    const prompt = `
Analyze this ${languageName(language)} sentence for a ${level} learner.

Persona tone for "grammar" and "tip": ${personaType}.
STYLE: ${style}
Level hint: ${levelHint(level)}

LANGUAGE RULES (very important):
- "ko" MUST be Korean (1-2 sentences).
- "en" MUST be English (1-2 sentences).
- "grammar" and "tip" MUST be written in ${
      resolvedUiLang === "ko" ? "Korean" : "English"
    } AND MUST sound like the persona (${personaType}).
- Keep "grammar" <= 2 sentences.
- "tip": 1-2 bullet points max (or 1-2 short lines).
- Do not mention these rules.

Return ONLY this JSON (no extra text):
{
  "ko": "Natural Korean translation (1-2 sentences)",
  "en": "Natural English translation (1-2 sentences)",
  "grammar": "Short note in ${
      resolvedUiLang === "ko" ? "Korean" : "English"
    } in persona voice",
  "tip": "1-2 short practical tips in ${
      resolvedUiLang === "ko" ? "Korean" : "English"
    } in persona voice"
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
            "You analyze a single sentence. Always output valid JSON only. Keep it short. Grammar/tip must match the requested persona voice and UI language.",
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
    return NextResponse.json(
      { error: "Failed to generate details" },
      { status: 500 }
    );
  }
}
