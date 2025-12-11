// app/api/session/messages/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("Authorization");
    const token =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length)
        : null;

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "NO_TOKEN", message: "인증 토큰이 필요합니다." },
        { status: 401 }
      );
    }

    const {
      data: { user },
      error: userError,
    } = await supabaseServer.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        { ok: false, error: "INVALID_USER", message: "유효한 사용자 정보를 찾을 수 없어요." },
        { status: 401 }
      );
    }

    const { sessionId } = await req.json().catch(() => ({}));

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { ok: false, error: "NO_SESSION_ID", message: "sessionId가 필요합니다." },
        { status: 400 }
      );
    }

    // 1) 세션 정보 가져오기 (내 것인지 확인)
    const { data: session, error: sessionError } = await supabaseServer
      .from("chat_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        {
          ok: false,
          error: "SESSION_NOT_FOUND",
          message: "해당 세션을 찾을 수 없거나 접근 권한이 없어요.",
        },
        { status: 404 }
      );
    }

    // 2) 세션에 속한 메시지들 가져오기
    const { data: messages, error: messagesError } = await supabaseServer
      .from("chat_messages")
      .select("id, role, content, details, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (messagesError) {
      console.error("messagesError", messagesError);
      return NextResponse.json(
        {
          ok: false,
          error: "MESSAGES_ERROR",
          message: "대화 내역을 불러오는 중 오류가 발생했어요.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        session,
        messages: messages ?? [],
      },
      { status: 200 }
    );
  } catch (e) {
    console.error("/api/session/messages unknown error", e);
    return NextResponse.json(
      {
        ok: false,
        error: "UNKNOWN",
        message: "알 수 없는 오류가 발생했어요.",
      },
      { status: 500 }
    );
  }
}
