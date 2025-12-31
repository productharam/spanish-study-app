// app/api/learning/prepare/route.ts
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

// ✅ 문자열 정규화: 캐시 키 안정화
function normalizeSentence(s: string) {
  return s
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
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
  // ✅ 안전: 너무 길면 잘라서 품질/비용/안정성 확보 (원하면 숫자 조절)
  const cleaned = String(sentence ?? "").trim().slice(0, 600);

  // ✅ 영어 프롬프트로 안정화 (JSON only 강제)
  const prompt = `
Convert the following ${languageName(targetLanguageCode)} sentence into a Korean prompt for speaking practice.

Requirements:
- Translate into NATURAL Korean that a real person would say.
- Keep it short and easy to speak aloud.
- Do NOT add explanations.
- Output ONLY valid JSON with exactly this shape:

{
  "korean": "자연스러운 한국어 번역"
}

Original sentence:
"""${cleaned}"""
`.trim();

  const res = await client.chat.completions.create({
    model: "gpt-5.1",
    messages: [
      {
        role: "system",
        content:
          "You convert a single foreign-language sentence into natural Korean for speaking practice. " +
          "Return ONLY a valid JSON object with the key 'korean'. No extra text.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw = res.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(raw);

  return {
    korean: typeof parsed.korean === "string" ? parsed.korean.trim() : cleaned,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { text, sessionId } = (await req.json().catch(() => ({}))) as {
      text?: string;
      sessionId?: string | null;
    };

    if (!text || typeof text !== "string") {
      return NextResponse.json({ ok: false, error: "text 필드가 필요합니다." }, { status: 400 });
    }

    const baseSentence = normalizeSentence(text);
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
    if (userId && sessionId) {
      const { data: existing, error } = await supabaseServer
        .from("learning_cards")
        .select("id, korean_prompt")
        .eq("user_id", userId)
        .eq("session_id", sessionId)
        .eq("corrected_spanish", baseSentence)
        .maybeSingle();

      if (error) {
        console.error("learning_cards existingCard error:", error.message);
      } else if (existing) {
        return NextResponse.json({
          ok: true,
          cardId: existing.id,
          korean: existing.korean_prompt,
          fromCache: true,
        });
      }
    }

    // ✅ 2) GPT 생성
    const { korean } = await generateKoreanPrompt(language, baseSentence);

    // ✅ 3) 저장 (로그인 유저만) - upsert로 멱등 처리
    if (userId && sessionId) {
      const payload = {
        user_id: userId,
        session_id: sessionId,
        corrected_spanish: baseSentence,
        korean_prompt: korean,
      };

      const { data: upserted, error: upsertErr } = await supabaseServer
        .from("learning_cards")
        .upsert(payload, {
          onConflict: "user_id,session_id,corrected_spanish",
        })
        .select("id")
        .single();

      if (upsertErr || !upserted) {
        console.error("learning_cards upsert error:", upsertErr);
        return NextResponse.json({
          ok: true,
          cardId: null,
          korean,
          warning: "카드를 저장하지 못했어요.",
        });
      }

      return NextResponse.json({ ok: true, cardId: upserted.id, korean, fromCache: false });
    }

    // 게스트: 저장 없이 결과만
    return NextResponse.json({ ok: true, cardId: null, korean, fromCache: false });
  } catch (e) {
    console.error("❌ /api/learning/prepare error:", e);
    return NextResponse.json({ ok: false, error: "서버 오류" }, { status: 500 });
  }
}
