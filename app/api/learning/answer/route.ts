// app/api/learning/answer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// ✅ Juan 페르소나로 피드백 생성
async function generateFeedback(correctSentence: string, userAnswer: string) {
  const systemPrompt = `
Eres "Juan", un amigo español (España, castellano) que ayuda a Han, un estudiante coreano, a practicar conversación en nivel principiante (A1~A2).

- Nunca usas "usted", solo "tú".
- Hablas en español sencillo.
- Tu objetivo aquí es comparar la frase correcta con la frase del estudiante.
- Responde SOLO en JSON, sin explicaciones adicionales.

Devuelve EXACTAMENTE este JSON:

{
  "correct_answer": "정답으로 쓸 스페인어 문장",
  "tip": "한국어로 네이티브 TIP 한두 문장",
  "is_correct": true 또는 false
}
`;

  const userPrompt = `
[정답 스페인어 문장]
${correctSentence}

[학생 답안]
${userAnswer}
`;

  const res = await client.chat.completions.create({
    model: "gpt-5.1", // ✅ 통일
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw = res.choices[0].message.content ?? "{}";

  let parsed: any = {};
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("JSON parse error in generateFeedback:", raw);
    // 최소한 형태는 맞추자 (완전 망가지면 is_correct=false로 처리)
    return {
      correct_answer: correctSentence,
      tip: "피드백 생성 중 오류가 발생했어요. 정답 예문만 참고해 주세요.",
      is_correct: false,
    };
  }

  return {
    correct_answer: parsed.correct_answer as string,
    tip: parsed.tip as string,
    is_correct: Boolean(parsed.is_correct),
  };
}

export async function POST(req: NextRequest) {
  try {
    const { cardId, userAnswer } = await req.json();

    if (!cardId || !userAnswer) {
      return NextResponse.json(
        { error: "cardId, userAnswer가 필요합니다." },
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

    const userId = user.id as string;

    // 1️⃣ learning_cards에서 정답 문장 가져오기 (본인 카드만)
    const { data: card, error: cardError } = await supabaseServer
      .from("learning_cards")
      .select("id, user_id, corrected_spanish")
      .eq("id", cardId)
      .maybeSingle();

    if (cardError || !card) {
      console.error("learning_cards not found:", cardError);
      return NextResponse.json(
        { error: "학습 카드를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (card.user_id !== userId) {
      // 혹시 모를 다른 사람 카드 접근 차단
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 2️⃣ GPT로 피드백 생성
    const feedback = await generateFeedback(
      card.corrected_spanish as string,
      String(userAnswer)
    );

    // 3️⃣ DB에 attempt 저장 (비동기 에러는 로깅만 하고, 사용자 응답은 계속)
    const { error: attemptError } = await supabaseServer
      .from("learning_attempts")
      .insert({
        learning_card_id: cardId,
        user_answer_spanish: userAnswer,
        feedback, // jsonb 컬럼
      });

    if (attemptError) {
      console.error("learning_attempts insert error:", attemptError);
    }

    // 4️⃣ 모달에 바로 쓸 피드백 반환
    return NextResponse.json(feedback);
  } catch (e) {
    console.error("learning/answer 서버 오류:", e);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
