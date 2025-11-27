import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// ✅ 한 문장을 한국어 문장 + 힌트로 바꿔주는 GPT 호출
async function generateKoreanPrompt(spanishSentence: string) {
  const prompt = `
다음 스페인어 문장을 학습용으로 변환해줘.

1) 자연스럽고 간단한 한국어 문장으로 번역
2) 스페인어 문장을 떠올리기 위한 아주 짧은 힌트(한국어 한 문장)

JSON 형식으로만 출력해:

{
  "ko": "자연스러운 한국어 번역 한두 문장",
  "hint": "스페인어 문장을 떠올리는 데 도움 되는 힌트 한 문장"
}

스페인어 문장: "${spanishSentence}"
`;

  const res = await client.chat.completions.create({
    model: "gpt-5.1-mini", // 또는 네가 쓰는 nano 모델
    messages: [
      { role: "system", content: "너는 스페인어 문장을 학습용 한국어 문장으로 바꿔주는 한국어 튜터야." },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw = res.choices[0].message.content ?? "{}";
  const parsed = JSON.parse(raw);
  return {
    ko: parsed.ko as string,
    hint: parsed.hint as string,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { sessionId, messageId } = await req.json();

    if (!sessionId || !messageId) {
      return NextResponse.json(
        { error: "sessionId, messageId가 필요합니다." },
        { status: 400 }
      );
    }

    // 🔐 유저 확인
    const {
      data: { user },
      error: authError,
    } = await supabaseServer.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user.id;

    // 1) 이미 learning_cards에 있으면 재사용
    const { data: existingCards, error: cardError } = await supabaseServer
      .from("learning_cards")
      .select("*")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .eq("message_id", messageId)
      .limit(1);

    if (cardError) {
      console.error(cardError);
      return NextResponse.json(
        { error: "learning_cards 쿼리 실패" },
        { status: 500 }
      );
    }

    if (existingCards && existingCards.length > 0) {
      const card = existingCards[0];
      return NextResponse.json({
        korean: card.korean_prompt,
        hint: card.hint,
        correctedSpanish: card.corrected_spanish,
        cardId: card.id,
      });
    }

    // 2) chat_messages에서 원본 문장 + details 가져오기
    const { data: messages, error: msgError } = await supabaseServer
      .from("chat_messages")
      .select("id, role, content, details")
      .eq("id", messageId)
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (msgError || !messages) {
      console.error(msgError);
      return NextResponse.json(
        { error: "메시지를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const details = (messages as any).details as
      | {
          correction?: string;
          ko?: string;
          en?: string;
          grammar?: string;
          tip?: string;
        }
      | null;

    // ✅ 기준 스페인어 문장 선택
    let baseSpanish = "";

    // 0. 스페인어 문장 교정이 있으면 그걸 사용 (내 말풍선용)
    if (details?.correction) {
      baseSpanish = details.correction;
    } else {
      // GPT 말풍선은 content 자체를 사용
      baseSpanish = (messages as any).content;
    }

    if (!baseSpanish) {
      return NextResponse.json(
        { error: "기준이 되는 스페인어 문장이 없습니다." },
        { status: 400 }
      );
    }

    // 3) GPT로 한국어 문장 + 힌트 생성
    const { ko, hint } = await generateKoreanPrompt(baseSpanish);

    // 4) learning_cards에 저장
    const { data: inserted, error: insertError } = await supabaseServer
      .from("learning_cards")
      .insert({
        user_id: userId,
        session_id: sessionId,
        message_id: messageId,
        corrected_spanish: baseSpanish,
        korean_prompt: ko,
        hint,
      })
      .select()
      .single();

    if (insertError || !inserted) {
      console.error(insertError);
      return NextResponse.json(
        { error: "learning_cards 저장 중 오류" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      korean: inserted.korean_prompt,
      hint: inserted.hint,
      correctedSpanish: inserted.corrected_spanish,
      cardId: inserted.id,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
