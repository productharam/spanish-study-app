"use client";

import { useEffect, useState, useRef, KeyboardEvent } from "react";

type MessageDetails = {
  ko: string;      // 1. 한글 번역
  en: string;      // 2. 영어 번역
  grammar: string; // 3. 문장 문법 구조
  tip: string;     // 4. 네이티브 TIP
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  details?: MessageDetails;      // ✅ 더보기 내용
  isDetailsLoading?: boolean;    // ✅ 더보기 로딩 상태
};

export default function ChatWindow() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const typingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [expandedMessageIds, setExpandedMessageIds] = useState<string[]>([]);

  // 🔊 TTS 관련 상태 & 캐시
  const audioCacheRef = useRef<Map<string, string>>(new Map());
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);

  const typingSpeed = 20; // ms 단위, 숫자 낮출수록 더 빨리 타이핑됨

  const makeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // ✅ 스페인어 문장을 "호흡 단위"로 줄바꿈 해주는 함수
  const formatAssistantText = (text: string) => {
    const maxLineLength = 80; // 한 줄 최대 길이 (필요하면 60~100 사이로 조절)

    // 문장 단위로 먼저 쪼개기
    const sentences = text.split(/(?<=[.!?¡¿])\s+/);

    const lines: string[] = [];
    let currentLine = "";

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;

      const candidate = currentLine ? currentLine + " " + trimmed : trimmed;

      if (candidate.length <= maxLineLength) {
        currentLine = candidate;
      } else {
        if (currentLine) {
          lines.push(currentLine);
        }
        currentLine = trimmed;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.join("\n");
  };

  const loadDetails = async (id: string, text: string) => {
    // 1) 로딩 시작 표시
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, isDetailsLoading: true } : m
      )
    );

    try {
      const res = await fetch("/api/details", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      const data = await res.json();

      if (!res.ok || !data || data.error) {
        throw new Error("Details API error");
      }

      // 2) 정상 응답 → details 저장
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                isDetailsLoading: false,
                details: {
                  ko: data.ko,
                  en: data.en,
                  grammar: data.grammar,
                  tip: data.tip,
                },
              }
            : m
        )
      );
    } catch (e) {
      console.error("loadDetails error:", e);

      // 3) 실패 시: 로딩 끄고, 실패 메시지 넣어두기
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                isDetailsLoading: false,
                details: {
                  ko: "(상세 정보를 불러오지 못했어요)",
                  en: "(failed to load details)",
                  grammar: "(상세 정보를 불러오지 못했어요)",
                  tip: "(상세 정보를 불러오지 못했어요)",
                },
              }
            : m
        )
      );
    }
  };

  // 더보기 열고/닫기 + 처음 열릴 때만 상세 로드
  const toggleDetails = (id: string, text: string, alreadyHasDetails: boolean) => {
    setExpandedMessageIds((prev) => {
      const isExpanded = prev.includes(id);
      if (isExpanded) {
        // 이미 열려 있으면 -> 닫기
        return prev.filter((x) => x !== id);
      } else {
        // 닫혀 있던 걸 연다
        const next = [...prev, id];

        // 👉 처음 여는 것이고, 아직 details가 없다면 로드 시작
        if (!alreadyHasDetails) {
          loadDetails(id, text);
        }

        return next;
      }
    });
  };

  // 🔊 TTS: 메시지 1개에 대해 한 번만 API 호출, 이후 재사용
  const handlePlayTTS = async (message: ChatMessage) => {
    try {
      // 1) 캐시에 오디오가 이미 있으면 → API 호출 없이 재생
      if (audioCacheRef.current.has(message.id)) {
        const existingUrl = audioCacheRef.current.get(message.id)!;
        const audio = new Audio(existingUrl);
        setPlayingMessageId(message.id);
        audio.play();
        audio.onended = () => setPlayingMessageId(null);
        audio.onerror = () => setPlayingMessageId(null);
        return;
      }

      // 2) 캐시에 없으면 API 한 번 호출
      setPlayingMessageId(message.id);

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message.content }),
      });

      if (!res.ok) throw new Error("TTS 요청 실패");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      // 3) 캐시에 저장 (다음부터는 무료로 재생)
      audioCacheRef.current.set(message.id, url);

      // 4) 재생
      const audio = new Audio(url);
      audio.play();
      audio.onended = () => setPlayingMessageId(null);
      audio.onerror = () => setPlayingMessageId(null);
    } catch (err) {
      console.error(err);
      alert("음성 재생 중 오류가 발생했어 😢");
      setPlayingMessageId(null);
    }
  };

  // 타자 효과로 assistant 메시지 출력
  const startTypewriter = (fullText: string) => {
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
    }

    let index = 0;

    typingIntervalRef.current = setInterval(() => {
      index++;

      setMessages((prev) => {
        if (prev.length === 0) return prev;

        const newMessages = [...prev];
        const lastIndex = newMessages.length - 1;
        const last = newMessages[lastIndex];

        if (last.role !== "assistant") return prev;

        newMessages[lastIndex] = {
          ...last,
          content: fullText.slice(0, index),
        };

        return newMessages;
      });

      if (index >= fullText.length) {
        if (typingIntervalRef.current) {
          clearInterval(typingIntervalRef.current);
        }
      }
    }, typingSpeed);
  };

  // 컴포넌트 언마운트 시 인터벌 & 오디오 URL 정리
  useEffect(() => {
    return () => {
      if (typingIntervalRef.current) {
        clearInterval(typingIntervalRef.current);
      }
      audioCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      audioCacheRef.current.clear();
    };
  }, []);

  // 처음 페이지 들어왔을 때 Juan이 먼저 인사
  useEffect(() => {
    async function startConversation() {
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          body: JSON.stringify({
            messages: [],
            isFirst: true,
          }),
        });

        const data = await res.json();

        setMessages([
          {
            id: makeId(),
            role: "assistant",
            content: "",
          },
        ]);

        const formatted = formatAssistantText(data.reply);
        startTypewriter(formatted);
      } catch (e) {
        setMessages([
          {
            id: makeId(),
            role: "assistant",
            content: "처음 인사 불러오는데 문제가 생겼어 🥲",
          },
        ]);
      }
    }

    startConversation();
  }, []);

  // 메시지 보내기
  const handleSend = async () => {
    if (!input.trim() || isSending) return;

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: input.trim(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: newMessages,
          isFirst: false,
        }),
      });

      const data = await res.json();
      const fullAssistantText = data.reply;

      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: "assistant",
          content: "",
        },
      ]);

      const formatted = formatAssistantText(fullAssistantText);
      startTypewriter(formatted);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: "assistant",
          content:
            "응답을 가져오는 데 문제가 생겼어. 잠시 후 다시 시도해 줘 🙏",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  // Enter로 전송 (Shift+Enter는 줄바꿈)
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 메시지 목록 */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          paddingRight: "4px",
          marginBottom: "12px",
        }}
      >
        <h2 style={{ fontSize: "20px", marginBottom: "10px" }}>Juan과의 대화</h2>

        {messages.map((msg) => {
          const isUser = msg.role === "user";
          const isAssistant = msg.role === "assistant";
          const isExpanded = expandedMessageIds.includes(msg.id);
          const hasDetails = !!msg.details;

          return (
            <div
              key={msg.id}
              style={{
                display: "flex",
                justifyContent: isUser ? "flex-end" : "flex-start",
                marginBottom: "8px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: isUser ? "flex-end" : "flex-start",
                  maxWidth: "75%",
                  gap: "6px",
                }}
              >
                {/* 말풍선 + 버튼들 한 줄 */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    alignSelf: isUser ? "flex-end" : "flex-start",
                  }}
                >
                  <div
                    style={{
                      backgroundColor: isUser ? "#2563eb" : "#222",
                      color: "white",
                      padding: "10px 14px",
                      borderRadius: "12px",
                      whiteSpace: "pre-wrap", // ✅ 줄바꿈/공백 유지
                      fontSize: "14px",
                    }}
                  >
                    {msg.content}
                  </div>

                  {isAssistant && (
                    <div style={{ display: "flex", gap: "4px" }}>
                      <button
  onClick={() =>
    toggleDetails(msg.id, msg.content, hasDetails)
  }
  style={{
    fontSize: "14px",
    padding: "4px 8px",
    borderRadius: "999px",
    border: "1px solid #555",
    backgroundColor: "#111",
    color: "white",
    cursor: "pointer",
  }}
  aria-label={isExpanded ? "상세 접기" : "상세 더보기"}
>
  {isExpanded ? "−" : "+"}
</button>


                      <button
  onClick={() => handlePlayTTS(msg)}
  disabled={playingMessageId === msg.id}
  style={{
    fontSize: "16px",
    padding: "4px 8px",
    borderRadius: "999px",
    border: "1px solid #555",
    backgroundColor: "#111",
    color: "white",
    cursor: playingMessageId === msg.id ? "default" : "pointer",
  }}
  aria-label="스페인어 문장 듣기"
>
  {playingMessageId === msg.id ? "🔊" : "🔈"}
</button>


                    </div>
                  )}
                </div>

                {/* 아래 펼쳐지는 상세 영역 */}
                {isAssistant && isExpanded && (
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: "8px",
                      backgroundColor: "#181818",
                      color: "#ddd",
                      fontSize: "13px",
                      lineHeight: 1.5,
                    }}
                  >
                    {msg.isDetailsLoading && !msg.details ? (
                      <div>상세 내용을 불러오는 중이에요… ⏳</div>
                    ) : (
                      <>
                        <div style={{ marginBottom: "6px" }}>
                          <strong>1. 한글 번역</strong>
                          <div
                            style={{
                              marginTop: "2px",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {msg.details?.ko ??
                              "아직 내용이 없어요. (다음 단계에서 GPT와 연결될 예정)"}
                          </div>
                        </div>

                        <div style={{ marginBottom: "6px" }}>
                          <strong>2. 영어 번역</strong>
                          <div
                            style={{
                              marginTop: "2px",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {msg.details?.en ??
                              "아직 내용이 없어요. (다음 단계에서 GPT와 연결될 예정)"}
                          </div>
                        </div>

                        <div style={{ marginBottom: "6px" }}>
                          <strong>3. 문장 문법 구조</strong>
                          <div
                            style={{
                              marginTop: "2px",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {msg.details?.grammar ??
                              "아직 내용이 없어요. (다음 단계에서 GPT와 연결될 예정)"}
                          </div>
                        </div>

                        <div>
                          <strong>4. 네이티브 TIP</strong>
                          <div
                            style={{
                              marginTop: "2px",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {msg.details?.tip ??
                              "아직 내용이 없어요. (다음 단계에서 GPT와 연결될 예정)"}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 입력 영역 */}
      <div
        style={{
          borderTop: "1px solid #333",
          paddingTop: "8px",
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="스페인어로 말해볼까? (Enter: 전송, Shift+Enter: 줄바꿈)"
          style={{
            width: "100%",
            height: "70px",
            resize: "none",
            backgroundColor: "#111",
            color: "white",
            borderRadius: "8px",
            border: "1px solid #333",
            padding: "8px",
            marginBottom: "8px",
            fontSize: "14px",
          }}
        />

        <button
          onClick={handleSend}
          disabled={isSending}
          style={{
            width: "100%",
            padding: "10px 0",
            borderRadius: "8px",
            border: "none",
            cursor: isSending ? "not-allowed" : "pointer",
            backgroundColor: isSending ? "#555" : "#2563eb",
            color: "white",
            fontSize: "14px",
            fontWeight: 500,
          }}
        >
          {isSending ? "답변 기다리는 중..." : "보내기"}
        </button>
      </div>
    </div>
  );
}
