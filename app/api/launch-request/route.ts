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
    const feature = typeof body?.feature === "string" ? body.feature : "tts";

    if (!consent) {
      return NextResponse.json({ ok: false, code: "CONSENT_REQUIRED" }, { status: 400 });
    }

    const { error } = await supabaseServer
      .from("launch_requests")
      .upsert(
        {
          user_id: user.id,
          email,
          feature,
          consent_email_collection: true,
        },
        { onConflict: "user_id,feature" }
      );

    if (error) {
      console.error("launch_requests upsert error:", error);
      return NextResponse.json({ ok: false, code: "DB_ERROR" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("launch-request error:", e);
    return NextResponse.json({ ok: false, code: "SERVER_ERROR" }, { status: 500 });
  }
}
