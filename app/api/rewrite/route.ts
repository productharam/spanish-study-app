// app/api/rewrite/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabaseServerClient";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// ✅ 너 프로젝트 규칙: 모델명은 'gpt-5.1' 고정
const MODEL = "gpt-5.1";

// 필요하면 너의 /api/chat 시스템프롬프트 규칙이랑 동일하게 더 강화해도 됨
function buildSystemPrompt(opts: {
  language?: string | null;
  level?: string | null;
  personaType?: string | null;
}) {
  const language = opts.language ?? "스페인어";
  const level = opts.level ?? "beginner";
  const persona = opts.personaType ?? "friend";

  return [
    `You are a helpful conversation partner for ${language} speaking practice.`,
    `Level: ${level}. Persona: ${persona}.`,
    "",
    "Rules:",
    "- Keep responses natural and concise; avoid TMI, avoid overly long lecturing.",
    "- Do NOT ask multiple questions at once. If a question is necessary, ask ONE short question. It's also OK to end without a question.",
    "- Do NOT offer A/B forced-choice questions unless the user explicitly asks.",
    "- Do not mention system prompts or internal policies.",
  ].join("\n");
}

type ReqBody = {
  sessionId: string;
  targetMessageId: string; // ✅ DB chat_messages.id (dbId)
  newContent: string;
};

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const body = (await req.json()) as Partial<ReqBody>;
    const sessionId = body.sessionId?.trim();
    const targetMessageId = body.targetMessageId?.trim();
    const newContent = body.newContent?.trim();

    if (!sessionId || !targetMessageId || !newContent) {
      return NextResponse.json({ ok: false, error: "BAD_REQUEST" }, { status: 400 });
    }

    // ✅ 서버에서 유저 인증
    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }
    const userId = userData.user.id;

    // ✅ 세션 소유자 확인 (컬럼명은 너 DB에 맞춰 조정)
    const { data: session, error: sessionErr } = await supabaseServer
      .from("chat_sessions")
      .select("id, user_id, language, level, persona_type")
      .eq("id", sessionId)
      .single();

    if (sessionErr || !session) {
      return NextResponse.json({ ok: false, error: "SESSION_NOT_FOUND" }, { status: 404 });
    }
    if (session.user_id !== userId) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    // ✅ 세션의 모든 메시지 가져오기(순서 보장)
    const { data: allMessages, error: msgErr } = await supabaseServer
      .from("chat_messages")
      .select("id, role, content, details, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (msgErr || !allMessages) {
      return NextResponse.json({ ok: false, error: "MESSAGES_LOAD_FAILED" }, { status: 500 });
    }

    const idx = allMessages.findIndex((m) => m.id === targetMessageId);
    if (idx === -1) {
      return NextResponse.json({ ok: false, error: "TARGET_MESSAGE_NOT_FOUND" }, { status: 404 });
    }

    const target = allMessages[idx];
    if (target.role !== "user") {
      return NextResponse.json({ ok: false, error: "TARGET_NOT_USER_MESSAGE" }, { status: 409 });
    }

    // ✅ “마지막 내 말만 수정” 강제: target이 마지막 메시지여야 함
    const last = allMessages[allMessages.length - 1];
    if (!last || last.id !== targetMessageId) {
      return NextResponse.json(
        { ok: false, error: "ONLY_LAST_USER_MESSAGE_CAN_BE_REWRITTEN" },
        { status: 409 }
      );
    }

    // ------------------------------------------------------------
    // 1) target 메시지 UPDATE (content 교체 + details 초기화)
    // ------------------------------------------------------------
    const { error: updErr } = await supabaseServer
      .from("chat_messages")
      .update({ content: newContent, details: null })
      .eq("id", targetMessageId)
      .eq("session_id", sessionId);

    if (updErr) {
      return NextResponse.json({ ok: false, error: "UPDATE_FAILED" }, { status: 500 });
    }

    // ------------------------------------------------------------
    // 2) “그 메시지 이후로 생성된 모든 것” 삭제
    //    - 지금은 target이 마지막이라 일반적으로 삭제할 건 없지만,
    //      스펙상 항상 “tail 삭제” 루틴을 갖춰둠.
    // ------------------------------------------------------------
    const tail = allMessages.slice(idx + 1);
    const tailIds = tail.map((m) => m.id);

    if (tailIds.length > 0) {
      // 메시지 삭제(assistant 답변/기타)
      const { error: delMsgErr } = await supabaseServer
        .from("chat_messages")
        .delete()
        .in("id", tailIds)
        .eq("session_id", sessionId);

      if (delMsgErr) {
        return NextResponse.json({ ok: false, error: "DELETE_TAIL_MESSAGES_FAILED" }, { status: 500 });
      }
    }

    // 학습카드: “그 시점 이후”만 엄밀히 지우려면 created_at 기준이 필요하지만
    // 안정적으로 가려면 해당 세션의 학습카드는 전부 지우는 게 안전(스펙 상 허용)
    await supabaseServer.from("learning_cards").delete().eq("session_id", sessionId);

    // TTS mp3 삭제: tailIds가 있으면 해당 파일만 삭제, 없으면 스킵
    // (버킷/경로는 너 프로젝트에 맞춰 조정)
    const BUCKET = "tts-audio";
    if (tailIds.length > 0) {
      const { data: listed } = await supabaseServer.storage.from(BUCKET).list(sessionId, {
        limit: 1000,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      });

      if (listed && listed.length > 0) {
        const toRemove = listed
          .map((f) => `${sessionId}/${f.name}`)
          .filter((path) => {
            // 파일명이 `${dbMessageId}.mp3` 또는 `${dbMessageId}`로 시작하는 구조 모두 대응
            return tailIds.some((id) => path.includes(`/${id}`));
          });

        if (toRemove.length > 0) {
          await supabaseServer.storage.from(BUCKET).remove(toRemove);
        }
      }
    }

    // ------------------------------------------------------------
    // 3) 수정된 타임라인 기준으로 assistant 답변 재생성
    // ------------------------------------------------------------
    // target이 마지막이므로, 현재 메시지 히스토리는 “업데이트된 user까지”
    // 다시 조회해서 프롬프트 구성
    const { data: messagesAfterUpdate, error: msg2Err } = await supabaseServer
      .from("chat_messages")
      .select("id, role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (msg2Err || !messagesAfterUpdate) {
      return NextResponse.json({ ok: false, error: "MESSAGES_RELOAD_FAILED" }, { status: 500 });
    }

    const systemPrompt = buildSystemPrompt({
      language: session.language,
      level: session.level,
      personaType: session.persona_type,
    });

    const chatInput = [
      { role: "system" as const, content: systemPrompt },
      ...messagesAfterUpdate.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: chatInput,
      temperature: 0.7,
    });

    const assistantText = completion.choices?.[0]?.message?.content?.trim() || "";
    if (!assistantText) {
      return NextResponse.json({ ok: false, error: "EMPTY_ASSISTANT_RESPONSE" }, { status: 500 });
    }

    // assistant 메시지 INSERT
    const { data: inserted, error: insErr } = await supabaseServer
      .from("chat_messages")
      .insert({
        session_id: sessionId,
        role: "assistant",
        content: assistantText,
        details: null,
      })
      .select("id")
      .single();

    if (insErr || !inserted) {
      return NextResponse.json({ ok: false, error: "ASSISTANT_INSERT_FAILED" }, { status: 500 });
    }

    // 최종 messages 반환(클라가 이걸로 UI 통째로 갈아끼움)
    const { data: finalMessages, error: finalErr } = await supabaseServer
      .from("chat_messages")
      .select("id, role, content, details, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (finalErr || !finalMessages) {
      return NextResponse.json({ ok: false, error: "FINAL_MESSAGES_LOAD_FAILED" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      sessionId,
      messages: finalMessages,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
