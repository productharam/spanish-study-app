import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabaseServerClient";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const TERMS_VERSION = "2025-12-30";
const PRIVACY_VERSION = "2025-12-30";
const COLLECTION_VERSION = "2025-12-30";

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

async function assertConsentIfLoggedIn(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1];

  // ✅ 토큰 없으면 게스트 호출로 보고 패스
  if (!token) return { ok: true as const, userId: null as string | null };

  // ✅ 토큰 있으면 로그인 유저로 간주 -> user 확인
  const { data, error } = await supabaseServer.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false as const, status: 401, code: "UNAUTHORIZED" as const };
  }

  const userId = data.user.id;

  // ✅ 동의 레코드 확인
  const { data: consent, error: consentErr } = await supabaseServer
    .from("user_consents")
    .select("terms_version, privacy_version, collection_version")
    .eq("user_id", userId)
    .maybeSingle();

  if (consentErr) {
    console.error("Consent check error(/api/chat):", consentErr);
    return { ok: false as const, status: 500, code: "CONSENT_CHECK_FAILED" as const };
  }

  const isAccepted =
    !!consent &&
    consent.terms_version === TERMS_VERSION &&
    consent.privacy_version === PRIVACY_VERSION &&
    consent.collection_version === COLLECTION_VERSION;

  if (!isAccepted) {
    return { ok: false as const, status: 403, code: "CONSENT_REQUIRED" as const };
  }

  return { ok: true as const, userId };
}

export async function POST(req: NextRequest) {
  try {
    // ✅ 0) 로그인 유저면 동의 필수
    const consentRes = await assertConsentIfLoggedIn(req);
    if (!consentRes.ok) {
      return NextResponse.json(
        { ok: false, error: consentRes.code },
        { status: consentRes.status }
      );
    }

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
- Use words, expressions, and sentence patterns that native speakers commonly use in everyday life.
- Prefer natural, daily spoken language over formal, literary, or textbook-style expressions.
- Avoid rare, academic, or overly polite phrasing unless it is genuinely used in casual conversation.

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

    return NextResponse.json({ ok: true, reply });
  } catch (error) {
    console.error("❌ /api/chat error:", error);
    return NextResponse.json(
      { ok: false, reply: "서버에서 오류가 발생했어. 잠시 후 다시 시도해 줘!" },
      { status: 500 }
    );
  }
}
