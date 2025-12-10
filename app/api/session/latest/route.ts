// app/api/session/latest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

export async function GET(req: NextRequest) {
  try {
    // 1) Authorization 헤더에서 access token 꺼내기
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

    // 2) 해당 토큰의 유저 조회
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

    // 3) 가장 최근 세션 1개
    const { data: sessions, error: sessionError } = await supabaseServer
      .from("chat_sessions")
      .select("id, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (sessionError) {
      console.error("latest session error:", sessionError);
      return NextResponse.json(
        { ok: false, error: "Failed to load latest session" },
        { status: 500 }
      );
    }

    const latestSession = sessions && sessions.length > 0 ? sessions[0] : null;

    // 4) 세션이 아예 없는 경우 → ok: true지만 session은 null, messages는 빈 배열
    if (!latestSession) {
      return NextResponse.json({
        ok: true,
        session: null,
        messages: [],
      });
    }

    // 5) 해당 세션의 메시지들 불러오기
    const { data: messages, error: msgError } = await supabaseServer
      .from("chat_messages")
      .select("id, role, content, details")
      .eq("session_id", latestSession.id)
      .order("created_at", { ascending: true });

    if (msgError) {
      console.error("latest session messages error:", msgError);
      return NextResponse.json(
        { ok: false, error: "Failed to load messages" },
        { status: 500 }
      );
    }

    // 6) 프론트에서 기대하는 형태로 응답
    return NextResponse.json({
      ok: true,
      session: latestSession,
      messages: messages ?? [],
    });
  } catch (e) {
    console.error("latest session unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: "Unexpected error" },
      { status: 500 }
    );
  }
}
