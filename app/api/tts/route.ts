// app/api/tts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY!;
const ELEVEN_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL";

export async function POST(req: NextRequest) {
  try {
    const { text, sessionId } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "text is required" },
        { status: 400 }
      );
    }

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    if (!ELEVEN_API_KEY) {
      return NextResponse.json(
        { error: "ELEVENLABS_API_KEY is not set" },
        { status: 500 }
      );
    }

    // 1️⃣ ElevenLabs에 TTS 요청
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
          // 필요하면 여기 voice_settings 넣으면 됨
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

    // 2️⃣ Supabase Storage에 업로드 (캐싱은 나중에 다시)
    const fileName = `${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}.mp3`;
    const filePath = `${sessionId}/${fileName}`;

    const { data: uploadData, error: uploadError } = await supabaseServer.storage
      .from("tts-audio")
      .upload(filePath, audioBuffer, {
        contentType: "audio/mpeg",
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload TTS to storage" },
        { status: 500 }
      );
    }

    // 3️⃣ public URL 생성 (버킷이 public이라는 가정)
    const {
      data: { publicUrl },
    } = supabaseServer.storage.from("tts-audio").getPublicUrl(filePath);

    if (!publicUrl) {
      return NextResponse.json(
        { error: "Failed to get public URL" },
        { status: 500 }
      );
    }

    // 프론트에서는 data.url 사용
    return NextResponse.json({ url: publicUrl });
  } catch (e: any) {
    console.error("TTS route error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
