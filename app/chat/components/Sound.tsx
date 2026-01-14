// app/chat/components/Sound.tsx
"use client";

import { useEffect, useRef, useState } from "react";

export type SoundChatMessage = {
  id: string; // 프론트 임시 id
  dbId?: string; // DB chat_messages.id
  role: "user" | "assistant";
  content: string;
};

type UsageLimitType = "chat" | "tts" | "learning";

type UseSoundParams = {
  sessionId: string | null;
  languageCode?: string | null; // ✅ 추가
  isGuest: boolean;
  ttsEnabled: boolean;
  isProfileLoading: boolean;

  getAccessToken: () => Promise<string | null>;
  onUsageLimit?: (type: UsageLimitType) => void;
};

export function useSoundTTS({
  sessionId,
  languageCode, // ✅ 추가
  isGuest,
  ttsEnabled,
  isProfileLoading,
  getAccessToken,
  onUsageLimit,
}: UseSoundParams) {
  // ✅ 캐시: audioId -> url
  const audioCacheRef = useRef<Map<string, string>>(new Map());

  // ✅ 현재 재생 상태
  const [playingMessageKey, setPlayingMessageKey] = useState<string | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const getMessageKey = (m: SoundChatMessage) => m.dbId ?? m.id;

  const getAudioId = (m: SoundChatMessage) => {
    if (!sessionId) return null;
    const key = getMessageKey(m);
    const lang = (languageCode ?? "en").trim();
    return `${sessionId}/${lang}/${key}`; // ✅ 언어 포함 (캐시 충돌 방지)
  };

  const stopAllAudio = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    setPlayingMessageKey(null);
  };

  const clearAudioCache = () => {
    audioCacheRef.current.clear();
  };

  const handlePlayTTS = async (message: SoundChatMessage) => {
    try {
      if (!ttsEnabled) {
        alert("음성 기능을 사용할 수 없어요 🙂");
        return;
      }

      if (isProfileLoading) return;

      if (isGuest) {
        alert("로그인이 필요해요 🙂");
        return;
      }

      const audioId = getAudioId(message);
      if (!audioId) return;

      const messageKey = getMessageKey(message);

      // ✅ 이미 재생중이면 STOP
      if (playingMessageKey === messageKey) {
        stopAllAudio();
        return;
      }

      // ✅ 캐시에 있으면 바로 재생
      const cachedUrl = audioCacheRef.current.get(audioId);
      if (cachedUrl) {
        stopAllAudio();
        setPlayingMessageKey(messageKey);

        const audio = new Audio(cachedUrl);
        currentAudioRef.current = audio;

        audio.onended = () => {
          currentAudioRef.current = null;
          setPlayingMessageKey(null);
        };

        audio.onerror = () => {
          currentAudioRef.current = null;
          setPlayingMessageKey(null);
        };

        await audio.play().catch(() => {
          currentAudioRef.current = null;
          setPlayingMessageKey(null);
        });
        return;
      }

      const accessToken = await getAccessToken();
      if (!accessToken) {
        alert("로그인이 필요해요 🙂");
        return;
      }

      setPlayingMessageKey(messageKey);

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          text: message.content,
          audioId,
          language: languageCode ?? "en", // ✅ 추가
        }),
      });

      // ✅ 제한/차단 처리
      if (!res.ok) {
        const data = await res.json().catch(() => null);

        if (res.status === 403) {
          if (data?.code === "TTS_LIMIT_EXCEEDED") {
            onUsageLimit?.("tts");
            stopAllAudio();
            return;
          }
        }

        stopAllAudio();
        alert("음성 생성에 실패했어요 😢");
        return;
      }

      const data = await res.json().catch(() => null);
      const url = data?.url as string | undefined;

      if (!url) {
        stopAllAudio();
        alert("음성 URL을 가져오지 못했어요 😢");
        return;
      }

      // ✅ 캐시 저장
      audioCacheRef.current.set(audioId, url);

      // ✅ 재생
      stopAllAudio();
      setPlayingMessageKey(messageKey);

      const audio = new Audio(url);
      currentAudioRef.current = audio;

      audio.onended = () => {
        currentAudioRef.current = null;
        setPlayingMessageKey(null);
      };

      audio.onerror = () => {
        currentAudioRef.current = null;
        setPlayingMessageKey(null);
      };

      await audio.play().catch(() => {
        currentAudioRef.current = null;
        setPlayingMessageKey(null);
      });
    } catch {
      stopAllAudio();
      alert("음성 재생 중 오류가 발생했어요 😢");
    }
  };

  // ✅ 언마운트 시 정리
  useEffect(() => {
    return () => {
      stopAllAudio();
      clearAudioCache();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    playingMessageKey,
    handlePlayTTS,
    stopAllAudio,
    clearAudioCache,
    getMessageKey, // 버튼 aria에 쓰려고 노출
  };
}
