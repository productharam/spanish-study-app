// app/api/tts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY!;
const ELEVEN_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL";

export async function POST(req: NextRequest) {
  try {
    // ✅ 0) 로그인 + TTS 권한 체크 (서버에서 최종 차단)
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (!token) {
      return NextResponse.json(
        { ok: false, code: "UNAUTHORIZED", error: "Missing access token" },
        { status: 401 }
      );
    }

    const { data: userData, error: userErr } =
      await supabaseServer.auth.getUser(token);

    if (userErr || !userData.user) {
      return NextResponse.json(
        { ok: false, code: "UNAUTHORIZED", error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = userData.user;

    const { data: profile, error: profileErr } = await supabaseServer
      .from("profiles")
      .select("tts_enabled")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileErr) {
      console.error("Profile fetch error:", profileErr);
      return NextResponse.json(
        {
          ok: false,
          code: "PROFILE_LOAD_FAILED",
          error: "Failed to load profile",
        },
        { status: 500 }
      );
    }

    const ttsEnabled = profile?.tts_enabled ?? false;

    if (!ttsEnabled) {
      return NextResponse.json(
        { ok: false, code: "TTS_NOT_ENABLED" },
        { status: 403 }
      );
    }

    // ✅ 1) 입력 검증
    const { text, audioId } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    if (!audioId || typeof audioId !== "string") {
      return NextResponse.json(
        { error: "audioId is required" },
        { status: 400 }
      );
    }

    if (!ELEVEN_API_KEY) {
      return NextResponse.json(
        { error: "ELEVENLABS_API_KEY is not set" },
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

    // 2️⃣ 먼저 같은 파일이 이미 있는지 확인 (캐시 체크)
    try {
      const { data: existingFile, error: downloadError } =
        await supabaseServer.storage.from(bucket).download(filePath);

      if (!downloadError && existingFile) {
        const publicUrl = getPublicUrl();
        if (publicUrl) {
          return NextResponse.json({ url: publicUrl, fromCache: true });
        }
      }
    } catch (checkErr) {
      // 여기서 에러가 나더라도 그냥 새로 생성하는 쪽으로 진행
      console.warn("TTS cache check error:", checkErr);
    }

    // 3️⃣ 캐시에 없으면 ElevenLabs에 TTS 요청
    const elevenRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`,
      {
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
      }
    );

    if (!elevenRes.ok) {
      const errText = await elevenRes.text().catch(() => "");
      console.error("ElevenLabs error:", elevenRes.status, errText);
      return NextResponse.json(
        { error: "Failed to generate TTS" },
        { status: 500 }
      );
    }

    const audioBuffer = Buffer.from(await elevenRes.arrayBuffer());

    // 4️⃣ Supabase Storage에 업로드
    const { error: uploadError } = await supabaseServer.storage
      .from(bucket)
      .upload(filePath, audioBuffer, {
        contentType: "audio/mpeg",
        upsert: false, // 이미 있으면 덮어쓰지 않음
      });

    // ✅ 업로드 충돌(동시 요청) 처리:
    // - 이미 누가 먼저 업로드했다면, publicUrl을 캐시로 간주하고 반환
    if (uploadError) {
      const msg =
        // supabase-js error shape가 바뀔 수 있어 문자열 기반으로 안전 처리
        (uploadError as any)?.message?.toString?.() ?? String(uploadError);

      // 흔한 케이스: "The resource already exists" / "Already Exists" / 409 등
      const looksLikeConflict =
        msg.toLowerCase().includes("already exists") ||
        msg.toLowerCase().includes("already") ||
        msg.includes("409");

      if (looksLikeConflict) {
        const publicUrl = getPublicUrl();
        if (publicUrl) {
          return NextResponse.json({ url: publicUrl, fromCache: true });
        }
        // publicUrl이 없으면 아래에서 일반 에러로 처리
      }

      console.error("Supabase upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload TTS to storage" },
        { status: 500 }
      );
    }

    // 5️⃣ public URL 생성
    const publicUrl = getPublicUrl();

    if (!publicUrl) {
      return NextResponse.json(
        { error: "Failed to get public URL" },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: publicUrl, fromCache: false });
  } catch (e: any) {
    console.error("TTS route error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
