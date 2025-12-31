// app/api/account/delete/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing token" }, { status: 401 });
    }

    // 1) 토큰으로 현재 유저 확인
    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
    }
    const userId = userData.user.id;

    // 2) Storage 삭제 (tts-audio / sessionId 폴더 단위)
    const bucket = "tts-audio";

    const { data: sessions, error: sessionErr } = await supabaseServer
      .from("chat_sessions")
      .select("id")
      .eq("user_id", userId);

    if (sessionErr) {
      return NextResponse.json({ ok: false, error: sessionErr.message }, { status: 500 });
    }

    if (sessions?.length) {
      for (const s of sessions) {
        const sessionId = s.id;

        const { data: files, error: listErr } = await supabaseServer.storage
          .from(bucket)
          .list(sessionId, { limit: 1000 });

        if (listErr) {
          // 폴더가 없거나 권한/버킷 문제일 수 있음. 탈퇴 자체를 막기보단 로그만 남기고 진행.
          console.error("storage list error:", listErr);
        } else if (files?.length) {
          const paths = files.map((f) => `${sessionId}/${f.name}`);
          const { error: rmErr } = await supabaseServer.storage.from(bucket).remove(paths);
          if (rmErr) console.error("storage remove error:", rmErr);
        }
      }
    }

    // 3) DB 삭제 (RPC)
    const { error: rpcErr } = await supabaseServer.rpc("delete_user_data", {
      p_user_id: userId,
    });
    if (rpcErr) {
      return NextResponse.json({ ok: false, error: rpcErr.message }, { status: 500 });
    }

    // 4) Auth 계정 삭제 (진짜 회원탈퇴)
    const { error: delAuthErr } = await supabaseServer.auth.admin.deleteUser(userId);
    if (delAuthErr) {
      return NextResponse.json({ ok: false, error: delAuthErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
