// app/api/tts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY!;
const ELEVEN_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL";

type Plan = "standard" | "basic" | "pro";
const normalizePlan = (v: any): Plan => (v === "basic" || v === "pro" ? v : "standard");

export async function POST(req: NextRequest) {
  try {
    // ✅ 0) 로그인 체크
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : null;

    if (!token) {
      return NextResponse.json(
        { ok: false, code: "UNAUTHORIZED", error: "Missing access token" },
        { status: 401 }
      );
    }

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser(token);

    if (userErr || !userData.user) {
      return NextResponse.json(
        { ok: false, code: "UNAUTHORIZED", error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = userData.user;

    // ✅ 0.5) plan 로드 (tts_enabled 제거: 기본 true로 간주)
    // - profile 에러가 나도 TTS 자체를 막지 않음(standard로 진행)
    let plan: Plan = "standard";
    try {
      const { data: profile, error: profileErr } = await supabaseServer
        .from("profiles")
        .select("plan")
        .eq("user_id", user.id)
        .maybeSingle();

      if (profileErr) {
        console.warn("[/api/tts] profile plan load failed -> fallback standard", profileErr);
      } else {
        plan = normalizePlan(profile?.plan);
      }
    } catch (e) {
      console.warn("[/api/tts] profile plan load exception -> fallback standard", e);
    }

    // ✅ 1) 입력 검증
    const body = await req.json().catch(() => null);
    const text = body?.text;
    const audioId = body?.audioId;

    if (!text || typeof text !== "string") {
      return NextResponse.json({ ok: false, code: "BAD_REQUEST", error: "text is required" }, { status: 400 });
    }

    if (!audioId || typeof audioId !== "string") {
      return NextResponse.json({ ok: false, code: "BAD_REQUEST", error: "audioId is required" }, { status: 400 });
    }

    if (!ELEVEN_API_KEY) {
      return NextResponse.json(
        { ok: false, code: "CONFIG_ERROR", error: "ELEVENLABS_API_KEY is not set" },
        { status: 500 }
      );
    }

    const bucket = "tts-audio";
    const filePath = `${audioId}.mp3`; // ✅ 말풍선/모달 공통 키로 고정

    // ✅ 헬퍼: public URL 반환
    const getPublicUrl = () => {
      const {
        data: { publicUrl },
      } = supabaseServer.storage.from(bucket).getPublicUrl(filePath);
      return publicUrl ?? null;
    };

    // ✅ 2) 캐시 존재 확인(list)
    const lastSlash = filePath.lastIndexOf("/");
    const dir = lastSlash >= 0 ? filePath.slice(0, lastSlash) : "";
    const filename = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;

    try {
      const { data: items, error: listErr } = await supabaseServer.storage
        .from(bucket)
        .list(dir, { limit: 1, search: filename });

      if (!listErr && items && items.some((it) => it.name === filename)) {
        const publicUrl = getPublicUrl();
        if (publicUrl) {
          return NextResponse.json({ ok: true, url: publicUrl, fromCache: true, plan });
        }
      }
    } catch (checkErr) {
      // 캐시 체크 에러는 그냥 무시하고 생성 진행
      console.warn("[/api/tts] cache list check error:", checkErr);
    }

    // ✅ 3) 사용량 차감 (캐시 미스 후)
    // - 여기서 plan별 제한을 DB에서 처리하는 구조(현재 구현 유지)
    // - plan을 DB에서 쓰고 싶으면, rpc에 plan을 파라미터로 넘기도록 함수 확장 가능
    const { data: canUseTTS, error: usageErr } = await supabaseServer.rpc("consume_usage_quota", {
      p_user_id: user.id,
      p_usage_type: "tts",
      // (선택) DB 함수 확장 시: p_plan: plan
    });

    if (usageErr) {
      console.error("consume_usage_quota(tts) error:", usageErr);
      return NextResponse.json({ ok: false, code: "USAGE_CHECK_FAILED" }, { status: 500 });
    }

    if (!canUseTTS) {
      return NextResponse.json({ ok: false, code: "TTS_LIMIT_EXCEEDED", plan }, { status: 403 });
    }

    // ✅ 4) ElevenLabs TTS 생성
    const elevenRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVEN_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        output_format: "mp3_22050",
      }),
    });

    if (!elevenRes.ok) {
      const errText = await elevenRes.text().catch(() => "");
      console.error("ElevenLabs error:", elevenRes.status, errText);
      return NextResponse.json({ ok: false, code: "ELEVENLABS_FAILED", error: "Failed to generate TTS" }, { status: 500 });
    }

    const audioBuffer = Buffer.from(await elevenRes.arrayBuffer());

    // ✅ 5) Storage 업로드
    const { error: uploadError } = await supabaseServer.storage.from(bucket).upload(filePath, audioBuffer, {
      contentType: "audio/mpeg",
      upsert: false,
    });

    // ✅ 업로드 충돌 처리
    if (uploadError) {
      const msg = (uploadError as any)?.message?.toString?.() ?? String(uploadError);
      const looksLikeConflict =
        msg.toLowerCase().includes("already exists") ||
        msg.toLowerCase().includes("already") ||
        msg.includes("409");

      if (looksLikeConflict) {
        const publicUrl = getPublicUrl();
        if (publicUrl) {
          return NextResponse.json({ ok: true, url: publicUrl, fromCache: true, plan });
        }
      }

      console.error("Supabase upload error:", uploadError);
      return NextResponse.json({ ok: false, code: "UPLOAD_FAILED", error: "Failed to upload TTS to storage" }, { status: 500 });
    }

    // ✅ 6) public URL 생성
    const publicUrl = getPublicUrl();
    if (!publicUrl) {
      return NextResponse.json({ ok: false, code: "PUBLIC_URL_FAILED", error: "Failed to get public URL" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, url: publicUrl, fromCache: false, plan });
  } catch (e: any) {
    console.error("TTS route error:", e);
    return NextResponse.json({ ok: false, code: "TTS_ROUTE_ERROR", error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
