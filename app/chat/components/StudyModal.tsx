"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type StudyCard = {
  cardId: string | null;
  korean: string;
  baseSpanish: string;
  ttsKey: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  card: StudyCard | null;
  sessionId: string | null;
  canUseTTS: boolean;
  isGuest: boolean;
  onUsageLimit: (type: "chat" | "tts" | "learning") => void;
};

export default function StudyModal({
  isOpen,
  onClose,
  card,
  sessionId,
  canUseTTS,
  isGuest,
  onUsageLimit,
}: Props) {
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<{
    correct_answer: string;
    tip: string;
    is_correct: boolean;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 🔊 학습 모달 TTS 상태
  const [isTtsLoading, setIsTtsLoading] = useState(false);
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setAnswer("");
      setFeedback(null);

      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current.currentTime = 0;
        ttsAudioRef.current = null;
      }
      setIsPlaying(false);
      setTtsAudioUrl(null);
      setIsTtsLoading(false);
    }
  }, [isOpen]);

  if (!isOpen || !card) return null;

  const handleSubmit = async () => {
    const trimmed = answer.trim();
    if (!trimmed) return;

    if (!card.cardId) {
      alert("학습 카드 정보가 없어 피드백을 가져올 수 없어요.\n다시 학습 버튼을 눌러 준비해 주세요.");
      return;
    }

    try {
      setIsSubmitting(true);

      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token ?? null;

      const res = await fetch("/api/learning/answer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          cardId: card.cardId,
          userAnswer: trimmed,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        console.error("learning/answer error:", errJson);

        if (res.status === 401) {
          alert("로그인이 필요해요 🙂");
          return;
        }

        if (res.status === 403 && errJson?.code === "LEARNING_LIMIT_EXCEEDED") {
          onUsageLimit("learning");
          return;
        }

        alert("피드백을 불러오는 데 실패했어요.");
        return;
      }

      const dataRes = await res.json();
      setFeedback(dataRes);
    } catch (e) {
      console.error("StudyModal handleSubmit error:", e);
      alert("피드백 요청 중 오류가 발생했어요.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetry = () => {
    setAnswer("");
    setFeedback(null);
  };

  const handlePlayTTS = async () => {
    if (!canUseTTS) {
      if (isGuest) {
        alert("TTS는 로그인 후 사용할 수 있어요 🙂");
        return;
      }
      alert("음성 기능은 현재 사용할 수 없어요.");
      return;
    }

    if (!sessionId) {
      alert("세션 정보가 없어 음성을 재생할 수 없어요 🥲");
      return;
    }

    if (!card.ttsKey) {
      alert("메시지 정보가 없어 음성을 재생할 수 없어요 🥲");
      return;
    }

    if (!card.baseSpanish || !card.baseSpanish.trim()) {
      alert("재생할 문장이 없어요.");
      return;
    }

    const audioId = `${sessionId}/${card.ttsKey}`;

    try {
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current.currentTime = 0;
        ttsAudioRef.current = null;
        setIsPlaying(false);
        return;
      }

      setIsTtsLoading(true);

      if (ttsAudioUrl) {
        const audio = new Audio(ttsAudioUrl);
        ttsAudioRef.current = audio;
        setIsPlaying(true);

        audio.play();
        audio.onended = () => {
          ttsAudioRef.current = null;
          setIsPlaying(false);
        };
        audio.onerror = () => {
          ttsAudioRef.current = null;
          setIsPlaying(false);
        };
        return;
      }

      const { data: sess } = await supabase.auth.getSession();
      const accessToken = sess.session?.access_token ?? null;

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          text: card.baseSpanish,
          audioId,
        }),
      });

      if (res.status === 401 || res.status === 403) {
        const blocked = await res.json().catch(() => null);
        console.warn("StudyModal TTS blocked:", blocked);

        if (res.status === 401) {
          alert("로그인이 필요해요 🙂");
          return;
        }

        // 403: 권한/사용량 제한
        if (blocked?.code === "TTS_LIMIT_EXCEEDED") {
          onUsageLimit("tts");
          return;
        }
        if (blocked?.code === "TTS_NOT_ENABLED") {
          alert("음성 기능은 현재 사용할 수 없어요.");
          return;
        }

        alert("음성을 재생할 수 없어요.");
        return;
      }

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.url) {
        console.error("StudyModal TTS error:", data);
        alert("음성을 불러오는 데 실패했어요.");
        return;
      }

      setTtsAudioUrl(data.url);

      const audio = new Audio(data.url);
      ttsAudioRef.current = audio;
      setIsPlaying(true);

      audio.play();
      audio.onended = () => {
        ttsAudioRef.current = null;
        setIsPlaying(false);
      };
      audio.onerror = () => {
        ttsAudioRef.current = null;
        setIsPlaying(false);
      };
    } catch (e) {
      console.error("StudyModal handlePlayTTS error:", e);
      alert("음성 재생 중 오류가 발생했어요.");
    } finally {
      setIsTtsLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.7)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 60,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "480px",
          backgroundColor: "#111827",
          borderRadius: "16px",
          padding: "20px 24px",
          boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h2 style={{ color: "#f9fafb", fontSize: "18px", fontWeight: 600, margin: 0 }}>학습 모드</h2>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              color: "#9ca3af",
              fontSize: "18px",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ marginBottom: "12px" }}>
          <p style={{ fontSize: "13px", color: "#e5e7eb", marginBottom: "4px" }}>한국어 문장</p>
          <div
            style={{
              backgroundColor: "#1f2937",
              borderRadius: "8px",
              padding: "8px 10px",
              fontSize: "13px",
              color: "#f9fafb",
              whiteSpace: "pre-wrap",
            }}
          >
            {card.korean}
          </div>
        </div>

        <div style={{ marginBottom: "12px", display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={handlePlayTTS}
            style={{
              borderRadius: "999px",
              border: "1px solid #4b5563",
              padding: "6px 12px",
              fontSize: "16px",
              backgroundColor: "#1f2937",
              color: "#e5e7eb",
              cursor: isTtsLoading ? "not-allowed" : "pointer",
              opacity: isTtsLoading ? 0.7 : 1,
            }}
            disabled={isTtsLoading}
            aria-label="문장 듣기"
          >
            {isTtsLoading ? "…" : isPlaying ? "⏹️" : "▶️"}
          </button>
        </div>

        <div style={{ marginBottom: "12px" }}>
          <p style={{ fontSize: "13px", color: "#e5e7eb", marginBottom: "4px" }}>배운 언어로 다시 써보기</p>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={2}
            placeholder="여기에 문장을 적어주세요."
            style={{
              width: "100%",
              resize: "none",
              backgroundColor: "#111827",
              color: "#f9fafb",
              borderRadius: "8px",
              border: "1px solid #374151",
              padding: "8px",
              fontSize: "13px",
              outline: "none",
            }}
          />
        </div>

        {feedback && (
          <div
            style={{
              marginBottom: "12px",
              backgroundColor: "#111827",
              borderRadius: "8px",
              border: "1px solid #374151",
              padding: "8px 10px",
              fontSize: "13px",
              color: "#f9fafb",
            }}
          >
            <div style={{ marginBottom: "6px" }}>
              <strong>정답 예시: </strong>
              <span style={{ whiteSpace: "pre-wrap" }}>{card.baseSpanish}</span>
            </div>
            <div style={{ marginBottom: "4px" }}>
              <strong>TIP: </strong>
              <span>{feedback.tip}</span>
            </div>
            <div style={{ marginTop: "4px", fontSize: "11px", color: "#9ca3af" }}>
              채점 결과: {feedback.is_correct ? "거의 정답이에요! 👏" : "조금 더 연습해보자 🙂"}
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
          <button
            onClick={handleRetry}
            style={{
              borderRadius: "999px",
              border: "1px solid #4b5563",
              padding: "6px 12px",
              fontSize: "13px",
              backgroundColor: "transparent",
              color: "#e5e7eb",
              cursor: "pointer",
            }}
          >
            다시
          </button>

          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !answer.trim()}
            style={{
              borderRadius: "999px",
              border: "none",
              padding: "6px 16px",
              fontSize: "13px",
              fontWeight: 500,
              backgroundColor: isSubmitting ? "#4b5563" : "#2563eb",
              color: "#f9fafb",
              cursor: isSubmitting || !answer.trim() ? "not-allowed" : "pointer",
              opacity: isSubmitting || !answer.trim() ? 0.7 : 1,
            }}
          >
            {isSubmitting ? "채점 중..." : "제출"}
          </button>
        </div>
      </div>
    </div>
  );
}