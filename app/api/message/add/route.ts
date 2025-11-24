// app/api/message/add/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { sessionId, role, content, details } = body;

    if (!sessionId || !role || !content) {
      return NextResponse.json(
        { error: "sessionId, role, content are required" },
        { status: 400 }
      );
    }

    const userId = process.env.DEV_USER_ID!;

    const { data, error } = await supabaseServer
      .from("chat_messages")
      .insert({
        session_id: sessionId,
        user_id: userId,
        role,
        content,
        details: details ?? null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: data,
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
