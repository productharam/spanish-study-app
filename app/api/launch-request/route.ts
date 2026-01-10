// app/api/launch-request/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (!token) {
      return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
    }

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);
    if (userErr || !userData.user) {
      return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
    }

    const user = userData.user;
    const email = user.email ?? null;
    if (!email) {
      return NextResponse.json({ ok: false, code: "NO_EMAIL" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const consent = body?.consent === true;
    const feature = typeof body?.feature === "string" ? body.feature : "plan-upgrade";

    if (!consent) {
      return NextResponse.json({ ok: false, code: "CONSENT_REQUIRED" }, { status: 400 });
    }

    // ✅ 1) 이미 신청했는지 먼저 조회
    const { data: profile, error: selErr } = await supabaseServer
      .from("profiles")
      .select("launch_request_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (selErr) {
      console.error("launch-request select error:", selErr);
      return NextResponse.json({ ok: false, code: "DB_ERROR" }, { status: 500 });
    }

    if (profile?.launch_request_at) {
      return NextResponse.json({ ok: true, alreadyRequested: true, feature });
    }

    const now = new Date().toISOString();

    // ✅ 2) 최초 신청 저장 (조건 없이 업데이트)
    const { error: upErr } = await supabaseServer
      .from("profiles")
      .update({
        email,
        launch_request_at: now,
      })
      .eq("user_id", user.id);

    if (upErr) {
      console.error("launch-request update error:", upErr);
      return NextResponse.json({ ok: false, code: "DB_ERROR" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, alreadyRequested: false, feature });
  } catch (e) {
    console.error("launch-request error:", e);
    return NextResponse.json({ ok: false, code: "SERVER_ERROR" }, { status: 500 });
  }
}
