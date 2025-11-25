// app/api/session/latest/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

export async function GET(req: Request) {
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

    const userId = user.id;


    // 1️⃣ 가장 최근 세션 하나 가져오기
    const { data: session, error: sessionError } = await supabaseServer
      .from("chat_sessions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // 세션이 하나도 없는 경우 (첫 방문)
    if (sessionError && sessionError.code === "PGRST116") {
      // PGRST116 = no rows found
      return NextResponse.json({
        ok: true,
        session: null,
        messages: [],
      });
    }

    if (sessionError || !session) {
      return NextResponse.json(
        {
          ok: false,
          error: sessionError?.message || "Failed to load latest session",
        },
        { status: 500 }
      );
    }

    // 2️⃣ 해당 세션의 메시지 전부 가져오기 (오래된 순으로)
    const { data: messages, error: messagesError } = await supabaseServer
      .from("chat_messages")
      .select("*")
      .eq("session_id", session.id)
      .order("created_at", { ascending: true });

    if (messagesError || !messages) {
      return NextResponse.json(
        {
          ok: false,
          error: messagesError?.message || "Failed to load messages",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      session: {
        id: session.id,
        title: session.title,
        created_at: session.created_at,
        updated_at: session.updated_at,
      },
      messages,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
