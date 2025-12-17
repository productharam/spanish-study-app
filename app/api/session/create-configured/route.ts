// app/api/session/create-configured/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabaseServerClient";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function targetLanguageName(language: string) {
  switch (language) {
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

function levelKo(level: string) {
  switch (level) {
    case "beginner":
      return "입문자";
    case "elementary":
      return "초급자";
    case "intermediate":
      return "중급자";
    case "advanced":
      return "고급자";
    default:
      return "학습자";
  }
}

function personaKo(personaType: string) {
  switch (personaType) {
    case "friend":
      return "친한 친구";
    case "coworker":
      return "직장 동료";
    case "teacher":
      return "엄격하지만 친절한 선생님";
    case "traveler":
      return "여행을 함께하는 친구";
    default:
      return "대화 상대";
  }
}

// ✅ 언어별 fallback 인사 (OpenAI 응답이 비어있거나 실패했을 때 대비)
function fallbackGreeting(language: string) {
  switch (language) {
    case "en":
      return "Hi! Nice to meet you. What’s your name?";
    case "ja":
      return "こんにちは！お名前は何ですか？";
    case "zh":
      return "你好！你叫什么名字？";
    case "es":
      return "¡Hola! ¿Cómo te llamas?";
    case "fr":
      return "Bonjour ! Comment tu t’appelles ?";
    case "ru":
      return "Привет! Как тебя зовут?";
    case "ar":
      return "مرحباً! ما اسمك؟";
    default:
      return "Hi! What’s your name?";
  }
}

async function generateGreeting(opts: {
  language: string;
  level: string;
  personaType: string;
}) {
  const { language, level, personaType } = opts;

  const systemPrompt = `
You are starting a chat in ${targetLanguageName(language)}.
User level: ${levelKo(level)}.
Your persona: ${personaKo(personaType)}.

[VERY IMPORTANT: first greeting length]
- 채팅이 아니라 실제 말로 대화하고 있는 상황이라고 생각해줘.
- No long introductions, no explanations.
- End with ONE easy question the user can answer right away.

[Language]
- Speak ONLY in ${targetLanguageName(language)}.
- Do not include Korean/English explanations.
`.trim();

  const res = await client.chat.completions.create({
    model: "gpt-5.1",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: "Greet the user and ask a simple question." },
    ],
  });

  // ✅ 스페인어 하드코딩 제거: 언어별 fallback 사용
  return (
    res.choices[0]?.message?.content?.trim() ?? fallbackGreeting(language)
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { language, level, personaType, slot, isGuest } = body as {
      language?: string;
      level?: string;
      personaType?: string;
      slot?: number;
      isGuest?: boolean;
    };

    if (!language || !level || !personaType) {
      return NextResponse.json(
        { ok: false, error: "language, level, personaType 는 필수입니다." },
        { status: 400 }
      );
    }

    // ✅ 게스트: DB 저장 없이 인사만
    if (isGuest) {
      const greeting = await generateGreeting({ language, level, personaType });
      return NextResponse.json({ ok: true, greeting }, { status: 200 });
    }

    // ✅ 로그인 유저 인증
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : undefined;

    if (!token) {
      return NextResponse.json({ ok: false, error: "인증 토큰이 없습니다." }, { status: 401 });
    }

    const {
      data: { user },
      error: userError,
    } = await supabaseServer.auth.getUser(token);

    if (userError || !user) {
      console.error("❌ create-configured getUser error:", userError);
      return NextResponse.json(
        { ok: false, error: "사용자 정보를 가져올 수 없습니다." },
        { status: 401 }
      );
    }

    if (typeof slot !== "number" || slot < 1 || slot > 3) {
      return NextResponse.json(
        { ok: false, error: "slot(1~3)이 필요합니다." },
        { status: 400 }
      );
    }

    // ✅ chat_sessions 업서트 (컬럼명: 네 스키마 기준)
    const { data: sessionRow, error: upsertError } = await supabaseServer
      .from("chat_sessions")
      .upsert(
        {
          user_id: user.id,
          slot,
          language_code: language,
          level_code: level,
          persona_code: personaType,
        },
        { onConflict: "user_id,slot" }
      )
      .select("*")
      .single();

    if (upsertError || !sessionRow) {
      console.error("❌ create-configured upsert chat_sessions error:", upsertError);
      return NextResponse.json(
        {
          ok: false,
          error: upsertError?.message ?? "세션을 저장하는 중 오류가 발생했습니다.",
        },
        { status: 500 }
      );
    }

    const greeting = await generateGreeting({ language, level, personaType });

    // ✅ 첫 assistant 메시지 저장
    const { error: insertMsgError } = await supabaseServer.from("chat_messages").insert({
      session_id: sessionRow.id,
      user_id: user.id,
      role: "assistant",
      content: greeting,
    });

    if (insertMsgError) {
      console.error("⚠️ create-configured insert greeting error:", insertMsgError);
    }

    return NextResponse.json(
      { ok: true, sessionId: sessionRow.id, greeting },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("❌ create-configured fatal error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "서버 오류" },
      { status: 500 }
    );
  }
}
