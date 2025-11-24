"use client";

import { useEffect, useState, useRef, KeyboardEvent } from "react";

type MessageDetails = {
  correction?: string; // 0. 스페인어 문장 교정 (내 말풍선 전용)
  ko: string;          // 1. 한글 번역
  en: string;          // 2. 영어 번역
  grammar: string;     // 3. 문장 문법 구조
  tip: string;         // 4. 네이티브 TIP
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  details?: MessageDetails;      // ✅ 더보기 내용
  isDetailsLoading?: boolean;    // ✅ 더보기 로딩 상태
  detailsError?: boolean;        // ✅ 더보기 불러오기 실패 여부
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

  // ✅ 대화 시작 여부 & 첫 인사 로딩 상태
  const [hasStarted, setHasStarted] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  // ✅ Supabase 세션 ID (가장 최근 or 새로 만든 세션)
  const [sessionId, setSessionId] = useState<string | null>(null);

  // ✅ 스페인어 문장을 "호흡 단위"로 줄바꿈 해주는 함수
  const formatAssistantText = (text: string) => {
    const maxLineLength = 80; // 한 줄 최대 길이

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

  /**
   * ✅ 처음 진입할 때: Supabase에서 가장 최근 세션 + 메시지 불러오기
   */
  useEffect(() => {
    const fetchLatestSession = async () => {
      try {
        const res = await fetch("/api/session/latest");
        const data = await res.json();

        if (!res.ok || !data.ok) {
          console.error("latest session load error:", data.error);
          return;
        }

        if (data.session && data.messages) {
          const restored: ChatMessage[] = data.messages.map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            details: m.details ?? undefined,
            isDetailsLoading: false,
            detailsError: false,
          }));

          setMessages(restored);
          setSessionId(data.session.id);
          setHasStarted(restored.length > 0);
        }
      } catch (e) {
        console.error("latest session fetch error:", e);
      }
    };

    fetchLatestSession();

    return () => {
      if (typingIntervalRef.current) {
        clearInterval(typingIntervalRef.current);
      }
      audioCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      audioCacheRef.current.clear();
    };
  }, []);

  /**
   * 🔍 GPT(assistant) 말풍선 상세 내용 로드
   * - /api/details 사용
   */
  const loadDetails = async (id: string, text: string) => {
    // 1) 로딩 시작 표시
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? { ...m, isDetailsLoading: true, detailsError: false }
          : m
      )
    );

    try {
      const res = await fetch("/api/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text,sessionId, }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error("Details API error");
      }

      // 2) 정상 응답 → details 저장
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                isDetailsLoading: false,
                detailsError: false,
                details: {
                  ko: data.ko ?? "",
                  en: data.en ?? "",
                  grammar: data.grammar ?? "",
                  tip: data.tip ?? "",
                },
              }
            : m
        )
      );
    } catch (e) {
      console.error("loadDetails error:", e);

      // 3) 실패 시: 로딩 끄고, 에러 플래그만 세우기 (details는 비움)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                isDetailsLoading: false,
                detailsError: true,
                details: undefined,
              }
            : m
        )
      );
    }
  };

  /**
   * 🔍 내(user) 말풍선 상세 내용 로드
   * - /api/details-user 사용
   */
  const loadUserDetails = async (id: string, text: string) => {
    // 1) 로딩 시작 표시
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? { ...m, isDetailsLoading: true, detailsError: false }
          : m
      )
    );

    try {
      const res = await fetch("/api/details-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text,sessionId, }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error("Details-User API error");
      }

      // 2) 정상 응답 → details 저장 (correction 포함)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                isDetailsLoading: false,
                detailsError: false,
                details: {
                  correction: data.correction ?? "",
                  ko: data.ko ?? "",
                  en: data.en ?? "",
                  grammar: data.grammar ?? "",
                  tip: data.tip ?? "",
                },
              }
            : m
        )
      );
    } catch (e) {
      console.error("loadUserDetails error:", e);

      // 3) 실패 시: 로딩 끄고, 에러 플래그만 세우기 (details는 비움)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                isDetailsLoading: false,
                detailsError: true,
                details: undefined,
              }
            : m
        )
      );
    }
  };

  // GPT 말풍선 더보기 (오른쪽)
  const toggleDetails = (
    id: string,
    text: string,
    alreadyHasDetails: boolean
  ) => {
    setExpandedMessageIds((prev) => {
      const isExpanded = prev.includes(id);
      if (isExpanded) {
        // 이미 열려 있으면 -> 닫기
        return prev.filter((x) => x !== id);
      } else {
        // 닫혀 있던 걸 연다
        const next = [...prev, id];

        // 👉 성공한 details가 없을 때만 로드 시작
        if (!alreadyHasDetails) {
          loadDetails(id, text);
        }

        return next;
      }
    });
  };

  // 내 말풍선 더보기 (왼쪽)
  const toggleUserDetails = (
    id: string,
    text: string,
    alreadyHasDetails: boolean
  ) => {
    setExpandedMessageIds((prev) => {
      const isExpanded = prev.includes(id);
      if (isExpanded) {
        // 이미 열려 있으면 -> 닫기
        return prev.filter((x) => x !== id);
      } else {
        // 닫혀 있던 걸 연다
        const next = [...prev, id];

        // 👉 성공한 details가 없을 때만 로드 시작
        if (!alreadyHasDetails) {
          loadUserDetails(id, text);
        }

        return next;
      }
    });
  };

  // 🔊 TTS: 메시지 1개에 대해 한 번만 API 호출, 이후 재사용
  const handlePlayTTS = async (message: ChatMessage) => {
    try {
      if (audioCacheRef.current.has(message.id)) {
        const existingUrl = audioCacheRef.current.get(message.id)!;
        const audio = new Audio(existingUrl);
        setPlayingMessageId(message.id);
        audio.play();
        audio.onended = () => setPlayingMessageId(null);
        audio.onerror = () => setPlayingMessageId(null);
        return;
      }

      setPlayingMessageId(message.id);

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message.content }),
      });

      if (!res.ok) throw new Error("TTS 요청 실패");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      audioCacheRef.current.set(message.id, url);

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

  // ✅ 새 대화 시작 (프론트 상태만 리셋, DB는 그대로 유지되고, 다음 첫 메시지에서 새 세션 생성)
  const handleNewChat = () => {
    setMessages([]);
    setSessionId(null);
    setHasStarted(false);
    setExpandedMessageIds([]);
    setPlayingMessageId(null);

    audioCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
    audioCacheRef.current.clear();
  };

    // ✅ 현재 세션을 DB에서 완전히 삭제 + 화면 초기화
  const handleDeleteCurrentSession = async () => {
    console.log("Deleting session id:", sessionId);
    if (!sessionId) {
      alert("삭제할 대화가 없어요.");
      return;
    }

    const confirmDelete = window.confirm(
      "현재 대화를 DB에서도 완전히 삭제할까요?"
    );
    if (!confirmDelete) return;

    try {
      const res = await fetch("/api/session/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        console.error("session/delete error:", data);
        alert("대화를 삭제하는 중 문제가 발생했어요 🥲");
        return;
      }

      // ✅ 프론트 상태도 리셋
      setMessages([]);
      setSessionId(null);
      setHasStarted(false);
      setExpandedMessageIds([]);
      setPlayingMessageId(null);

      audioCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      audioCacheRef.current.clear();

      alert("현재 대화를 깔끔하게 삭제했어요 ✅");
    } catch (e) {
      console.error("session/delete fetch error:", e);
      alert("대화를 삭제하는 중 오류가 발생했어요 🥲");
    }
  };


    // ✅ 버튼을 눌렀을 때 Juan이 먼저 인사 + 그 인사를 DB에 세션으로 저장
  const handleStartConversation = async () => {
    if (isStarting) return;

    setIsStarting(true);

    try {
      // 1️⃣ GPT에게 인사 멘트 요청
      const res = await fetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: [],
          isFirst: true,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Chat API error");
      }

      const fullGreeting = data.reply;
      const formattedGreeting = formatAssistantText(fullGreeting);

      // 2️⃣ 인사 멘트로 세션 + 첫 assistant 메시지를 DB에 저장
      const createRes = await fetch("/api/session/create-greeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          greeting: formattedGreeting,
        }),
      });

      const createData = await createRes.json();

      if (!createRes.ok || !createData.sessionId) {
        console.error("create-greeting error:", createData);
        throw new Error(createData.error || "Failed to create greeting session");
      }

      // 3️⃣ 프론트 상태 업데이트
      setSessionId(createData.sessionId);

      // 화면에는 타자 효과용 assistant 말풍선 하나 만들고
      setMessages([
        {
          id: makeId(),
          role: "assistant",
          content: "",
        },
      ]);

      // 타자 효과로 인사 출력
      startTypewriter(formattedGreeting);
      setHasStarted(true);
    } catch (e) {
      console.error(e);
      setMessages([
        {
          id: makeId(),
          role: "assistant",
          content: "처음 인사 불러오는데 문제가 생겼어 🥲",
        },
      ]);
      // 그래도 대화는 시작 가능하게
      setHasStarted(true);
    } finally {
      setIsStarting(false);
    }
  };


  // 메시지 보내기
  const handleSend = async () => {
    if (!hasStarted) return; // 아직 인사 전이면 막기
    if (!input.trim() || isSending) return;

    const trimmed = input.trim();

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: trimmed,
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsSending(true);

    // 이 함수 안에서 사용할 현재 세션 ID (새로 생성될 수도 있음)
    let currentSessionId = sessionId;

    try {
      // 1️⃣ 세션이 없으면 = 첫 메시지 → 세션 생성 + 첫 메시지 DB 저장
      if (!currentSessionId) {
        const createRes = await fetch("/api/session/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firstMessage: trimmed,
          }),
        });

        const createData = await createRes.json();

        if (!createRes.ok || !createData.sessionId) {
          console.error("session/create error:", createData);
          alert("대화 세션을 만드는 중 오류가 발생했어. 잠시 후 다시 시도해줘.");
          setIsSending(false);
          return;
        }

        currentSessionId = createData.sessionId as string;
        setSessionId(currentSessionId);
        // ⚠️ session/create가 이미 첫 user 메시지는 DB에 저장했으므로,
        // 여기서는 따로 /api/message/add 호출하지 않음.
      } else {
        // 2️⃣ 이미 세션이 있는 경우 = 그냥 user 메시지를 DB에 추가
        try {
          const saveUserRes = await fetch("/api/message/add", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: currentSessionId,
              role: "user",
              content: trimmed,
            }),
          });

          const saveUserData = await saveUserRes.json();
          if (!saveUserRes.ok || saveUserData.error) {
            console.error("message/add (user) error:", saveUserData);
          }
        } catch (saveErr) {
          console.error("message/add (user) fetch error:", saveErr);
        }
      }

      // 3️⃣ GPT에게 응답 요청
      const chatRes = await fetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: newMessages,
          isFirst: false,
        }),
      });

      const chatData = await chatRes.json();
      const fullAssistantText = chatData.reply;

      const assistantId = makeId();

      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
        },
      ]);

      const formatted = formatAssistantText(fullAssistantText);
      startTypewriter(formatted);

      // 4️⃣ GPT 응답도 DB에 저장
      if (currentSessionId) {
        try {
          const saveAssistantRes = await fetch("/api/message/add", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: currentSessionId,
              role: "assistant",
              content: formatted,
            }),
          });

          const saveAssistantData = await saveAssistantRes.json();
          if (!saveAssistantRes.ok || saveAssistantData.error) {
            console.error("message/add (assistant) error:", saveAssistantData);
          }
        } catch (saveErr) {
          console.error("message/add (assistant) fetch error:", saveErr);
        }
      }
    } catch (e) {
      console.error(e);
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
        <div
  style={{
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "10px",
    gap: "8px",
  }}
>
  <h2 style={{ fontSize: "20px" }}>Juan과의 대화</h2>

  <div style={{ display: "flex", gap: "6px" }}>
    <button
      onClick={handleNewChat}
      style={{
        fontSize: "12px",
        padding: "6px 10px",
        borderRadius: "999px",
        border: "1px solid #555",
        backgroundColor: "#111",
        color: "white",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      새 대화 시작
    </button>

    <button
      onClick={handleDeleteCurrentSession}
      style={{
        fontSize: "12px",
        padding: "6px 10px",
        borderRadius: "999px",
        border: "1px solid #555",
        backgroundColor: "#111",
        color: "#ffdddd",
        cursor: sessionId ? "pointer" : "not-allowed",
        opacity: sessionId ? 1 : 0.5,
        whiteSpace: "nowrap",
      }}
      disabled={!sessionId}
    >
      현재 대화 삭제
    </button>
  </div>
</div>


        {messages.map((msg) => {
          const isUser = msg.role === "user";
          const isAssistant = msg.role === "assistant";
          const isExpanded = expandedMessageIds.includes(msg.id);
          const hasDetails = !!msg.details && !msg.detailsError;

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
                  {/* ✅ 내 말풍선: 왼쪽에 + 버튼 */}
                  {isUser && (
                    <button
                      onClick={() =>
                        toggleUserDetails(msg.id, msg.content, hasDetails)
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
                  )}

                  {/* 말풍선 */}
                  <div
                    style={{
                      backgroundColor: isUser ? "#2563eb" : "#222",
                      color: "white",
                      padding: "10px 14px",
                      borderRadius: "12px",
                      whiteSpace: "pre-wrap",
                      fontSize: "14px",
                    }}
                  >
                    {msg.content}
                  </div>

                  {/* GPT 말풍선: 오른쪽 + 버튼 + 스피커 */}
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
                          cursor:
                            playingMessageId === msg.id ? "default" : "pointer",
                        }}
                        aria-label="스페인어 문장 듣기"
                      >
                        {playingMessageId === msg.id ? "🔊" : "🔈"}
                      </button>
                    </div>
                  )}
                </div>

                {/* 아래 펼쳐지는 상세 영역 (user + assistant 공통) */}
                {isExpanded && (
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
                    {msg.isDetailsLoading ? (
                      <div>상세 내용을 불러오는 중이에요… ⏳</div>
                    ) : msg.detailsError ? (
                      <div>
                        <div style={{ marginBottom: "6px" }}>
                          상세 정보를 불러오지 못했어요 🥲
                        </div>
                        <button
                          onClick={() =>
                            isUser
                              ? loadUserDetails(msg.id, msg.content)
                              : loadDetails(msg.id, msg.content)
                          }
                          style={{
                            marginTop: "4px",
                            fontSize: "13px",
                            padding: "4px 8px",
                            borderRadius: "999px",
                            border: "1px solid #555",
                            backgroundColor: "#111",
                            color: "white",
                            cursor: "pointer",
                          }}
                        >
                          🔄 상세 다시 시도
                        </button>
                      </div>
                    ) : (
                      <>
                        {/* ✅ 내 말풍선일 때만 0. 스페인어 문장 교정 표시 */}
                        {isUser && msg.details?.correction && (
                          <div style={{ marginBottom: "6px" }}>
                            <strong>0. 스페인어 문장 교정</strong>
                            <div
                              style={{
                                marginTop: "2px",
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              {msg.details.correction}
                            </div>
                          </div>
                        )}

                        <div style={{ marginBottom: "6px" }}>
                          <strong>1. 한글 번역</strong>
                          <div
                            style={{
                              marginTop: "2px",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {msg.details?.ko}
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
                            {msg.details?.en}
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
                            {msg.details?.grammar}
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
                            {msg.details?.tip}
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

            {/* 아래 입력/버튼 영역 */}
      <div
        style={{
          borderTop: "1px solid #333",
          paddingTop: "8px",
        }}
      >

        {!hasStarted ? (
          // ✅ 아직 대화 시작 전: 인사하기 버튼만 보여주기
          <button
            onClick={handleStartConversation}
            disabled={isStarting}
            style={{
              width: "100%",
              padding: "12px 0",
              borderRadius: "8px",
              border: "none",
              cursor: isStarting ? "not-allowed" : "pointer",
              backgroundColor: isStarting ? "#555" : "#2563eb",
              color: "white",
              fontSize: "15px",
              fontWeight: 500,
            }}
          >
            {isStarting ? "Juan 인사 불러오는 중..." : "Juan에게 인사하기 👋"}
          </button>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
