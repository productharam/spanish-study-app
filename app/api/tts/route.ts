// app/api/tts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";
import { getElevenConfig } from "@/lib/tts/elevenlabsConfig";

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

    // ✅ 1) 요청 파싱
    const body = await req.json().catch(() => null);

    const text = body?.text;
    const audioId = body?.audioId;
    const language = body?.language; // ✅ 추가: 언어 코드 (예: "en", "es", "en-US")

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
        .list(dir, { limit: 1000 });

      if (!listErr && items && items.some((it) => it.name === filename)) {
        const publicUrl = getPublicUrl();
        if (publicUrl) {
          return NextResponse.json({ ok: true, url: publicUrl, fromCache: true, plan });
        }
      }
    } catch (e) {
      console.warn("[/api/tts] storage list check failed; continue to generate", e);
    }

    // ✅ 3) 사용량 차감 (플랜 로직은 DB 함수에서 처리)
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

    // ✅ 4) ElevenLabs 설정(언어별) 선택
    const cfg = getElevenConfig(language);
    const voiceId = cfg.voiceId || ELEVEN_VOICE_ID;
    const modelId = cfg.modelId || "eleven_turbo_v2_5";
    const outputFormat = cfg.outputFormat || "mp3_22050";

    // ✅ 5) ElevenLabs TTS 생성
    const elevenRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVEN_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        output_format: outputFormat,
        ...(cfg.voiceSettings ? { voice_settings: cfg.voiceSettings } : {}),
      }),
    });

    if (!elevenRes.ok) {
      const errText = await elevenRes.text().catch(() => "");
      console.error("ElevenLabs error:", elevenRes.status, errText);
      return NextResponse.json(
        { ok: false, code: "ELEVENLABS_FAILED", error: "Failed to generate TTS" },
        { status: 500 }
      );
    }

    const audioBuf = Buffer.from(await elevenRes.arrayBuffer());

    // ✅ 6) 업로드 (409/이미 존재하면 캐시로 처리)
    const { error: uploadError } = await supabaseServer.storage
      .from(bucket)
      .upload(filePath, audioBuf, {
        contentType: "audio/mpeg",
        upsert: false,
      });

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
      return NextResponse.json(
        { ok: false, code: "UPLOAD_FAILED", error: "Failed to upload TTS to storage" },
        { status: 500 }
      );
    }

    // ✅ 7) public URL 생성
    const publicUrl = getPublicUrl();
    if (!publicUrl) {
      return NextResponse.json({ ok: false, code: "PUBLIC_URL_FAILED", error: "Failed to get public URL" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, url: publicUrl, fromCache: false, plan });
  } catch (e: any) {
    console.error("TTS route error:", e);
    return NextResponse.json(
      { ok: false, code: "TTS_ROUTE_ERROR", error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
