// app/api/tts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServerClient";

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY!;
const ELEVEN_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

export async function POST(req: NextRequest) {
  try {
    const { text, sessionId } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "text 필드가 필요합니다." },
        { status: 400 }
      );
    }

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "sessionId 필드가 필요합니다." },
        { status: 400 }
      );
    }

    if (!ELEVEN_API_KEY) {
      return NextResponse.json(
        { error: "ELEVENLABS_API_KEY가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    const voiceId = ELEVEN_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL";

    const cleaned = text.trim();

    // 1️⃣ 이 세션의 assistant 메시지 중 해당 content와 매칭되는 row 찾기
    const { data: message, error: selectError } = await supabaseServer
      .from("chat_messages")
      .select("id, tts_audio_path")
      .eq("session_id", sessionId)
      .eq("role", "assistant")
      .eq("content", cleaned)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (selectError) {
      console.error("select chat_messages for TTS error:", selectError);
    }

    // 2️⃣ 이미 mp3 경로(tts_audio_path)가 있으면 → public URL 바로 리턴
    if (message && message.tts_audio_path) {
      const { data: publicData } = supabaseServer.storage
        .from("tts-audio")
        .getPublicUrl(message.tts_audio_path);

      const publicUrl = publicData?.publicUrl;

      if (publicUrl) {
        return NextResponse.json({ url: publicUrl });
      } else {
        console.warn(
          "tts_audio_path는 있는데 public URL 생성에 실패했어요:",
          message.tts_audio_path
        );
      }
    }

    // 3️⃣ 아직 mp3가 없다면 → ElevenLabs 호출해서 새로 생성
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
          text: cleaned,
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.5,
            style: 0.3,
            use_speaker_boost: true,
          },
          // ⚠️ output_format은 voice_settings 안이 아니라, 최상위 필드
          output_format: "mp3_16000",
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

    // assistant 메시지를 아예 못 찾았다면: 여기서는 캐싱/삭제 연동이 안 되므로 에러 처리
    if (!message || !message.id) {
      console.warn("No matching assistant message found for TTS.");
      return NextResponse.json(
        { error: "해당 메시지를 찾지 못해 TTS를 저장할 수 없어요." },
        { status: 404 }
      );
    }

    const filePath = `${sessionId}/${message.id}.mp3`;

    // 4️⃣ Supabase Storage에 업로드
    const { error: uploadError } = await supabaseServer.storage
      .from("tts-audio")
      .upload(filePath, audioArrayBuffer, {
        contentType: "audio/mpeg",
      });

    if (uploadError) {
      console.error("Supabase storage upload error:", uploadError);
      return NextResponse.json(
        { error: "TTS 파일 업로드에 실패했어요." },
        { status: 500 }
      );
    }

    // 5️⃣ DB에 tts_audio_path 업데이트
    const { error: updateError } = await supabaseServer
      .from("chat_messages")
      .update({ tts_audio_path: filePath })
      .eq("id", message.id);

    if (updateError) {
      console.error("Update tts_audio_path error:", updateError);
      // 여기서 바로 실패 리턴까지 할 필요는 없음. URL은 이미 만들어졌으니까.
    }

    // 6️⃣ public URL 생성해서 프론트에 전달
    const { data: publicData } = supabaseServer.storage
      .from("tts-audio")
      .getPublicUrl(filePath);

    const publicUrl = publicData?.publicUrl;

    if (!publicUrl) {
      console.error("Failed to get public URL after upload");
      return NextResponse.json(
        { error: "TTS 파일 URL을 가져오지 못했어요." },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "서버 내부 오류" },
      { status: 500 }
    );
  }
}
