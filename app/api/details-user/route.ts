// app/api/details-user/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// ✅ 사용자(내) 말풍선용: 문장 교정 + 번역/문법/TIP
async function generateUserDetails(text: string) {
  const prompt = `
다음은 한국인 학습자가 쓴 스페인어 문장이야.
이 문장을 자연스러운 스페인어로 고쳐 주고,
아래 JSON 형식으로만 출력하세요.

{
  "correction": "자연스러운 스페인어로 수정한 문장 (한 줄). 너무 과하게 바꾸지 말고, 틀린 부분만 자연스럽게 고치기",
  "ko": "자연스러운 한국어 번역 (한두 문장)",
  "en": "자연스러운 영어 번역 (한두 문장)",
  "grammar": "시제/구조/중요 표현을 한국어로 아주 간단히 설명 (두세 문장)",
  "tip": "비슷한 상황에서 네이티브가 자주 쓰는 표현이나 뉘앙스를 한두 가지 설명"
}

반드시 위 JSON 형식만 출력하세요.
JSON 밖의 다른 설명, 문장, 주석은 절대 출력하지 마세요.

학습자가 쓴 문장:
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
    console.error("JSON parsing error (details-user):", err, raw);
    throw new Error("Invalid JSON returned by OpenAI");
  }

  const { correction, ko, en, grammar, tip } = json;

  // 최소한의 형태 검증
  if (
    typeof correction !== "string" ||
    typeof ko !== "string" ||
    typeof en !== "string" ||
    typeof grammar !== "string" ||
    typeof tip !== "string"
  ) {
    console.error("JSON shape mismatch (details-user):", json);
    throw new Error("JSON shape mismatch");
  }

  return {
    correction: correction.trim(),
    ko: ko.trim(),
    en: en.trim(),
    grammar: grammar.trim(),
    tip: tip.trim(),
  };
}

export async function POST(req: Request) {
  try {
    const { text } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "No text provided" },
        { status: 400 }
      );
    }

    // 너무 길면 앞부분만 보내서 토큰/속도 최적화
    const cleaned = text.slice(0, 400).trim();

    let result:
      | { correction: string; ko: string; en: string; grammar: string; tip: string }
      | null = null;
    let lastError: unknown = null;

    // ✅ 최대 2번까지 재시도
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        result = await generateUserDetails(cleaned);
        break;
      } catch (err) {
        lastError = err;
        console.error(`/api/details-user attempt ${attempt} failed:`, err);
      }
    }

    if (!result) {
      throw lastError ?? new Error("Failed to generate user details");
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("❌ /api/details-user final error:", err);
    return NextResponse.json(
      { error: "Failed to generate user details" },
      { status: 500 }
    );
  }
}
