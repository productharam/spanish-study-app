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
    model: "gpt-5.1-nano", // 네가 chat에 쓰는 동일 모델 사용 추천
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw = res.choices[0].message.content ?? "{}";
  const parsed = JSON.parse(raw);
  return {
    correct_answer: parsed.correct_answer as string,
    tip: parsed.tip as string,
    is_correct: parsed.is_correct as boolean,
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

    const userId = user.id;

    // 1) learning_cards에서 정답 문장 가져오기
    const { data: card, error: cardError } = await supabaseServer
      .from("learning_cards")
      .select("*")
      .eq("id", cardId)
      .eq("user_id", userId)
      .single();

    if (cardError || !card) {
      console.error(cardError);
      return NextResponse.json(
        { error: "학습 카드가 없습니다." },
        { status: 404 }
      );
    }

    // 2) GPT로 피드백
    const feedback = await generateFeedback(
      (card as any).corrected_spanish,
      userAnswer
    );

    // 3) DB에 attempt 저장 (7번 중 5번에 해당)
    const { error: attemptError } = await supabaseServer
      .from("learning_attempts")
      .insert({
        learning_card_id: cardId,
        user_answer_spanish: userAnswer,
        feedback,
      });

    if (attemptError) {
      console.error(attemptError);
      // 그래도 사용자에게는 피드백은 보여주자
    }

    return NextResponse.json(feedback);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
