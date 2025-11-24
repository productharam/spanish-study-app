import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabaseServerClient"; // ✅ 추가

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// GPT-5-mini에게 문장 분석을 요청하는 함수
async function generateDetails(text: string) {
  const prompt = `
다음 스페인어 문장을 분석해서 아래 JSON 형식으로만 출력하세요.

{
  "ko": "자연스러운 한국어 번역 (한두 문장)",
  "en": "자연스러운 영어 번역 (한두 문장)",
  "grammar": "시제/구조/중요 표현을 한국어로 아주 간단히 설명 (두세 문장)",
  "tip": "비슷한 상황에서 네이티브가 자주 쓰는 표현이나 뉘앙스를 한두 가지 설명"
}

반드시 위 JSON 형식만 출력하세요.
JSON 밖의 다른 설명, 문장, 주석은 절대 출력하지 마세요.

분석할 문장:
"""${text}"""
`;

  const response = await client.chat.completions.create({
    model: "gpt-5.1",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0].message?.content;
  if (!raw) {
    throw new Error("Empty response from OpenAI");
  }

  let json: any;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.error("JSON parsing error:", err, raw);
    throw new Error("Invalid JSON returned by OpenAI");
  }

  const { ko, en, grammar, tip } = json;

  // 최소한의 형태 검증
  if (
    typeof ko !== "string" ||
    typeof en !== "string" ||
    typeof grammar !== "string" ||
    typeof tip !== "string"
  ) {
    console.error("JSON shape mismatch:", json);
    throw new Error("JSON shape mismatch");
  }

  return {
    ko: ko.trim(),
    en: en.trim(),
    grammar: grammar.trim(),
    tip: tip.trim(),
  };
}

export async function POST(req: Request) {
  try {
    const { text, sessionId } = await req.json(); // ✅ sessionId도 받기

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "No text provided" },
        { status: 400 }
      );
    }

    // 너무 길면 앞부분만 보내서 토큰/속도 최적화
    const cleaned = text.slice(0, 400).trim();

    let result: { ko: string; en: string; grammar: string; tip: string } | null = null;
    let lastError: unknown = null;

    // ✅ 최대 2번까지 재시도 (일시적인 에러 대비)
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        result = await generateDetails(cleaned);
        break;
      } catch (err) {
        lastError = err;
        console.error(`/api/details attempt ${attempt} failed:`, err);
      }
    }

    if (!result) {
      throw lastError ?? new Error("Failed to generate details");
    }

    // ✅ 여기서 Supabase에 details 저장
    if (sessionId) {
      try {
        // 1) 이 세션에서, assistant + 해당 content 텍스트인 메시지 중 가장 최근 것 찾기
        const { data: targetMessages, error: selectError } = await supabaseServer
          .from("chat_messages")
          .select("id")
          .eq("session_id", sessionId)
          .eq("role", "assistant")
          .eq("content", cleaned)
          .order("created_at", { ascending: false })
          .limit(1);

        if (selectError) {
          console.error("select message for details error:", selectError);
        } else if (targetMessages && targetMessages.length > 0) {
          const targetId = targetMessages[0].id;

          const { error: updateError } = await supabaseServer
            .from("chat_messages")
            .update({ details: result })
            .eq("id", targetId);

          if (updateError) {
            console.error("update details error:", updateError);
          }
        } else {
          console.warn("No matching assistant message found to update details.");
        }
      } catch (dbErr) {
        console.error("DB update (details) error:", dbErr);
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("❌ /api/details final error:", err);
    return NextResponse.json(
      { error: "Failed to generate details" },
      { status: 500 }
    );
  }
}
