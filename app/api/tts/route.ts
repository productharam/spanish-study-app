// app/api/tts/route.ts
import { NextRequest, NextResponse } from "next/server";

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY!;
const ELEVEN_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "text 필드가 필요합니다." },
        { status: 400 }
      );
    }

    if (!ELEVEN_API_KEY) {
      return NextResponse.json(
        { error: "ELEVENLABS_API_KEY가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    const voiceId = ELEVEN_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL"; // 기본 예시 보이스 (원하면 env로만 쓰면 됨)

    const elevenRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVEN_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          // 스페인어 포함 다국어용 모델 (퀄리티 좋음)
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.3,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!elevenRes.ok) {
      const errorText = await elevenRes.text();
      console.error("ElevenLabs error:", errorText);
      return NextResponse.json(
        { error: "TTS 요청 실패", details: errorText },
        { status: 500 }
      );
    }

    const audioArrayBuffer = await elevenRes.arrayBuffer();

    return new NextResponse(audioArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "서버 내부 오류" },
      { status: 500 }
    );
  }
}
