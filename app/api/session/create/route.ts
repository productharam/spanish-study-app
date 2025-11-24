import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { firstMessage } = body;

    if (!firstMessage) {
      return NextResponse.json(
        { error: "firstMessage is required" },
        { status: 400 }
      );
    }

    // dev user_id (로그인 기능 붙이기 전 임시 사용자)
    const userId = process.env.DEV_USER_ID!;

    // title = 첫 메시지 앞 20자
    const title = firstMessage.substring(0, 20) + "...";

    // 1️⃣ 세션 생성
    const { data: sessionData, error: sessionError } = await supabaseServer
      .from("chat_sessions")
      .insert({
        user_id: userId,
        title,
      })
      .select()
      .single();

    if (sessionError || !sessionData) {
      return NextResponse.json(
        { error: sessionError?.message || "Failed to create session" },
        { status: 500 }
      );
    }

    // 2️⃣ 첫 메시지 저장
    const { error: msgError } = await supabaseServer
      .from("chat_messages")
      .insert({
        session_id: sessionData.id,
        user_id: userId,
        role: "user",
        content: firstMessage,
      });

    if (msgError) {
      return NextResponse.json(
        { error: msgError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      sessionId: sessionData.id,
      title,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
