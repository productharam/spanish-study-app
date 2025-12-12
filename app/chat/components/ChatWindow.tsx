// app/chat/components/ChatWindow.tsx
"use client";

import { useEffect, useState, useRef, KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MessageDetails = {
  correction?: string; // 0. 스페인어 문장 교정 (내 말풍선 전용)
  ko: string; // 1. 한글 번역
  en: string; // 2. 영어 번역
  grammar: string; // 3. 문장 문법 구조
  tip: string; // 4. 네이티브 TIP
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  details?: MessageDetails;
  isDetailsLoading?: boolean;
  detailsError?: boolean;
};

// ✅ 메시지 1개당 학습 카드 정보
type StudyCard = {
  cardId: string | null;
  korean: string;
  hint?: string;
  baseSpanish: string;
};

type StudyState = Record<string, StudyCard>;

type ChatFlow = "loading" | "guestNew" | "existingSession" | "newConfigured" | "invalid";

export default function ChatWindow() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // 메시지 & UI 기본 상태
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const typingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [expandedMessageIds, setExpandedMessageIds] = useState<string[]>([]);

  // TTS 관련
  const audioCacheRef = useRef<Map<string, string>>(new Map());
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const typingSpeed = 20;
  const makeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // 플로우 상태
  const [chatFlow, setChatFlow] = useState<ChatFlow>("loading");
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  // 세션/유저
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [user, setUser] = useState<any | null>(null);
  const [isGuest, setIsGuest] = useState(false);

  // 기존 hasStarted: "첫 인사 이후 실제 채팅 모드로 들어갔는지"
  const [hasStarted, setHasStarted] = useState(false);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  // 게스트 체험 관련
  const [guestTrialCount, setGuestTrialCount] = useState(0);
  const [showLoginModal, setShowLoginModal] = useState(false);

  // 학습 상태
  const [studyState, setStudyState] = useState<StudyState>({});
  const [isStudyModalOpen, setIsStudyModalOpen] = useState(false);
  const [activeStudyMessageId, setActiveStudyMessageId] = useState<string | null>(null);
  const [isStudyLoading, setIsStudyLoading] = useState(false);

  // 4단계 위저드 상태
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [isCreatingConfiguredSession, setIsCreatingConfiguredSession] = useState(false);

  // 🔐 브라우저 Supabase 세션에서 access token 가져오기
  const getAccessToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  };

  // ✅ "호흡 단위" 줄바꿈
  const formatAssistantText = (text: string) => {
    const maxLineLength = 80;
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
        if (currentLine) lines.push(currentLine);
        currentLine = trimmed;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines.join("\n");
  };

  /**
   * ✅ 처음 진입할 때:
   *  1) Supabase 유저 확인
   *  2) mode/sessionId/slot/new 쿼리 파라미터로 플로우 결정
   */
  useEffect(() => {
    const init = async () => {
      setIsInitialLoading(true);

      try {
        const { data } = await supabase.auth.getUser();
        const currentUser = data.user ?? null;
        setUser(currentUser);

        const modeParam = searchParams.get("mode");
        const sessionIdParam = searchParams.get("sessionId");
        const slotParam = searchParams.get("slot");
        const newParam = searchParams.get("new");

        // 1️⃣ 게스트(체험 모드): /chat?mode=guest
        if (modeParam === "guest" || !currentUser) {
          setIsGuest(true);
          setGuestTrialCount(0);
          setChatFlow("guestNew"); // 설정 위저드 → 대화 시작
          setSessionId(null);
          setSlot(null);
          setMessages([]);
          setHasStarted(false);
          return;
        }

        // 2️⃣ 로그인 사용자
        setIsGuest(false);

        if (sessionIdParam) {
          // 기존 세션 이어하기
          setChatFlow("existingSession");
          setSessionId(sessionIdParam);
          setSlot(null);
          setMessages([]);
          setHasStarted(false);
        } else if (newParam === "1" && slotParam) {
          // 새 세션 시작 (위저드)
          const n = Number(slotParam);
          if (n >= 1 && n <= 3) {
            setChatFlow("newConfigured");
            setSlot(n);
            setSessionId(null);
            setMessages([]);
            setHasStarted(false);
          } else {
            setChatFlow("invalid");
          }
        } else {
          // 홈에서 안 들어온 이상한 접근
          setChatFlow("invalid");
        }
      } catch (e) {
        console.error("init (auth + route) error:", e);
        setChatFlow("invalid");
      } finally {
        setIsInitialLoading(false);
      }
    };

    init();

    return () => {
      if (typingIntervalRef.current) {
        clearInterval(typingIntervalRef.current);
      }
      audioCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      audioCacheRef.current.clear();
    };
  }, [searchParams]);

  /**
   * ✅ 기존 세션 이어가기 모드: /api/session/messages 로 메시지 로드
   *  - 예상 응답: { ok: true, session: {...}, messages: [...] }
   */
  useEffect(() => {
    const loadExistingSession = async () => {
      if (chatFlow !== "existingSession") return;
      if (!sessionId) return;
      if (isGuest) return; // 게스트는 existingSession 사용 안 함

      setIsMessagesLoading(true);
      setMessagesError(null);

      try {
        const accessToken = await getAccessToken();

        const res = await fetch("/api/session/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ sessionId }),
        });

        const data = await res.json().catch(() => null);

        if (!res.ok || !data || data.ok === false) {
          console.error("/api/session/messages error:", data);
          setMessages([]);
          setMessagesError("대화 내역을 불러오지 못했어요.");
          return;
        }

        const session = data.session;
        const rows = data.messages ?? [];

        if (!session) {
          setMessages([]);
          setMessagesError("세션 정보를 찾을 수 없어요.");
          return;
        }

        setSessionId(session.id);

        const restored: ChatMessage[] = rows.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          details: m.details ?? undefined,
          isDetailsLoading: false,
          detailsError: false,
        }));

        setMessages(restored);
        setHasStarted(true); // 이미 대화 중인 세션
      } catch (e) {
        console.error("loadExistingSession error:", e);
        setMessagesError("대화 내역을 불러오는 중 오류가 발생했어요.");
      } finally {
        setIsMessagesLoading(false);
      }
    };

    loadExistingSession();
  }, [chatFlow, sessionId, isGuest]);

  /**
   * 🔍 GPT(assistant) 말풍선 상세 내용 로드 - /api/details
   */
  const loadDetails = async (id: string, text: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, isDetailsLoading: true, detailsError: false } : m
      )
    );

    try {
      const res = await fetch("/api/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, sessionId }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error("Details API error");
      }

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
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, isDetailsLoading: false, detailsError: true, details: undefined }
            : m
        )
      );
    }
  };

  /**
   * 🔍 내(user) 말풍선 상세 내용 로드 - /api/details-user
   */
  const loadUserDetails = async (id: string, text: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, isDetailsLoading: true, detailsError: false } : m
      )
    );

    try {
      const res = await fetch("/api/details-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, sessionId }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error("Details-User API error");
      }

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
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, isDetailsLoading: false, detailsError: true, details: undefined }
            : m
        )
      );
    }
  };

  // GPT 말풍선 더보기
  const toggleDetails = (id: string, text: string, alreadyHasDetails: boolean) => {
    setExpandedMessageIds((prev) => {
      const isExpanded = prev.includes(id);
      if (isExpanded) {
        return prev.filter((x) => x !== id);
      } else {
        const next = [...prev, id];
        if (!alreadyHasDetails) {
          loadDetails(id, text);
        }
        return next;
      }
    });
  };

  // 내 말풍선 더보기
  const toggleUserDetails = (id: string, text: string, alreadyHasDetails: boolean) => {
    setExpandedMessageIds((prev) => {
      const isExpanded = prev.includes(id);
      if (isExpanded) {
        return prev.filter((x) => x !== id);
      } else {
        const next = [...prev, id];
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
      if (isGuest) {
        alert("TTS는 로그인 후 사용할 수 있어요 🙂");
        return;
      }

      if (playingMessageId === message.id && currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
        currentAudioRef.current = null;
        setPlayingMessageId(null);
        return;
      }

      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
        currentAudioRef.current = null;
        setPlayingMessageId(null);
      }

      if (audioCacheRef.current.has(message.id)) {
        const existingUrl = audioCacheRef.current.get(message.id)!;
        const audio = new Audio(existingUrl);
        currentAudioRef.current = audio;
        setPlayingMessageId(message.id);

        audio.play();
        audio.onended = () => {
          setPlayingMessageId(null);
          currentAudioRef.current = null;
        };
        audio.onerror = () => {
          setPlayingMessageId(null);
          currentAudioRef.current = null;
        };
        return;
      }

      if (!sessionId) {
        alert("세션 정보가 없어서 음성을 재생할 수 없어요 🥲");
        return;
      }

      const audioId = `${sessionId}/${message.id}`;

      setPlayingMessageId(message.id);

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: message.content,
          audioId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        console.error("TTS 요청 실패:", data);
        throw new Error("TTS 요청 실패");
      }

      const data = await res.json();
      const url = data.url as string | undefined;

      if (!url) throw new Error("TTS URL이 응답에 없어요");

      audioCacheRef.current.set(message.id, url);

      const audio = new Audio(url);
      currentAudioRef.current = audio;

      audio.play();
      audio.onended = () => {
        setPlayingMessageId(null);
        currentAudioRef.current = null;
      };
      audio.onerror = () => {
        setPlayingMessageId(null);
        currentAudioRef.current = null;
      };
    } catch (err) {
      console.error(err);
      alert("음성 재생 중 오류가 발생했어 😢");
      setPlayingMessageId(null);
      currentAudioRef.current = null;
    }
  };

  // 로그인 모달 관련
  const loginWithGoogle = async () => {
    try {
      const origin =
        typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

      // ✅ 수정: /chat 이 아니라 /auth/callback 으로 보냄
      const redirectTo = `${origin}/auth/callback`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });

      if (error) {
        console.error("Google 로그인 에러:", error);
        alert("로그인 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.");
      }
    } catch (e) {
      console.error("Google 로그인 에러:", e);
      alert("로그인 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.");
    }
  };

  const closeLoginModal = () => setShowLoginModal(false);

  const goHome = () => router.push("/");

  // 타자 효과
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

  const handleNewChatLocalReset = () => {
    setMessages([]);
    setSessionId(null);
    setHasStarted(false);
    setExpandedMessageIds([]);
    setPlayingMessageId(null);
    setStudyState({});
    setActiveStudyMessageId(null);
    audioCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
    audioCacheRef.current.clear();
  };

  const handleDeleteCurrentSession = async () => {
    if (isGuest) {
      handleNewChatLocalReset();
      alert("체험 모드 대화를 초기화했어요.");
      return;
    }

    if (!sessionId) {
      alert("삭제할 대화가 없어요.");
      return;
    }

    const confirmDelete = window.confirm("현재 대화를 DB에서도 완전히 삭제할까요?");
    if (!confirmDelete) return;

    try {
      const accessToken = await getAccessToken();

      const res = await fetch("/api/session/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ sessionId }),
      });

      const data = await res.json().catch(() => null);

      // 🔍 추가 로그
console.log("🔍 /api/session/create-configured 응답", {
  status: res.status,
  data,
});

      if (!res.ok || data?.error) {
        console.error("session/delete error:", data);
        alert("대화를 삭제하는 중 문제가 발생했어요 🥲");
        return;
      }

      handleNewChatLocalReset();
      alert("현재 대화를 깔끔하게 삭제했어요 ✅");
    } catch (e) {
      console.error("session/delete fetch error:", e);
      alert("대화를 삭제하는 중 오류가 발생했어요 🥲");
    }
  };

  // ✅ 학습 모드 시작
  const handleStartStudy = async (message: ChatMessage) => {
    if (isGuest) {
      alert("학습 기능은 로그인 후 사용할 수 있어요 🙂");
      return;
    }

    const messageId = message.id;
    const existing = studyState[messageId];
    if (existing) {
      setActiveStudyMessageId(messageId);
      setIsStudyModalOpen(true);
      return;
    }

    let baseSpanish = "";

    if (message.role === "user" && message.details?.correction) {
      baseSpanish = message.details.correction;
    } else {
      baseSpanish = message.content;
    }

    if (!baseSpanish || !baseSpanish.trim()) {
      alert("학습에 사용할 문장이 없어요.");
      return;
    }

    try {
      setIsStudyLoading(true);

      const accessToken = await getAccessToken();

      const res = await fetch("/api/learning/prepare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          text: baseSpanish,
          sessionId,
          messageId,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data || data.ok === false) {
        console.error("learning/prepare error:", data);
        alert("학습 문장을 준비하는 중 오류가 발생했어요.");
        return;
      }

      setStudyState((prev) => ({
        ...prev,
        [messageId]: {
          cardId: data.cardId ?? null,
          korean: data.korean,
          hint: data.hint,
          baseSpanish,
        },
      }));

      setActiveStudyMessageId(messageId);
      setIsStudyModalOpen(true);
    } catch (e) {
      console.error("handleStartStudy error:", e);
      alert("학습 준비 중 오류가 발생했어요.");
    } finally {
      setIsStudyLoading(false);
    }
  };

  /**
   * ✅ 4단계 설정 완료 후 "대화 시작하기"
   *  - /api/session/create-configured 호출(로그인)
   *  - 게스트: isGuest:true로 보내 DB 저장 없이 인사만 받아오기(백엔드에서 처리)
   *
   *  예상 응답(제안):
   *   { ok: true, sessionId?: string, greeting: string }
   */
  const handleStartConfiguredConversation = async () => {
    if (!selectedLanguage || !selectedLevel || !selectedPersona) {
      alert("언어/수준/페르소나를 모두 선택해 주세요.");
      return;
    }

    setIsCreatingConfiguredSession(true);

    try {
      // 게스트 모드: 세션ID 없이 인사만 받아오기
      if (isGuest) {
        const res = await fetch("/api/session/create-configured", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            language: selectedLanguage,
            level: selectedLevel,
            personaType: selectedPersona,
            isGuest: true,
          }),
        });

        const data = await res.json().catch(() => null);

        if (!res.ok || !data || data.ok === false) {
          console.error("create-configured (guest) error:", data);
          throw new Error("대화 시작 설정에 실패했어요.");
        }

        const greeting: string = data.greeting ?? data.reply ?? "";
        const formattedGreeting = formatAssistantText(greeting);

        setMessages([
          {
            id: makeId(),
            role: "assistant",
            content: "",
          },
        ]);
        startTypewriter(formattedGreeting);
        setHasStarted(true);
        setSessionId(null);
        return;
      }

      // 로그인 사용자: 세션 생성 + 첫 인사
      const accessToken = await getAccessToken();

      const res = await fetch("/api/session/create-configured", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          language: selectedLanguage,
          level: selectedLevel,
          personaType: selectedPersona,
          slot,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data || data.ok === false || !data.sessionId) {
        console.error("create-configured error:", data);
        throw new Error("대화 세션을 만드는 중 오류가 발생했어요.");
      }

      const greeting: string = data.greeting ?? data.reply ?? "";
      const formattedGreeting = formatAssistantText(greeting);

      setSessionId(data.sessionId);

      setMessages([
        {
          id: makeId(),
          role: "assistant",
          content: "",
        },
      ]);
      startTypewriter(formattedGreeting);
      setHasStarted(true);
      setChatFlow("existingSession"); // 이제부터는 '세션 이어가기' 모드로 동작
    } catch (e) {
      console.error("handleStartConfiguredConversation error:", e);
      alert("처음 인사를 불러오는 데 문제가 생겼어요 🥲");
    } finally {
      setIsCreatingConfiguredSession(false);
    }
  };

  // 메시지 보내기
  const handleSend = async () => {
    if (!hasStarted) return;
    if (!input.trim() || isSending) return;

    if (isGuest && guestTrialCount >= 1) {
      setShowLoginModal(true);
      return;
    }

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

    let currentSessionId = sessionId;

    try {
      const accessToken = !isGuest ? await getAccessToken() : null;

      // 로그인 모드인데 세션ID가 없으면 비정상 플로우 → 에러 처리
      if (!isGuest) {
        if (!currentSessionId) {
          console.error("No sessionId in logged-in mode");
          alert("세션 정보가 없어 대화를 이어갈 수 없어요. 홈에서 다시 접속해 주세요.");
          setIsSending(false);
          return;
        }

        // user 메시지 DB 저장
        try {
          const saveUserRes = await fetch("/api/message/add", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            body: JSON.stringify({
              sessionId: currentSessionId,
              role: "user",
              content: trimmed,
            }),
          });

          const saveUserData = await saveUserRes.json().catch(() => null);
          if (!saveUserRes.ok || saveUserData?.ok === false) {
            console.error("message/add (user) error:", saveUserData);
          }
        } catch (saveErr) {
          console.error("message/add (user) fetch error:", saveErr);
        }
      }

      // GPT 응답
      const chatRes = await fetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: newMessages,
          isFirst: false,
          // 백엔드에서 필요 시 language/level/persona는 sessionId로 조회
        }),
      });

      const chatData = await chatRes.json().catch(() => null);
      const fullAssistantText = chatData?.reply ?? "응답을 가져오지 못했어요.";

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

      // assistant 메시지 DB 저장
      if (!isGuest && currentSessionId) {
        try {
          const saveAssistantRes = await fetch("/api/message/add", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            body: JSON.stringify({
              sessionId: currentSessionId,
              role: "assistant",
              content: formatted,
            }),
          });

          const saveAssistantData = await saveAssistantRes.json().catch(() => null);
          if (!saveAssistantRes.ok || saveAssistantData?.ok === false) {
            console.error("message/add (assistant) error:", saveAssistantData);
          }
        } catch (saveErr) {
          console.error("message/add (assistant) fetch error:", saveErr);
        }
      }

      if (isGuest && chatRes.ok) {
        setGuestTrialCount((prev) => prev + 1);
      }
    } catch (e) {
      console.error(e);
      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: "assistant",
          content: "응답을 가져오는 데 문제가 생겼어. 잠시 후 다시 시도해 줘 🙏",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const activeStudyCard: StudyCard | null =
    activeStudyMessageId ? studyState[activeStudyMessageId] ?? null : null;

  // 언어/레벨/페르소나 라벨
  const languageLabel = (code: string | null) => {
    switch (code) {
      case "en":
        return "영어";
      case "zh":
        return "중국어";
      case "ja":
        return "일본어";
      case "es":
        return "스페인어";
      case "fr":
        return "프랑스어";
      case "ru":
        return "러시아어";
      case "ar":
        return "아랍어";
      default:
        return "언어 미지정";
    }
  };

  const levelLabel = (code: string | null) => {
    switch (code) {
      case "beginner":
        return "입문";
      case "elementary":
        return "초급";
      case "intermediate":
        return "중급";
      case "advanced":
        return "고급";
      default:
        return "수준 미지정";
    }
  };

  const personaLabel = (code: string | null) => {
    switch (code) {
      case "friend":
        return "친한 친구";
      case "coworker":
        return "직장 동료";
      case "teacher":
        return "엄격한 선생님";
      case "traveler":
        return "여행 친구";
      default:
        return "페르소나 미지정";
    }
  };

  const renderWizardStep = () => {
    // 1~3단계 공통 버튼 스타일
    const buttonStyle: React.CSSProperties = {
      padding: "10px 12px",
      borderRadius: "999px",
      border: "1px solid #4b5563",
      backgroundColor: "#111827",
      color: "#e5e7eb",
      fontSize: "13px",
      cursor: "pointer",
      whiteSpace: "nowrap",
    };

    const buttonSelectedStyle: React.CSSProperties = {
      ...buttonStyle,
      backgroundColor: "#2563eb",
      borderColor: "#2563eb",
    };

    if (wizardStep === 1) {
      return (
        <div>
          <h3
            style={{
              fontSize: "18px",
              color: "#f9fafb",
              marginBottom: "12px",
            }}
          >
            1단계. 대화할 언어를 선택해 주세요.
          </h3>
          <p
            style={{
              fontSize: "13px",
              color: "#9ca3af",
              marginBottom: "10px",
            }}
          >
            어떤 언어로 대화를 연습하고 싶나요?
          </p>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
              marginBottom: "16px",
            }}
          >
            {[
              { code: "en", label: "영어" },
              { code: "zh", label: "중국어" },
              { code: "ja", label: "일본어" },
              { code: "es", label: "스페인어" },
              { code: "fr", label: "프랑스어" },
              { code: "ru", label: "러시아어" },
              { code: "ar", label: "아랍어" },
            ].map((lang) => (
              <button
                key={lang.code}
                onClick={() => setSelectedLanguage(lang.code)}
                style={
                  selectedLanguage === lang.code ? buttonSelectedStyle : buttonStyle
                }
              >
                {lang.label}
              </button>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "8px",
            }}
          >
            <button
              onClick={() => setWizardStep(2)}
              disabled={!selectedLanguage}
              style={{
                padding: "8px 16px",
                borderRadius: "999px",
                border: "none",
                backgroundColor: selectedLanguage ? "#2563eb" : "#4b5563",
                color: "#f9fafb",
                fontSize: "13px",
                cursor: selectedLanguage ? "pointer" : "not-allowed",
              }}
            >
              다음 단계
            </button>
          </div>
        </div>
      );
    }

    if (wizardStep === 2) {
      return (
        <div>
          <h3
            style={{
              fontSize: "18px",
              color: "#f9fafb",
              marginBottom: "12px",
            }}
          >
            2단계. 나의 현재 수준을 선택해 주세요.
          </h3>
          <p
            style={{
              fontSize: "13px",
              color: "#9ca3af",
              marginBottom: "10px",
            }}
          >
            상대가 어느 정도 난이도로 말해주면 좋을까요?
          </p>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
              marginBottom: "16px",
            }}
          >
            {[
              { code: "beginner", label: "입문 (완전 처음)" },
              { code: "elementary", label: "초급 (기초 문장 조금)" },
              { code: "intermediate", label: "중급 (일상 대화 가능)" },
              { code: "advanced", label: "고급 (자유로운 표현)" },
            ].map((lv) => (
              <button
                key={lv.code}
                onClick={() => setSelectedLevel(lv.code)}
                style={selectedLevel === lv.code ? buttonSelectedStyle : buttonStyle}
              >
                {lv.label}
              </button>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "8px",
            }}
          >
            <button
              onClick={() => setWizardStep(1)}
              style={{
                padding: "8px 16px",
                borderRadius: "999px",
                border: "1px solid #4b5563",
                backgroundColor: "transparent",
                color: "#e5e7eb",
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              이전
            </button>
            <button
              onClick={() => setWizardStep(3)}
              disabled={!selectedLevel}
              style={{
                padding: "8px 16px",
                borderRadius: "999px",
                border: "none",
                backgroundColor: selectedLevel ? "#2563eb" : "#4b5563",
                color: "#f9fafb",
                fontSize: "13px",
                cursor: selectedLevel ? "pointer" : "not-allowed",
              }}
            >
              다음 단계
            </button>
          </div>
        </div>
      );
    }

    if (wizardStep === 3) {
      return (
        <div>
          <h3
            style={{
              fontSize: "18px",
              color: "#f9fafb",
              marginBottom: "12px",
            }}
          >
            3단계. 어떤 스타일의 대화 상대가 좋나요?
          </h3>
          <p
            style={{
              fontSize: "13px",
              color: "#9ca3af",
              marginBottom: "10px",
            }}
          >
            상대의 말투와 역할을 골라보세요.
          </p>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              marginBottom: "16px",
            }}
          >
            {[
              {
                code: "friend",
                title: "친한 친구",
                desc: "편하게 반말처럼 이야기해주는 친구",
              },
              {
                code: "coworker",
                title: "직장 동료",
                desc: "업무·일상 이야기를 나누는 동료",
              },
              {
                code: "teacher",
                title: "엄격한 선생님",
                desc: "틀린 표현을 바로잡아주는 선생님",
              },
              {
                code: "traveler",
                title: "여행 친구",
                desc: "여행·문화 이야기를 좋아하는 친구",
              },
            ].map((p) => (
              <button
                key={p.code}
                onClick={() => setSelectedPersona(p.code)}
                style={
                  selectedPersona === p.code
                    ? {
                        ...buttonSelectedStyle,
                        width: "100%",
                        justifyContent: "flex-start",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: "2px",
                      }
                    : {
                        ...buttonStyle,
                        width: "100%",
                        justifyContent: "flex-start",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: "2px",
                      }
                }
              >
                <span>{p.title}</span>
                <span
                  style={{
                    fontSize: "11px",
                    color: "#d1d5db",
                  }}
                >
                  {p.desc}
                </span>
              </button>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "8px",
            }}
          >
            <button
              onClick={() => setWizardStep(2)}
              style={{
                padding: "8px 16px",
                borderRadius: "999px",
                border: "1px solid #4b5563",
                backgroundColor: "transparent",
                color: "#e5e7eb",
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              이전
            </button>
            <button
              onClick={() => setWizardStep(4)}
              disabled={!selectedPersona}
              style={{
                padding: "8px 16px",
                borderRadius: "999px",
                border: "none",
                backgroundColor: selectedPersona ? "#2563eb" : "#4b5563",
                color: "#f9fafb",
                fontSize: "13px",
                cursor: selectedPersona ? "pointer" : "not-allowed",
              }}
            >
              마지막 단계
            </button>
          </div>
        </div>
      );
    }

    // 4단계 요약 + 시작
    return (
      <div>
        <h3
          style={{
            fontSize: "18px",
            color: "#f9fafb",
            marginBottom: "12px",
          }}
        >
          4단계. 이 설정으로 대화를 시작할까요?
        </h3>
        <p
          style={{
            fontSize: "13px",
            color: "#9ca3af",
            marginBottom: "12px",
          }}
        >
          아래 설정으로 첫 인사를 보낸 뒤, 자유롭게 대화를 이어갈 수 있어요.
        </p>

        <div
          style={{
            backgroundColor: "#111827",
            borderRadius: "12px",
            padding: "10px 12px",
            marginBottom: "16px",
            border: "1px solid #1f2937",
            fontSize: "13px",
            color: "#e5e7eb",
          }}
        >
          <div style={{ marginBottom: "6px" }}>
            <strong>대화 언어</strong> : {languageLabel(selectedLanguage)}
          </div>
          <div style={{ marginBottom: "6px" }}>
            <strong>나의 수준</strong> : {levelLabel(selectedLevel)}
          </div>
          <div>
            <strong>대화 상대</strong> : {personaLabel(selectedPersona)}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "8px",
          }}
        >
          <button
            onClick={() => setWizardStep(3)}
            style={{
              padding: "8px 16px",
              borderRadius: "999px",
              border: "1px solid #4b5563",
              backgroundColor: "transparent",
              color: "#e5e7eb",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            이전
          </button>
          <button
            onClick={handleStartConfiguredConversation}
            disabled={
              !selectedLanguage || !selectedLevel || !selectedPersona || isCreatingConfiguredSession
            }
            style={{
              padding: "8px 16px",
              borderRadius: "999px",
              border: "none",
              backgroundColor:
                !selectedLanguage || !selectedLevel || !selectedPersona || isCreatingConfiguredSession
                  ? "#4b5563"
                  : "#22c55e",
              color: "#f9fafb",
              fontSize: "13px",
              fontWeight: 500,
              cursor:
                !selectedLanguage || !selectedLevel || !selectedPersona || isCreatingConfiguredSession
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {isCreatingConfiguredSession ? "대화 시작 준비 중..." : "이 설정으로 대화 시작하기"}
          </button>
        </div>
      </div>
    );
  };

  const wizardActive =
    (chatFlow === "guestNew" || chatFlow === "newConfigured") && !hasStarted;

  return (
    <>
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* 상단 헤더 */}
        <div
          style={{
            position: "relative",
            marginBottom: "10px",
            minHeight: "32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <button
            onClick={goHome}
            style={{
              position: "absolute",
              left: 0,
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
            ← 홈으로
          </button>

          <h2
            style={{
              fontSize: "20px",
              textAlign: "center",
              margin: 0,
            }}
          >
            
          </h2>

          <button
            onClick={handleDeleteCurrentSession}
            style={{
              position: "absolute",
              right: 0,
              fontSize: "12px",
              padding: "6px 10px",
              borderRadius: "999px",
              border: "1px solid #555",
              backgroundColor: "#111",
              color: "#ffdddd",
              cursor: sessionId || isGuest ? "pointer" : "not-allowed",
              opacity: sessionId || isGuest ? 1 : 0.5,
              whiteSpace: "nowrap",
            }}
            disabled={!sessionId && !isGuest}
          >
            전체 삭제
          </button>
        </div>

        {/* 메인 영역 */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            paddingRight: "4px",
            marginBottom: "12px",
          }}
        >
          {/* 1) 전체 로딩 */}
          {isInitialLoading ? (
            <div
              style={{
                width: "100%",
                padding: "12px 0",
                textAlign: "center",
                fontSize: "14px",
                color: "#9ca3af",
              }}
            >
              준비 중입니다...
            </div>
          ) : chatFlow === "invalid" ? (
            <div
              style={{
                width: "100%",
                padding: "12px 0",
                textAlign: "center",
                fontSize: "14px",
                color: "#fca5a5",
              }}
            >
              잘못된 접근입니다. 메인 화면에서 다시 들어와 주세요.
            </div>
          ) : wizardActive ? (
            // 2) 새 세션 설정 위저드
            <div
              style={{
                padding: "8px 4px",
              }}
            >
              {renderWizardStep()}
            </div>
          ) : chatFlow === "existingSession" && isMessagesLoading ? (
            // 3) 기존 세션 메시지 로딩
            <div
              style={{
                width: "100%",
                padding: "12px 0",
                textAlign: "center",
                fontSize: "14px",
                color: "#9ca3af",
              }}
            >
              대화 내역을 불러오는 중입니다...
            </div>
          ) : chatFlow === "existingSession" && messagesError ? (
            <div
              style={{
                width: "100%",
                padding: "12px 0",
                textAlign: "center",
                fontSize: "14px",
                color: "#fca5a5",
              }}
            >
              {messagesError}
            </div>
          ) : (
            // 4) 실제 메시지 목록
            <>
              {messages.map((msg) => {
                const isUserMsg = msg.role === "user";
                const isAssistant = msg.role === "assistant";
                const isExpanded = expandedMessageIds.includes(msg.id);
                const hasDetails = !!msg.details && !msg.detailsError;

                return (
                  <div
                    key={msg.id}
                    style={{
                      display: "flex",
                      justifyContent: isUserMsg ? "flex-end" : "flex-start",
                      marginBottom: "8px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: isUserMsg ? "flex-end" : "flex-start",
                        maxWidth: "75%",
                        gap: "6px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          alignSelf: isUserMsg ? "flex-end" : "flex-start",
                        }}
                      >
                        {/* 내 말 */}
                        {isUserMsg && (
                          <>
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

                            <button
                              onClick={() => handleStartStudy(msg)}
                              style={{
                                fontSize: "14px",
                                padding: "4px 8px",
                                borderRadius: "999px",
                                border: "1px solid #555",
                                backgroundColor: "#111",
                                color: "white",
                                cursor: isStudyLoading ? "not-allowed" : "pointer",
                              }}
                              disabled={isStudyLoading}
                              aria-label="학습 모드 열기"
                            >
                              📘
                            </button>
                          </>
                        )}

                        {/* 말풍선 */}
                        <div
                          style={{
                            backgroundColor: isUserMsg ? "#2563eb" : "#222",
                            color: "white",
                            padding: "10px 14px",
                            borderRadius: "12px",
                            whiteSpace: "pre-wrap",
                            fontSize: "14px",
                          }}
                        >
                          {msg.content}
                        </div>

                        {/* GPT 말 */}
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
                              onClick={() => handleStartStudy(msg)}
                              style={{
                                fontSize: "14px",
                                padding: "4px 8px",
                                borderRadius: "999px",
                                border: "1px solid #555",
                                backgroundColor: "#111",
                                color: "white",
                                cursor: isStudyLoading ? "not-allowed" : "pointer",
                              }}
                              disabled={isStudyLoading}
                              aria-label="학습 모드 열기"
                            >
                              📘
                            </button>

                            <button
                              onClick={() => handlePlayTTS(msg)}
                              style={{
                                fontSize: "16px",
                                padding: "4px 8px",
                                borderRadius: "999px",
                                border: "1px solid #555",
                                backgroundColor: "#111",
                                color: "white",
                                cursor: "pointer",
                              }}
                              aria-label={
                                playingMessageId === msg.id
                                  ? "문장 정지"
                                  : "문장 듣기"
                              }
                            >
                              {playingMessageId === msg.id ? "⏹️" : "▶️"}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* 상세 영역 */}
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
                                  isUserMsg
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
                              {isUserMsg && msg.details?.correction && (
                                <div style={{ marginBottom: "6px" }}>
                                  <strong>0. 문장 교정</strong>
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
                                <strong>3. 문법 설명</strong>
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
            </>
          )}
        </div>

        {/* 아래 입력/버튼 영역 */}
        {!wizardActive && chatFlow !== "invalid" && (
          <div
            style={{
              borderTop: "1px solid #333",
              paddingTop: "8px",
            }}
          >
            {hasStarted ? (
              <>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="(Enter: 전송, Shift+Enter: 줄바꿈)"
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
                    fontSize: "13px",
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
            ) : (
              <div
                style={{
                  width: "100%",
                  padding: "3px 0",
                  textAlign: "center",
                  fontSize: "14px",
                  color: "#9ca3af",
                }}
              >
                위에서 설정을 마치고 대화를 시작해 주세요.
              </div>
            )}

            <p
              style={{
                marginTop: "8px",
                fontSize: "11px",
                color: "#9ca3af",
                textAlign: "center",
                lineHeight: 1.5,
                whiteSpace: "pre-line",
              }}
            >
              {
                "⚠️ 민감한 개인정보는 입력하지 말아 주세요."
              }
            </p>
          </div>
        )}
      </div>

      {/* 게스트 2회 초과 시 로그인 모달 */}
      {showLoginModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.7)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 50,
          }}
        >
          <div
            style={{
              backgroundColor: "#111827",
              padding: "24px 28px",
              borderRadius: "16px",
              width: "320px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
              position: "relative",
            }}
          >
            <button
              onClick={closeLoginModal}
              style={{
                position: "absolute",
                top: "8px",
                right: "8px",
                border: "none",
                background: "transparent",
                color: "#9ca3af",
                fontSize: "18px",
                cursor: "pointer",
              }}
            >
              ×
            </button>

            <h2
              style={{
                color: "#f9fafb",
                fontSize: "18px",
                marginBottom: "8px",
              }}
            >
              로그인을 하고 더 사용해보세요
            </h2>
            <p
              style={{
                color: "#9ca3af",
                fontSize: "14px",
                marginBottom: "16px",
              }}
            >
              지금은 체험 모드라 대화를
              <br />
              최대 2회까지만 사용할 수 있어요.
              <br />
              계속 사용하려면 Google 로그인이 필요해요.
            </p>

            <button
              onClick={loginWithGoogle}
              style={{
                width: "100%",
                padding: "10px 16px",
                borderRadius: "999px",
                border: "none",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 500,
                backgroundColor: "#ffffff",
                color: "#111827",
              }}
            >
              Google로 로그인
            </button>
          </div>
        </div>
      )}

      {/* 📚 학습 모달 */}
      <StudyModal
        isOpen={isStudyModalOpen}
        onClose={() => {
          setIsStudyModalOpen(false);
        }}
        card={activeStudyCard}
        sessionId={sessionId}
        messageId={activeStudyMessageId}
        canUseTTS={!isGuest}
      />
    </>
  );
}

type StudyModalProps = {
  isOpen: boolean;
  onClose: () => void;
  card: StudyCard | null;
  sessionId: string | null;
  messageId: string | null;
  canUseTTS: boolean;
};

function StudyModal({
  isOpen,
  onClose,
  card,
  sessionId,
  messageId,
  canUseTTS,
}: StudyModalProps) {
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

  // 모달 닫힐 때 상태 초기화
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
      alert(
        "학습 카드 정보가 없어 피드백을 가져올 수 없어요.\n다시 학습 버튼을 눌러 준비해 주세요."
      );
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
        console.error("learning/answer error:", await res.json().catch(() => ({})));
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

  // 🔊 학습 모달 안 TTS
  const handlePlayTTS = async () => {
    if (!canUseTTS) {
      alert("TTS는 로그인 후 사용할 수 있어요 🙂");
      return;
    }

    if (!sessionId) {
      alert("세션 정보가 없어 음성을 재생할 수 없어요 🥲");
      return;
    }

    if (!messageId) {
      alert("메시지 정보가 없어 음성을 재생할 수 없어요 🥲");
      return;
    }

    if (!card.baseSpanish || !card.baseSpanish.trim()) {
      alert("재생할 문장이 없어요.");
      return;
    }

    const audioId = `${sessionId}/${messageId}`;

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

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: card.baseSpanish,
          audioId,
        }),
      });

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
        {/* 헤더 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px",
          }}
        >
          <h2
            style={{
              color: "#f9fafb",
              fontSize: "18px",
              fontWeight: 600,
              margin: 0,
            }}
          >
            학습 모드
          </h2>
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

        {/* 한국어 문장 + 힌트 */}
        <div style={{ marginBottom: "12px" }}>
          <p
            style={{
              fontSize: "13px",
              color: "#e5e7eb",
              marginBottom: "4px",
            }}
          >
            한국어 문장
          </p>
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
          {card.hint && (
            <p
              style={{
                marginTop: "6px",
                fontSize: "12px",
                color: "#9ca3af",
              }}
            >
              힌트: {card.hint}
            </p>
          )}
        </div>

        {/* 스페인어 TTS 버튼 */}
        <div
          style={{
            marginBottom: "12px",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
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

        {/* 내가 적는 문장 */}
        <div style={{ marginBottom: "12px" }}>
          <p
            style={{
              fontSize: "13px",
              color: "#e5e7eb",
              marginBottom: "4px",
            }}
          >
            배운 언어로 다시 써보기
          </p>
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

        {/* GPT 피드백 */}
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
              <span>{feedback.correct_answer}</span>
            </div>
            <div style={{ marginBottom: "4px" }}>
              <strong>TIP: </strong>
              <span>{feedback.tip}</span>
            </div>
            <div
              style={{
                marginTop: "4px",
                fontSize: "11px",
                color: "#9ca3af",
              }}
            >
              채점 결과:{" "}
              {feedback.is_correct ? "거의 정답이에요! 👏" : "조금 더 연습해보자 🙂"}
            </div>
          </div>
        )}

        {/* 버튼들 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "4px",
          }}
        >
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
              cursor:
                isSubmitting || !answer.trim() ? "not-allowed" : "pointer",
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
