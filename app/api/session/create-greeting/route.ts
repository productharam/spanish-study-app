import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { greeting } = body;

    if (!greeting) {
      return NextResponse.json(
        { error: "greeting is required" },
        { status: 400 }
      );
    }

    const userId = process.env.DEV_USER_ID!;
    const title = greeting.substring(0, 20) + "...";

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

    // 2️⃣ 첫 assistant 메시지(인사) 저장
    const { error: msgError } = await supabaseServer
      .from("chat_messages")
      .insert({
        session_id: sessionData.id,
        user_id: userId,
        role: "assistant",
        content: greeting,
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
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
