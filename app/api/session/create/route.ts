// app/api/session/create/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { firstMessage, language, level, personaType } = body;

    if (!firstMessage) {
      return NextResponse.json(
        { ok: false, error: "firstMessage is required" },
        { status: 400 }
      );
    }

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

    const userId = user.id;

    const lang = language ?? "es";
    const lvl = level ?? "beginner";
    const persona = personaType ?? "friend";

    const title = firstMessage.substring(0, 20) + "...";

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
        {
          ok: false,
          error: sessionError?.message || "Failed to create session",
        },
        { status: 500 }
      );
    }

    const { error: msgError } = await supabaseServer
      .from("chat_messages")
      .insert({
  user_id: userId,
  title,
  language_code: lang,
  level_code: lvl,
  persona_code: persona,
})

    if (msgError) {
      return NextResponse.json(
        { ok: false, error: msgError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      sessionId: sessionData.id,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
