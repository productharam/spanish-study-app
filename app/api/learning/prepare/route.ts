import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabaseServerClient";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function languageName(code: string) {
  switch (code) {
    case "en":
      return "영어";
    case "ja":
      return "일본어";
    case "zh":
      return "중국어";
    case "es":
      return "스페인어";
    case "fr":
      return "프랑스어";
    case "ru":
      return "러시아어";
    case "ar":
      return "아랍어";
    default:
      return "해당 언어";
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
    console.error("getSessionConfig(/api/learning/prepare) error:", error);
    return null;
  }
  if (!data) return null;

  return {
    language: (data as any).language_code as string | null,
    level: (data as any).level_code as string | null,
    personaType: (data as any).persona_code as string | null,
  };
}

async function generateKoreanPrompt(targetLanguageCode: string, sentence: string) {
  const prompt = `
다음 ${languageName(targetLanguageCode)} 문장을 학습용으로 변환해줘.

자연스러운 한국어 문장으로 번역

반드시 JSON 형식으로만 출력해:

{
  "korean": "자연스러운 한국어 번역",
}

원문: """${sentence}"""
`.trim();

  const res = await client.chat.completions.create({
    model: "gpt-5.1",
    messages: [
      {
        role: "system",
        content: "너는 외국어 문장을 한국어 학습용 문장으로 바꿔주는 튜터야. 항상 JSON만 반환해.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw = res.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(raw);

  return {
    korean: typeof parsed.korean === "string" ? parsed.korean : sentence,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { text, sessionId } = (await req.json().catch(() => ({}))) as {
      text?: string;
      sessionId?: string | null;
      messageId?: string | null; // (현재는 저장에 안 씀)
    };

    if (!text || typeof text !== "string") {
      return NextResponse.json({ ok: false, error: "text 필드가 필요합니다." }, { status: 400 });
    }

    const baseSentence = text.trim();
    if (!baseSentence) {
      return NextResponse.json({ ok: false, error: "유효한 문장이 필요합니다." }, { status: 400 });
    }

    // 🔐 Authorization 헤더에서 JWT 추출
    const authHeader = req.headers.get("authorization");
    let userId: string | null = null;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice("Bearer ".length).trim();
      const { data, error } = await supabaseServer.auth.getUser(token);
      if (error) console.error("learning/prepare auth error:", error.message);
      userId = data.user?.id ?? null;
    }

    // ✅ 세션 설정(언어) 가져오기 (없으면 기본 es)
    const cfg = await getSessionConfig(sessionId);
    const language = cfg?.language ?? "es";

    // ✅ 1) 캐시 조회 (로그인 유저만)
    if (userId) {
      try {
        let query = supabaseServer
          .from("learning_cards")
          .select("id, korean_prompt")
          .eq("user_id", userId)
          .eq("corrected_spanish", baseSentence) // ✅ 컬럼명 유지(기존 스키마)
          .order("created_at", { ascending: false })
          .limit(1);

        if (sessionId) query = query.eq("session_id", sessionId);

        const { data: existing, error } = await query.maybeSingle();
        if (error) {
          console.error("learning_cards existingCard error:", error.message);
        } else if (existing) {
          return NextResponse.json({
            ok: true,
            cardId: existing.id,
            korean: existing.korean_prompt,
          });
        }
      } catch (e) {
        console.error("learning_cards cache select exception:", e);
      }
    }

    // ✅ 2) GPT 생성
    const { korean } = await generateKoreanPrompt(language, baseSentence);

    // ✅ 3) 저장 (로그인 유저만)
    if (userId) {
      try {
        const insertPayload: any = {
          user_id: userId,
          session_id: sessionId ?? null,
          corrected_spanish: baseSentence, // ✅ 컬럼명 유지(기존 스키마)
          korean_prompt: korean,
        };

        const { data: inserted, error } = await supabaseServer
          .from("learning_cards")
          .insert(insertPayload)
          .select("id")
          .single();

        if (error || !inserted) {
          console.error("learning_cards insert error:", error);
          return NextResponse.json({
            ok: true,
            cardId: null,
            korean,
            warning: "카드를 저장하지 못했어요.",
          });
        }

        return NextResponse.json({ ok: true, cardId: inserted.id, korean });
      } catch (e) {
        console.error("learning_cards insert exception:", e);
        return NextResponse.json({
          ok: true,
          cardId: null,
          korean,
          warning: "카드를 저장하지 못했어요.",
        });
      }
    }

    // 게스트: 저장 없이 결과만
    return NextResponse.json({ ok: true, cardId: null, korean });
  } catch (e) {
    console.error("❌ /api/learning/prepare error:", e);
    return NextResponse.json({ ok: false, error: "서버 오류" }, { status: 500 });
  }
}
