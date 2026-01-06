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

// ✅ 문자열 정규화(표시/채점 품질용). 이제 "키"는 messageId라서
// 이건 중복 방지 목적보다는 품질/안정성 목적.
function normalizeSentence(s: string) {
  return String(s ?? "")
    .normalize("NFC")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
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
  const cleaned = String(sentence ?? "").trim().slice(0, 600);

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
    const { text, sessionId, messageId } = (await req.json().catch(() => ({}))) as {
      text?: string;
      sessionId?: string | null;
      messageId?: string | null; // ✅ DB chat_messages.id
    };

    if (!text || typeof text !== "string") {
      return NextResponse.json({ ok: false, error: "text 필드가 필요합니다." }, { status: 400 });
    }

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json({ ok: false, error: "sessionId 필드가 필요합니다." }, { status: 400 });
    }

    if (!messageId || typeof messageId !== "string") {
      return NextResponse.json({ ok: false, error: "messageId(DB id) 필드가 필요합니다." }, { status: 400 });
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

    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // ✅ 세션 설정(언어) 가져오기 (없으면 기본 es)
    const cfg = await getSessionConfig(sessionId);
    const language = cfg?.language ?? "es";

    // ✅ 0) (선택이지만 추천) messageId가 진짜 이 유저/세션의 메시지인지 검증
    //    - 잘못된 messageId로 다른 카드 덮어쓰는 사고 방지
    const { data: msgRow, error: msgErr } = await supabaseServer
      .from("chat_messages")
      .select("id, session_id")
      .eq("id", messageId)
      .maybeSingle();

    if (msgErr) {
      console.error("chat_messages select(messageId) error:", msgErr);
      return NextResponse.json({ ok: false, error: "메시지 검증 중 오류" }, { status: 500 });
    }
    if (!msgRow || (msgRow as any).session_id !== sessionId) {
      return NextResponse.json({ ok: false, error: "유효하지 않은 messageId" }, { status: 400 });
    }

    // ✅ 1) 캐시 조회: (user_id, session_id, message_id)
    {
      const { data: existing, error } = await supabaseServer
        .from("learning_cards")
        .select("id, korean_prompt, corrected_spanish")
        .eq("user_id", userId)
        .eq("session_id", sessionId)
        .eq("message_id", messageId)
        .maybeSingle();

      if (error) {
        console.error("learning_cards existingCard error:", error.message);
      } else if (existing) {
        // 필요하면: 지금 들어온 baseSentence가 기존 corrected_spanish와 다르면 업데이트(원문↔교정문 변경 등)
        // 여기서는 캐시 반환만 하고 싶으면 그대로 리턴.
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

    // ✅ 3) 저장 - upsert(멱등): (user_id, session_id, message_id)
    const payload = {
      user_id: userId,
      session_id: sessionId,
      message_id: messageId, // ✅ 핵심
      corrected_spanish: baseSentence,
      korean_prompt: korean,
    };

    const { data: upserted, error: upsertErr } = await supabaseServer
      .from("learning_cards")
      .upsert(payload, {
        onConflict: "user_id,session_id,message_id",
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
  } catch (e) {
    console.error("❌ /api/learning/prepare error:", e);
    return NextResponse.json({ ok: false, error: "서버 오류" }, { status: 500 });
  }
}
