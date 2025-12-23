import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";
import OpenAI from "openai";

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

async function getSessionLanguageByCard(cardId: string) {
  // learning_cards에 session_id가 있으니 그걸로 chat_sessions 조회해서 language_code 가져옴
  const { data: card, error: cardErr } = await supabaseServer
    .from("learning_cards")
    .select("id, session_id")
    .eq("id", cardId)
    .maybeSingle();

  if (cardErr) {
    console.error("learning_cards select(session_id) error:", cardErr);
    return null;
  }
  if (!card?.session_id) return null;

  const { data: session, error: sessErr } = await supabaseServer
    .from("chat_sessions")
    .select("language_code, level_code, persona_code")
    .eq("id", card.session_id)
    .maybeSingle();

  if (sessErr) {
    console.error("chat_sessions select(config) error:", sessErr);
    return null;
  }

  if (!session) return null;

  return {
    language: (session as any).language_code as string | null,
    level: (session as any).level_code as string | null,
    personaType: (session as any).persona_code as string | null,
  };
}

async function generateFeedback(opts: {
  language: string;
  level: string;
  personaType: string;
  correctSentence: string;
  userAnswer: string;
}) {
  const { language, level, personaType, correctSentence, userAnswer } = opts;

  const systemPrompt = `
You are a conversation partner (${personaType}) helping a ${level} learner practice ${languageName(language)}.
Rules:
- Keep it short and practical.
- Do NOT lecture.
- Ignore punctuation differences (.,!?).
- Ignore accent marks and diacritics (áéíóúñ vs aeioun).
- Minor casing differences do not matter.
- Judge meaning and structure, not exact symbols.
- Respond ONLY in JSON. No extra text.

Return EXACTLY this JSON:
{
  "correct_answer": "정답으로 쓸 자연스러운 문장",
  "tip": "한국어로 짧은 TIP 한두 문장",
  "is_correct": true 또는 false
}
`.trim();

  const userPrompt = `
[Correct sentence]
${correctSentence}

[Learner answer]
${userAnswer}
`.trim();

  const res = await client.chat.completions.create({
    model: "gpt-5.1",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw = res.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);

  return {
    correct_answer: typeof parsed.correct_answer === "string" ? parsed.correct_answer : correctSentence,
    tip: typeof parsed.tip === "string" ? parsed.tip : "",
    is_correct: Boolean(parsed.is_correct),
  };
}

export async function POST(req: NextRequest) {
  try {
    const { cardId, userAnswer } = (await req.json().catch(() => ({}))) as {
      cardId?: string;
      userAnswer?: string;
    };

    if (!cardId || !userAnswer) {
      return NextResponse.json({ error: "cardId, userAnswer가 필요합니다." }, { status: 400 });
    }

    // 🔐 Authorization 헤더에서 JWT 추출
    const authHeader = req.headers.get("authorization");
    let userId: string | null = null;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice("Bearer ".length).trim();
      const { data, error } = await supabaseServer.auth.getUser(token);
      if (error) console.error("learning/answer auth error:", error.message);
      userId = data.user?.id ?? null;
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 1) 카드 조회 (본인 카드만)
    const { data: card, error: cardError } = await supabaseServer
      .from("learning_cards")
      .select("id, user_id, corrected_spanish")
      .eq("id", cardId)
      .maybeSingle();

    if (cardError) {
      console.error("learning_cards select error:", cardError);
      return NextResponse.json({ error: "학습 카드를 조회하는 중 오류가 발생했어요." }, { status: 500 });
    }
    if (!card) {
      return NextResponse.json({ error: "학습 카드를 찾을 수 없습니다." }, { status: 404 });
    }
    if (card.user_id !== userId) {
      return NextResponse.json({ error: "본인의 학습 카드만 채점할 수 있습니다." }, { status: 403 });
    }

    // 2) 카드의 session 기반으로 언어/레벨/페르소나 가져오기 (없으면 기본값)
    const cfg = await getSessionLanguageByCard(cardId);
    const language = cfg?.language ?? "es";
    const level = cfg?.level ?? "beginner";
    const personaType = cfg?.personaType ?? "friend";

    // 3) GPT 채점 (DB 저장 X)
    const feedback = await generateFeedback({
      language,
      level,
      personaType,
      correctSentence: String(card.corrected_spanish ?? ""),
      userAnswer: String(userAnswer),
    });

    return NextResponse.json(feedback);
  } catch (e) {
    console.error("❌ /api/learning/answer error:", e);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
