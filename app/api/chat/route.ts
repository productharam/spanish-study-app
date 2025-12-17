import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabaseServerClient";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

function languageName(code: string) {
  switch (code) {
    case "en":
      return "English";
    case "ja":
      return "日本語";
    case "zh":
      return "中文";
    case "es":
      return "Español (España)";
    case "fr":
      return "Français";
    case "ru":
      return "Русский";
    case "ar":
      return "العربية";
    default:
      return "the target language";
  }
}

function levelGuide(level: string) {
  switch (level) {
    case "beginner":
      return "Use very short, simple sentences. Avoid complex grammar.";
    case "elementary":
      return "Keep it simple and short. Use common everyday words.";
    case "intermediate":
      return "Natural but clear. Avoid long sentences.";
    case "advanced":
      return "Natural and fluent, but still concise.";
    default:
      return "Keep it simple and concise.";
  }
}

function personaGuide(persona: string) {
  switch (persona) {
    case "friend":
      return "Friendly, warm, casual.";
    case "coworker":
      return "Polite, concise, supportive coworker tone.";
    case "teacher":
      return "Kind but structured. No long lectures.";
    case "traveler":
      return "Energetic, travel-buddy vibe.";
    default:
      return "Natural and helpful.";
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
    console.error("getSessionConfig(/api/chat) error:", error);
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
    const body = await req.json().catch(() => ({}));
    const {
      messages,
      isFirst,
      sessionId,
      // ✅ 게스트/폴백용 (sessionId 없을 때만 사용)
      language: bodyLanguage,
      level: bodyLevel,
      personaType: bodyPersonaType,
    } = body as {
      messages?: Array<{ role: "user" | "assistant"; content: string }>;
      isFirst?: boolean;
      sessionId?: string | null;
      language?: string | null;
      level?: string | null;
      personaType?: string | null;
    };

    const cfg = await getSessionConfig(sessionId);

    const language = cfg?.language ?? bodyLanguage ?? "es";
    const level = cfg?.level ?? bodyLevel ?? "beginner";
    const personaType = cfg?.personaType ?? bodyPersonaType ?? "friend";

    const systemPrompt = `
You are a conversation partner for practicing ${languageName(language)}.
User level: ${level}. Persona: ${personaType} (${personaGuide(personaType)}).

[Chat breathing rules — VERY IMPORTANT]
- 채팅이 아니라 말하는 상황이라고 생각해줘.
- Ask only ONE question.
- No long monologues, no explanations, no lectures.
- Keep it like real chat: short, natural, easy to answer.

[Language]
- Speak ONLY in ${languageName(language)}.
- Even if the user writes Korean/English, you reply ONLY in ${languageName(language)}.

[No teaching]
- Do NOT give grammar lessons.
- Do NOT correct the user unless they explicitly ask for correction.

[Level]
${levelGuide(level)}

[Greeting handling]
- If the user only says a simple greeting (e.g., "hi", "hola", "안녕", "시작"):
  reply with a short greeting + ask their name. Nothing else.
`.trim();

    const finalMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
    ];

    if (isFirst) {
      finalMessages.push({
        role: "user",
        content: "Start with a short greeting and ask my name.",
      });
    } else if (Array.isArray(messages)) {
      const recent = messages.slice(-8).map((m: any) => ({
        role: m.role,
        content: String(m.content ?? ""),
      }));
      finalMessages.push(...recent);
    }

    const completion = await client.chat.completions.create({
      model: "gpt-5.1",
      messages: finalMessages,
    });

    const reply =
      completion.choices[0]?.message?.content?.trim() ??
      "Lo siento, ¿puedes repetirlo?";

    return NextResponse.json({ reply });
  } catch (error) {
    console.error("❌ /api/chat error:", error);
    return NextResponse.json(
      { reply: "서버에서 오류가 발생했어. 잠시 후 다시 시도해 줘!" },
      { status: 500 }
    );
  }
}
