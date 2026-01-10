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
  isGuest: boolean;
  ttsEnabled: boolean;
  isProfileLoading: boolean;

  getAccessToken: () => Promise<string | null>;
  onUsageLimit?: (type: UsageLimitType) => void; // ✅ 상위(ChatWindow)에서 "오늘 사용량..." UI 띄우기
};

export function useSoundTTS({
  sessionId,
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
    return `${sessionId}/${key}`;
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
    // public URL을 쓰는 구조라 revokeObjectURL은 불필요
    audioCacheRef.current.clear();
  };

  const handlePlayTTS = async (message: SoundChatMessage) => {
    try {
      if (isProfileLoading) return;

      if (isGuest) {
        alert("음성 기능은 로그인 후 사용할 수 있어요.");
        return;
      }

      // ✅ 회원이지만 플랜/설정상 비활성인 경우: 출시모달 삭제 → 알럿만
      if (!ttsEnabled) {
        alert("음성 기능은 현재 사용할 수 없어요.");
        return;
      }

      if (!sessionId) {
        alert("세션 정보가 없어서 음성을 재생할 수 없어요 🥲");
        return;
      }

      const messageKey = getMessageKey(message);

      // ✅ 같은 메시지 재생 중이면 정지
      if (playingMessageKey === messageKey && currentAudioRef.current) {
        stopAllAudio();
        return;
      }

      // ✅ 다른 메시지 재생 중이면 끊고 시작
      if (currentAudioRef.current) stopAllAudio();

      const audioId = getAudioId(message);
      if (!audioId) {
        alert("세션 정보가 없어서 음성을 재생할 수 없어요 🥲");
        return;
      }

      // ✅ 프론트 캐시 히트면 즉시 재생
      if (audioCacheRef.current.has(audioId)) {
        const url = audioCacheRef.current.get(audioId)!;
        const audio = new Audio(url);
        currentAudioRef.current = audio;
        setPlayingMessageKey(messageKey);

        audio.play();
        audio.onended = () => {
          currentAudioRef.current = null;
          setPlayingMessageKey(null);
        };
        audio.onerror = () => {
          currentAudioRef.current = null;
          setPlayingMessageKey(null);
        };
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
        }),
      });

      // ✅ 제한/차단 처리 (출시모달 삭제)
      if (!res.ok) {
        const data = await res.json().catch(() => null);

        if (res.status === 403) {
          if (data?.code === "TTS_LIMIT_EXCEEDED") {
            onUsageLimit?.("tts");
            setPlayingMessageKey(null);
            return;
          }
          if (data?.code === "TTS_NOT_ENABLED") {
            alert("음성 기능은 현재 사용할 수 없어요.");
            setPlayingMessageKey(null);
            return;
          }
        }

        if (res.status === 401) {
          alert("로그인이 필요해요 🙂");
          setPlayingMessageKey(null);
          return;
        }

        console.error("TTS 요청 실패:", data);
        throw new Error("TTS 요청 실패");
      }

      const data = await res.json().catch(() => null);
      const url = data?.url as string | undefined;
      if (!url) throw new Error("TTS URL이 응답에 없어요");

      audioCacheRef.current.set(audioId, url);

      const audio = new Audio(url);
      currentAudioRef.current = audio;

      audio.play();
      audio.onended = () => {
        currentAudioRef.current = null;
        setPlayingMessageKey(null);
      };
      audio.onerror = () => {
        currentAudioRef.current = null;
        setPlayingMessageKey(null);
      };
    } catch (err) {
      console.error(err);
      alert("음성 재생 중 오류가 발생했어");
      setPlayingMessageKey(null);
      currentAudioRef.current = null;
    }
  };

  // ✅ 언마운트 시 오디오 정리
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