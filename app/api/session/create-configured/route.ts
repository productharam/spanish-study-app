// app/api/session/create-configured/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabaseServerClient";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// ✅ GPT 인사 한 줄 만들어주는 함수 (그대로)
async function generateGreeting(opts: {
  language: string;
  level: string;
  personaType: string;
}) {
  const { language, level, personaType } = opts;

  const levelKo =
    level === "beginner"
      ? "입문자"
      : level === "elementary"
      ? "초급자"
      : level === "intermediate"
      ? "중급자"
      : level === "advanced"
      ? "고급자"
      : "학습자";

  const personaKo =
    personaType === "friend"
      ? "친한 친구"
      : personaType === "coworker"
      ? "직장 동료"
      : personaType === "teacher"
      ? "엄격하지만 친절한 선생님"
      : personaType === "traveler"
      ? "여행을 함께하는 친구"
      : "대화 상대";

  const targetLanguageName =
    language === "en"
      ? "영어"
      : language === "ja"
      ? "일본어"
      : language === "zh"
      ? "중국어"
      : language === "es"
      ? "스페인어"
      : language === "fr"
      ? "프랑스어"
      : language === "ru"
      ? "러시아어"
      : language === "ar"
      ? "아랍어"
      : "해당 언어";

  const systemPrompt = `
당신은 ${targetLanguageName} 회화를 도와주는 AI입니다.
사용자는 ${levelKo} 수준이며, 당신은 ${personaKo} 역할입니다.

규칙:
- 반드시 ${targetLanguageName}(=코드 ${language})로만 말합니다. 한국어나 영어 설명은 하지 마세요.
- 첫 인사는 2~3문장 정도로 짧게 합니다.
- 너무 어려운 표현은 피하고, 사용자가 대답하기 쉬운 질문으로 끝내세요.
- 존댓말/반말 스타일은 ${personaKo}에 맞게 자연스럽게 조절하세요.
`.trim();

  const response = await client.responses.create({
    model: "gpt-5.1",
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: "사용자에게 첫 인사를 해 주세요." },
    ],
  });

  const first = response.output[0] as any;
  const firstContent = first?.content?.[0];
  const text =
    firstContent?.type === "output_text"
      ? firstContent.text
      : "Hola, ¡empecemos a hablar!";

  return text.trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { language, level, personaType, slot, isGuest } = body as {
      language: string;
      level: string;
      personaType: string;
      slot?: number;
      isGuest?: boolean;
    };

    if (!language || !level || !personaType) {
      return NextResponse.json(
        { ok: false, error: "language, level, personaType 는 필수입니다." },
        { status: 400 }
      );
    }

    // ✅ 게스트 모드: DB 건드리지 않고 인사만 생성
    if (isGuest) {
      const greeting = await generateGreeting({ language, level, personaType });
      return NextResponse.json({ ok: true, greeting }, { status: 200 });
    }

    // ✅ 로그인 유저 인증
    const authHeader =
      req.headers.get("authorization") || req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : undefined;

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "인증 토큰이 없습니다." },
        { status: 401 }
      );
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

    // ✅ chat_sessions 업서트
    const { data: sessionRow, error: upsertError } = await supabaseServer
  .from("chat_sessions")
  .upsert(
    {
      user_id: user.id,
      slot, // int4
      language_code: language,      // ✅ 실제 컬럼명
      level_code: level,            // ✅ 실제 컬럼명
      persona_code: personaType,    // ✅ 실제 컬럼명
    },
    {
      onConflict: "user_id,slot",
    }
  )
  .select("*")
  .single();


    if (upsertError || !sessionRow) {
      console.error(
        "❌ create-configured upsert chat_sessions error:",
        upsertError
      );
      return NextResponse.json(
        {
          ok: false,
          error:
            upsertError?.message ??
            "세션을 저장하는 중 오류가 발생했습니다.",
        },
        { status: 500 }
      );
    }

    // ✅ 인사 문장 생성
    const greeting = await generateGreeting({ language, level, personaType });

    // ✅ 첫 assistant 메시지도 저장
    const { error: insertMsgError } = await supabaseServer
      .from("chat_messages")
      .insert({
        session_id: sessionRow.id,
        user_id: user.id,
        role: "assistant",
        content: greeting,
      });

    if (insertMsgError) {
      console.error(
        "⚠️ create-configured insert greeting error:",
        insertMsgError
      );
      // 메시지 저장 실패해도 세션은 있으니 ok 응답은 그대로 보냄
    }

    return NextResponse.json(
      {
        ok: true,
        sessionId: sessionRow.id,
        greeting,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("❌ create-configured fatal error:", err);
    const message =
      err?.message ?? (typeof err === "string" ? err : JSON.stringify(err));
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
