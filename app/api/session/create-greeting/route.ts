// app/api/session/create-greeting/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { greeting, language, level, personaType } = body;

    if (!greeting) {
      return NextResponse.json(
        { error: "greeting is required" },
        { status: 400 }
      );
    }

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : undefined;

    if (!token) {
      return NextResponse.json(
        { error: "Missing access token" },
        { status: 401 }
      );
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseServer.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user.id;
    const title = greeting.substring(0, 20) + "...";

    const lang = language ?? "es";
    const lvl = level ?? "beginner";
    const persona = personaType ?? "friend";

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
        { error: sessionError?.message || "Failed to create session" },
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
      return NextResponse.json({ error: msgError.message }, { status: 500 });
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
