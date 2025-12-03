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
    model: "gpt-5.1",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw = res.choices[0].message.content ?? "{}";

  try {
    const parsed = JSON.parse(raw);
    return {
      correct_answer: parsed.correct_answer ?? correctSentence,
      tip: parsed.tip ?? "",
      is_correct: Boolean(parsed.is_correct),
    };
  } catch (e) {
    console.error("JSON parse error in generateFeedback:", raw);
    return {
      correct_answer: correctSentence,
      tip: "피드백 생성 중 오류가 발생했어요. 정답 예문만 참고해 주세요.",
      is_correct: false,
    };
  }
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

    // 🔐 Authorization 헤더에서 JWT 추출
    const authHeader = req.headers.get("authorization");
    let userId: string | null = null;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice("Bearer ".length).trim();

      const {
        data: { user },
        error: authError,
      } = await supabaseServer.auth.getUser(token);

      if (authError) {
        console.error("learning/answer auth error:", authError.message);
      }

      userId = user?.id ?? null;
      console.log("learning/answer userId:", userId);
    } else {
      console.log("learning/answer: Authorization 헤더 없음");
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 1️⃣ learning_cards에서 정답 문장 가져오기 (본인 카드만)
    const { data: card, error: cardError } = await supabaseServer
      .from("learning_cards")
      .select("id, user_id, corrected_spanish")
      .eq("id", cardId)
      .maybeSingle();

    if (cardError) {
      console.error("learning_cards select error:", cardError);
      return NextResponse.json(
        { error: "학습 카드를 조회하는 중 오류가 발생했어요." },
        { status: 500 }
      );
    }

    if (!card) {
      return NextResponse.json(
        { error: "학습 카드를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (card.user_id !== userId) {
      return NextResponse.json(
        { error: "본인의 학습 카드만 채점할 수 있습니다." },
        { status: 403 }
      );
    }

    // 2️⃣ GPT로 피드백 생성 (DB 저장 X)
    const feedback = await generateFeedback(
      card.corrected_spanish as string,
      String(userAnswer)
    );

    // 3️⃣ 모달에 바로 쓸 피드백만 반환 (attempts 테이블 저장 안 함)
    return NextResponse.json(feedback);
  } catch (e) {
    console.error("learning/answer 서버 오류:", e);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
