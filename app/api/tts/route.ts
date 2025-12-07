// app/api/tts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY!;
const ELEVEN_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL";

export async function POST(req: NextRequest) {
  try {
    const { text, audioId } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "text is required" },
        { status: 400 }
      );
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
    const filePath = `${audioId}.mp3`; // ✅ 말풍선 공통 키로 고정

    // 1️⃣ 먼저 같은 파일이 이미 있는지 확인 (캐시 체크)
    let fromCache = false;
    try {
      const { data: existingFile, error: downloadError } =
        await supabaseServer.storage.from(bucket).download(filePath);

      if (!downloadError && existingFile) {
        // ✅ 이미 존재 → 바로 public URL 리턴
        const {
          data: { publicUrl },
        } = supabaseServer.storage.from(bucket).getPublicUrl(filePath);

        if (publicUrl) {
          return NextResponse.json({ url: publicUrl, fromCache: true });
        }
      }
    } catch (checkErr) {
      // 여기서 에러가 나더라도 그냥 새로 생성하는 쪽으로 진행
      console.warn("TTS cache check error:", checkErr);
    }

    // 2️⃣ 캐시에 없으면 ElevenLabs에 TTS 요청
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

    // 3️⃣ Supabase Storage에 업로드
    const { error: uploadError } = await supabaseServer.storage
      .from(bucket)
      .upload(filePath, audioBuffer, {
        contentType: "audio/mpeg",
        upsert: false, // 이미 있으면 덮어쓰지 않음
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload TTS to storage" },
        { status: 500 }
      );
    }

    // 4️⃣ public URL 생성
    const {
      data: { publicUrl },
    } = supabaseServer.storage.from(bucket).getPublicUrl(filePath);

    if (!publicUrl) {
      return NextResponse.json(
        { error: "Failed to get public URL" },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: publicUrl, fromCache });
  } catch (e: any) {
    console.error("TTS route error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
