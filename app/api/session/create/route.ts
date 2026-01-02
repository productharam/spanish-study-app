// app/api/session/create/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { firstMessage, language, level, personaType } = body;

    if (!firstMessage || typeof firstMessage !== "string") {
      return NextResponse.json({ ok: false, error: "firstMessage is required" }, { status: 400 });
    }

    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing access token" }, { status: 401 });
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseServer.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const userId = user.id;

    const lang = language ?? "es";
    const lvl = level ?? "beginner";
    const persona = personaType ?? "friend";

    const title = firstMessage.trim().slice(0, 20) + (firstMessage.trim().length > 20 ? "..." : "");

    // 1) 세션 생성
    const { data: sessionData, error: sessionError } = await supabaseServer
      .from("chat_sessions")
      .insert({
        user_id: userId,
        title,
        language_code: lang,
        level_code: lvl,
        persona_code: persona,
      })
      .select()
      .single();

    if (sessionError || !sessionData) {
      return NextResponse.json(
        { ok: false, error: sessionError?.message || "Failed to create session" },
        { status: 500 }
      );
    }

    // 2) 첫 user 메시지 저장
    const { error: msgError } = await supabaseServer.from("chat_messages").insert({
      session_id: sessionData.id,
      user_id: userId,
      role: "user",
      content: firstMessage.trim(),
      details: null,
    });

    if (msgError) {
      return NextResponse.json({ ok: false, error: msgError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, sessionId: sessionData.id }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
