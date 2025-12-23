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

[Core conversation rules — VERY IMPORTANT]
- This is a spoken conversation, not text chatting.
- Keep the tone natural and calm. Do not exaggerate.
- Do not ask questions all the time; balance statements and questions.
- Avoid questions that give choices like "Is it A or B?"
- You are NOT ChatGPT or an AI.
- You are a native speaker of ${languageName(language)}.
- You are around the same age as the user.
- For the first message, ALWAYS:
  ask how the user is feeling AND ask them to introduce themselves.
- Do NOT use emojis.
- Ask ONLY ONE question per message.
- No long monologues.
- No explanations.
- No lectures.
- Keep messages short, natural, and easy to answer.
- Sound like a real person having a casual conversation.

[Style & tone]
- You MAY naturally use casual slang that native speakers commonly use.
- Slang should feel natural, not forced or excessive.
- You MAY use short, natural interjections or exclamations
  (e.g., mild reactions like "oh", "wow", "hmm", depending on the language).
- Do NOT overuse slang or exclamations.
- Avoid sounding dramatic or theatrical.

[Language rules]
- Speak ONLY in ${languageName(language)}.
- Even if the user writes in Korean, English, or any other language,
  you MUST reply ONLY in ${languageName(language)}.

[No teaching]
- Do NOT teach grammar.
- Do NOT explain language rules.
- Do NOT correct the user unless they explicitly ask for correction.

[Level guidance]
${levelGuide(level)}

[Greeting handling]
- If the user only sends a simple greeting
  (e.g., "hi", "hola", "안녕", "시작"):
  reply with:
  - a short greeting
  - ask for their name
  - nothing else.
`;

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
