// app/api/sessions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : undefined;

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing access token" },
        { status: 401 }
      );
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseServer.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 🔥 여기만 수정: language_code 등을 alias 로 가져오기
    const { data: sessions, error: sessionError } = await supabaseServer
  .from("chat_sessions")
  .select(
    `
      id,
      slot,
      title,
      created_at,
      language_code:language,
      level_code:level,
      persona_code:persona_type
    `
  )
  .eq("user_id", user.id)
  .order("created_at", { ascending: false })
  .limit(3);


    if (sessionError) {
      console.error("sessions list error:", sessionError);
      return NextResponse.json(
        { ok: false, error: "Failed to load sessions" },
        { status: 500 }
      );
    }

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({ ok: true, sessions: [] });
    }

    // 이하 그대로 (마지막 메시지 프리뷰)
    const sessionsWithMeta = [];

    for (const s of sessions) {
      try {
        const { data: lastMsgs, error: msgError } = await supabaseServer
          .from("chat_messages")
          .select("content, created_at")
          .eq("session_id", s.id)
          .order("created_at", { ascending: false })
          .limit(1);

        if (msgError) {
          console.error(
            "last message error for session:",
            s.id,
            msgError.message
          );
          sessionsWithMeta.push({
            ...s,
            hasMessages: false,
            lastMessageAt: null,
            lastMessagePreview: null,
          });
          continue;
        }

        if (lastMsgs && lastMsgs.length > 0) {
          const last = lastMsgs[0];
          sessionsWithMeta.push({
            ...s,
            hasMessages: true,
            lastMessageAt: last.created_at,
            lastMessagePreview:
              last.content.length > 50
                ? last.content.slice(0, 50) + "..."
                : last.content,
          });
        } else {
          sessionsWithMeta.push({
            ...s,
            hasMessages: false,
            lastMessageAt: null,
            lastMessagePreview: null,
          });
        }
      } catch (innerErr) {
        console.error("last message unexpected error:", innerErr);
        sessionsWithMeta.push({
          ...s,
          hasMessages: false,
          lastMessageAt: null,
          lastMessagePreview: null,
        });
      }
    }

    return NextResponse.json({ ok: true, sessions: sessionsWithMeta });
  } catch (e) {
    console.error("sessions unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: "Unexpected error" },
      { status: 500 }
    );
  }
}
