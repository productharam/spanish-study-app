// app/api/learning/prepare/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabaseServerClient";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// ✅ 스페인어 문장을 한국어 학습용 문장 + 힌트로 바꾸는 GPT 호출
async function generateKoreanPrompt(spanishSentence: string) {
  const prompt = `
다음 스페인어 문장을 학습용으로 변환해줘.

1) 자연스럽고 간단한 한국어 문장으로 번역
2) 스페인어 문장을 떠올리기 위한 아주 짧은 힌트(한국어 한 문장)

JSON 형식으로만 출력해:

{
  "korean": "자연스러운 한국어 번역 한두 문장",
  "hint": "스페인어 문장을 떠올리는 데 도움 되는 힌트 한 문장"
}

스페인어 문장: "${spanishSentence}"
`;

  const res = await client.chat.completions.create({
    model: "gpt-5.1",
    messages: [
      {
        role: "system",
        content:
          "너는 스페인어 문장을 학습용 한국어 문장으로 바꿔주는 한국어 튜터야. 항상 JSON만 반환해.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw = res.choices[0].message.content ?? "";

  try {
    const parsed = JSON.parse(raw);
    return {
      korean: typeof parsed.korean === "string" ? parsed.korean : spanishSentence,
      hint: typeof parsed.hint === "string" ? parsed.hint : "",
    };
  } catch (e) {
    console.error("JSON parse error in generateKoreanPrompt:", raw);
    return {
      korean: spanishSentence,
      hint: "",
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const { text, sessionId, messageId } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { ok: false, error: "text 필드가 필요합니다." },
        { status: 400 }
      );
    }

    const baseSpanish = text.trim();
    if (!baseSpanish) {
      return NextResponse.json(
        { ok: false, error: "유효한 스페인어 문장이 필요합니다." },
        { status: 400 }
      );
    }

    // 🔐 Authorization 헤더에서 JWT 추출
    const authHeader = req.headers.get("authorization"); // 소문자/대문자 둘 다 가능
    let userId: string | null = null;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice("Bearer ".length).trim();

      // ✅ JWT로 사용자 조회
      const {
        data: { user },
        error: authError,
      } = await supabaseServer.auth.getUser(token);

      if (authError) {
        console.error("learning/prepare auth error:", authError.message);
      }

      userId = user?.id ?? null;
      console.log("learning/prepare userId:", userId);
    } else {
      console.log("learning/prepare: Authorization 헤더 없음");
    }

    // ✅ 1단계: userId가 있을 때만 Supabase 캐싱 시도
    if (userId) {
      try {
        let query = supabaseServer
          .from("learning_cards")
          .select("id, korean_prompt, hint")
          .eq("user_id", userId)
          .eq("corrected_spanish", baseSpanish)
          .order("created_at", { ascending: false })
          .limit(1);

        if (sessionId) query = query.eq("session_id", sessionId);
        if (messageId) query = query.eq("message_id", messageId);

        const { data: existingCard, error: existingError } =
          await query.maybeSingle();

        if (existingError) {
          console.error(
            "learning_cards existingCard error:",
            existingError.message
          );
        }

        if (existingCard) {
          // 🔁 이미 카드가 있으면 GPT 호출 없이 바로 반환
          return NextResponse.json({
            ok: true,
            cardId: existingCard.id,
            korean: existingCard.korean_prompt,
            hint: existingCard.hint,
          });
        }
      } catch (e) {
        console.error("learning_cards select 예외:", e);
      }
    }

    // ✅ 2단계: 카드가 없거나 userId가 없으면 GPT 호출
    const { korean, hint } = await generateKoreanPrompt(baseSpanish);

    // ✅ 3단계: userId가 있을 때만 새 카드 저장
    if (userId) {
      try {
        const { data: inserted, error: insertError } = await supabaseServer
          .from("learning_cards")
          .insert({
            user_id: userId,
            session_id: sessionId ?? null,
            message_id: messageId ?? null,
            corrected_spanish: baseSpanish,
            korean_prompt: korean,
            hint,
          })
          .select("id")
          .single();

        if (insertError || !inserted) {
          console.error("learning_cards insert error:", insertError);
          return NextResponse.json({
            ok: true,
            cardId: null,
            korean,
            hint,
            warning: "카드를 저장하지 못했어요.",
          });
        }

        return NextResponse.json({
          ok: true,
          cardId: inserted.id,
          korean,
          hint,
        });
      } catch (e) {
        console.error("learning_cards insert 예외:", e);
        return NextResponse.json({
          ok: true,
          cardId: null,
          korean,
          hint,
          warning: "카드를 저장하지 못했어요.",
        });
      }
    }

    // ✅ userId가 없을 때: DB 안 쓰고 GPT 결과만 반환
    return NextResponse.json({
      ok: true,
      cardId: null,
      korean,
      hint,
    });
  } catch (e) {
    console.error("learning/prepare 서버 오류:", e);
    return NextResponse.json(
      { ok: false, error: "서버 오류" },
      { status: 500 }
    );
  }
}
