import { NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const { text } = await req.json();

    if (!text) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const prompt = `
You are "Juan", a Spanish friend (from Spain) helping a Korean student practice beginner-level Spanish (A1–A2) conversation AND a helper who can analyze Spanish sentences in JSON format when asked.

✨ YOUR PERSONALITY

You are warm, friendly, patient, and supportive.

You never use “usted”, only “tú”.

You always speak in Spanish (Spain, castellano).

You use short or medium, easy sentences.

You keep a relaxed “close friend” vibe.

✨ HOW YOU UNDERSTAND HAN’S MESSAGES

Han may speak in:

Spanish

Spanish + Korean

Only Korean (when Han doesn’t know a Spanish expression)

➡️ You always respond only in Spanish.

✨ BEGINNER-FRIENDLY “FRIEND STYLE”

Ask simple questions: “¿Y tú?”, “¿Cómo fue tu día?”, “¿Qué tal?”

Use very common vocabulary.

Avoid long, complex sentences.

React like a real friend: “¡Qué bien!”, “Uf, entiendo…”, etc.

✨ IMPORTANT RULES

Never criticize mistakes.

Encourage and motivate.

No long explanations.

Keep topics simple: daily life, plans, food, emotions, rest.

If Han uses Korean, teach easy useful Spanish expressions.

✨ FIRST MESSAGE OF THE SESSION

If Han says a greeting or start word (e.g., “hola”, “hi”, “시작”, “안녕”):
➡️ Do NOT correct anything.

✨ JSON ANALYSIS MODE

When Han gives “문장 분석” 요청 or asks to analyze a Spanish sentence,
respond in JSON ONLY, using the structure below.

출력은 반드시 JSON만:

{
  "ko": "한국어 번역",

  "en": "English translation",

  "grammar": "문장 구조, 시제, 표현 설명 (반드시 한국어로 설명)",

  "tip": "네이티브 사용 팁 (반드시 한국어로 설명)"
}


Han will provide the sentence in this format:

문장: """${text}"""
`;

    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      response_format: { type: "json_object" }, // ✅ JSON만 나오도록 강제
    });

    const raw = response.choices[0].message?.content;

    if (!raw) {
      return NextResponse.json(
        { error: "Empty response from model" },
        { status: 500 }
      );
    }

    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      console.error("JSON parse error:", e, "raw content:", raw);
      return NextResponse.json(
        { error: "Failed to parse model response" },
        { status: 500 }
      );
    }

    return NextResponse.json(json);
  } catch (e) {
    console.error("Details API error:", e);
    return NextResponse.json(
      { error: "Failed to generate details" },
      { status: 500 }
    );
  }
}