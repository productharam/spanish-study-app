// app/api/profile/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing access token" },
        { status: 401 }
      );
    }

    // ✅ 로그인 유저 확인
    const { data: userData, error: userErr } =
      await supabaseServer.auth.getUser(token);

    if (userErr || !userData.user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = userData.user;

    // ✅ profiles 조회
    const { data: profile, error: profileErr } = await supabaseServer
      .from("profiles")
      .select("user_id, nickname, plan, tts_enabled")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileErr) {
      return NextResponse.json(
        { ok: false, error: "Failed to load profile" },
        { status: 500 }
      );
    }

    // ✅ 트리거 타이밍 등으로 profile이 아직 없을 때 대비(최소 안전값)
    const nickname =
      profile?.nickname ??
      (user.user_metadata?.name as string | undefined) ??
      user.email ??
      null;

    const plan = profile?.plan ?? "default";
    const ttsEnabled = profile?.tts_enabled ?? false;

    return NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email ?? null },
      profile: { nickname, plan, tts_enabled: ttsEnabled },
      ttsEnabled,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500 }
    );
  }
}
