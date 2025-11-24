// app/api/session/delete/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    const userId = process.env.DEV_USER_ID!;
    
    // 1️⃣ 이 세션이 진짜 이 유저의 것인지 확인
    const { data: session, error: sessionError } = await supabaseServer
      .from("chat_sessions")
      .select("id, user_id")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    if (session.user_id !== userId) {
      return NextResponse.json(
        { error: "Not allowed to delete this session" },
        { status: 403 }
      );
    }

    // 2️⃣ Storage에서 이 세션의 TTS 파일들 먼저 삭제
    try {
      const bucket = supabaseServer.storage.from("tts-audio");

      // sessionId 폴더 안의 파일 목록 조회
      const { data: files, error: listError } = await bucket.list(sessionId);

      if (listError) {
        console.error("Storage list error for session:", sessionId, listError);
      } else if (files && files.length > 0) {
        const paths = files.map((f) => `${sessionId}/${f.name}`);
        const { error: removeError } = await bucket.remove(paths);

        if (removeError) {
          console.error("Storage remove error:", removeError);
        }
      }
    } catch (storageErr) {
      console.error("Storage cleanup error:", storageErr);
      // mp3 삭제 실패했다고 해서 DB 삭제까지 막을 필요는 없으니 계속 진행
    }

    // 3️⃣ 세션 삭제 (FK ON DELETE CASCADE 덕분에 메시지도 같이 삭제)
    const { error: deleteError } = await supabaseServer
      .from("chat_sessions")
      .delete()
      .eq("id", sessionId)
      .eq("user_id", userId);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
