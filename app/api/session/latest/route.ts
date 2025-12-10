// app/api/session/latest/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

export async function GET() {
  try {
    const {
      data: { user },
      error: authError,
    } = await supabaseServer.auth.getUser();

    // 로그인 안 된 상태면: "이전 대화 없음"으로 취급
    if (authError || !user) {
      return NextResponse.json({
        hasHistory: false,
        sessionId: null,
      });
    }

    // 가장 최근 세션 1개 가져오기
    const { data: sessions, error } = await supabaseServer
      .from("chat_sessions")
      .select("id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("latest session error:", error);
      return NextResponse.json(
        { error: "Failed to load latest session" },
        { status: 500 }
      );
    }

    const latestSession = sessions && sessions.length > 0 ? sessions[0] : null;

    if (!latestSession) {
      return NextResponse.json({
        hasHistory: false,
        sessionId: null,
      });
    }

    return NextResponse.json({
      hasHistory: true,
      sessionId: latestSession.id,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Unexpected error" },
      { status: 500 }
    );
  }
}
