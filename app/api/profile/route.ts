// app/api/profile/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

type Plan = "standard" | "basic" | "pro"; // 네 프로젝트에서 쓰는 값에 맞춰 유지

function parseBearer(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  return authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;
}

// ✅ last_active_at 갱신(실패해도 프로필 응답은 정상 반환)
async function touchLastActive(userId: string) {
  try {
    await supabaseServer
      .from("profiles")
      .update({ last_active_at: new Date().toISOString() })
      .eq("user_id", userId);
  } catch {
    // no-op
  }
}

export async function GET(req: NextRequest) {
  const supabase = supabaseServer;

  try {
    // ✅ 0) 토큰 없으면 게스트로 간주 (프론트에서 isGuest=true 처리용)
    const token = parseBearer(req);
    if (!token) {
      return NextResponse.json({
        ok: true,
        isGuest: true,
        profile: {
          plan: "standard" as Plan,
          nickname: null as string | null,
          email: null as string | null,
        },
        // ✅ 모든 플랜에서 TTS 가능: 디폴트 true
        ttsEnabled: true,
      });
    }

    // ✅ 1) 토큰으로 유저 확인
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(token);

    if (userErr || !user) {
      return NextResponse.json(
        { ok: false, code: "UNAUTHORIZED", error: "Invalid access token" },
        { status: 401 }
      );
    }

    const userId = user.id;

    // ✅ 2) profiles 조회 (tts_enabled는 조회하지 않음)
    const { data: profile, error: selErr } = await supabase
      .from("profiles")
      .select("user_id, email, plan, nickname")
      .eq("user_id", userId)
      .maybeSingle();

    if (selErr) {
      return NextResponse.json(
        {
          ok: false,
          code: "PROFILE_SELECT_FAILED",
          error: selErr.message ?? "Failed to load profile",
          detail: selErr,
        },
        { status: 500 }
      );
    }

    // ✅ 3) row가 없으면 (트리거 누락/이전 데이터 등) 최소값으로 생성
    if (!profile) {
      const nickname =
        (user.user_metadata?.name as string | undefined) ?? user.email ?? "";

      const { data: created, error: insErr } = await supabase
        .from("profiles")
        .insert({
          user_id: userId,
          email: user.email,
          plan: "standard",
          nickname,
          // ✅ 생성 시점에도 last_active_at 찍기 (컬럼 없으면 supabase가 에러낼 수 있으니 아래 touch로도 보강)
          last_active_at: new Date().toISOString(),
        })
        .select("user_id, email, plan, nickname")
        .single();

      if (insErr) {
        return NextResponse.json(
          {
            ok: false,
            code: "PROFILE_CREATE_FAILED",
            error: insErr.message ?? "Failed to create profile",
            detail: insErr,
          },
          { status: 500 }
        );
      }

      // ✅ 혹시 insert에서 last_active_at 컬럼이 누락/권한 문제면 여기서 한 번 더 찍음
      await touchLastActive(userId);

      return NextResponse.json({
        ok: true,
        isGuest: false,
        profile: {
          plan: (created.plan ?? "standard") as Plan,
          nickname: (created.nickname ?? null) as string | null,
          email: (created.email ?? null) as string | null,
        },
        ttsEnabled: true,
      });
    }

    // ✅ 4) 정상 응답 직전에 last_active_at 갱신
    await touchLastActive(userId);

    return NextResponse.json({
      ok: true,
      isGuest: false,
      profile: {
        plan: (profile.plan ?? "standard") as Plan,
        nickname: (profile.nickname ?? null) as string | null,
        email: (profile.email ?? null) as string | null,
      },
      // ✅ 모든 플랜에서 TTS 가능: 디폴트 true
      ttsEnabled: true,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        code: "PROFILE_ROUTE_FAILED",
        error: e?.message ?? "Failed to load profile",
      },
      { status: 500 }
    );
  }
}
