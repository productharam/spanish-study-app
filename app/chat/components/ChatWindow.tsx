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
  details?: MessageDetails; // ✅ 더보기 내용
  isDetailsLoading?: boolean; // ✅ 더보기 로딩 상태
  detailsError?: boolean; // ✅ 더보기 불러오기 실패 여부
};

// ✅ 메시지 1개당 학습 카드 정보
type StudyCard = {
  cardId: string | null;
  korean: string;
  hint?: string;
  // 학습에 사용한 기준 스페인어 문장 (TTS에 사용)
  baseSpanish: string;
};

// ✅ messageId -> StudyCard 매핑
type StudyState = Record<string, StudyCard>;

export default function ChatWindow() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const typingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [expandedMessageIds, setExpandedMessageIds] = useState<string[]>([]);

  // 🔊 TTS 관련 상태 & 캐시
  const audioCacheRef = useRef<Map<string, string>>(new Map());
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const typingSpeed = 20; // ms 단위, 숫자 낮출수록 더 빨리 타이핑됨
  const makeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // ✅ 대화 시작 여부 & 첫 인사 로딩 상태
  const [hasStarted, setHasStarted] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  // ✅ /chat 첫 진입 시, 이전 대화 불러오는 동안 상태
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  // ✅ Supabase 세션 ID (가장 최근 or 새로 만든 세션)
  const [sessionId, setSessionId] = useState<string | null>(null);

  // ✅ 로그인 / 게스트 체험 관련
  const [user, setUser] = useState<any | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [guestTrialCount, setGuestTrialCount] = useState(0); // 🔄 이제 메모리로만 관리
  const [showLoginModal, setShowLoginModal] = useState(false);

  // ✅ 학습 상태: 메시지별 학습 카드 캐시
  const [studyState, setStudyState] = useState<StudyState>({});
  const [isStudyModalOpen, setIsStudyModalOpen] = useState(false);
  const [activeStudyMessageId, setActiveStudyMessageId] =
    useState<string | null>(null);
  const [isStudyLoading, setIsStudyLoading] = useState(false);

  // 🔐 브라우저 Supabase 세션에서 access token 가져오기
  const getAccessToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  };

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
   * ✅ 처음 진입할 때:
   *  1) Supabase로 현재 유저 확인
   *  2) 게스트 모드 판단 (로그인 X or mode=guest)
   *  3) 로그인 모드일 때만 가장 최근 세션 + 메시지 불러오기
   */
  useEffect(() => {
    const init = async () => {
      setIsInitialLoading(true); // 🔥 /chat 들어오자마자 "대화내역 확인중" 상태 시작

      try {
        const { data } = await supabase.auth.getUser();
        const currentUser = data.user ?? null;
        setUser(currentUser);

        const mode = searchParams.get("mode");
        const guestMode = !currentUser || mode === "guest";
        setIsGuest(guestMode);

        if (guestMode) {
          // 🔄 게스트 모드에서는 항상 0에서 시작 → /chat 나갔다 오면 다시 2회 체험 가능
          setGuestTrialCount(0);

          // 게스트 모드에서는 DB에서 이전 대화 불러오지 않음
          setMessages([]);
          setSessionId(null);
          setHasStarted(false); // 🔴 항상 새 대화 모드
          return; // ↩️ finally에서 isInitialLoading=false 됨
        }

        // 🔐 로그인된 상태 → 가장 최근 세션 + 메시지 불러오기
        const accessToken = await getAccessToken();
        const res = await fetch("/api/session/latest", {
          headers: accessToken
            ? { Authorization: `Bearer ${accessToken}` }
            : {},
        });

        const dataLatest = await res.json();

        if (!res.ok || !dataLatest.ok) {
          console.error("latest session load error:", dataLatest.error);
          // 에러가 나면 "이전 대화 없음"으로 간주 → Juan에게 인사하기 버튼 노출
          setMessages([]);
          setSessionId(null);
          setHasStarted(false);
          return;
        }

        if (dataLatest.session && dataLatest.messages?.length) {
          const restored: ChatMessage[] = dataLatest.messages.map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            details: m.details ?? undefined,
            isDetailsLoading: false,
            detailsError: false,
          }));

          setMessages(restored);
          setSessionId(dataLatest.session.id);
          setHasStarted(true); // ✅ 이전 대화가 있으니 바로 "보내기" 모드
        } else {
          // 세션 없거나 메시지가 0개 → 처음 온 것처럼 처리
          setMessages([]);
          setSessionId(null);
          setHasStarted(false);
        }
      } catch (e) {
        console.error("init (auth + latest session) error:", e);
        // 오류시에도 일단 새 대화 모드로
        setMessages([]);
        setSessionId(null);
        setHasStarted(false);
      } finally {
        setIsInitialLoading(false); // 🔥 어떤 경우든 로딩 종료
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
        body: JSON.stringify({ text, sessionId }),
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
        body: JSON.stringify({ text, sessionId }),
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
      // 게스트 모드에서는 TTS 사용 안 함
      if (isGuest) return;

      // ✅ 0. 이미 이 메시지가 재생 중이면 → 정지(토글)
      if (playingMessageId === message.id && currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
        currentAudioRef.current = null;
        setPlayingMessageId(null);
        return;
      }

      // ✅ 1. 다른 오디오가 재생 중이면 먼저 정지
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
        currentAudioRef.current = null;
        setPlayingMessageId(null);
      }

      // 2️⃣ 캐시에 URL이 있으면 그대로 재생
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

      // 3️⃣ 캐시에 없으면 서버에 요청
      if (!sessionId) {
        alert("세션 정보가 없어서 음성을 재생할 수 없어요 🥲");
        return;
      }

      // ✅ 공통 오디오 키: "세션ID/메시지ID"  → Supabase에서 세션별 폴더처럼 보임
      const audioId = `${sessionId}/${message.id}`;

      setPlayingMessageId(message.id);

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: message.content,
          audioId, // ✅ sessionId 대신 audioId 전달
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        console.error("TTS 요청 실패:", data);
        throw new Error("TTS 요청 실패");
      }

      const data = await res.json();
      const url = data.url as string | undefined;

      if (!url) {
        throw new Error("TTS URL이 응답에 없어요");
      }

      // 4️⃣ 캐시에 저장 후 재생 (프론트 캐시: message.id 기준)
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

  // 🔐 Google 로그인 (로그인 모달에서 사용)
  const loginWithGoogle = async () => {
    try {
      const origin =
        typeof window !== "undefined"
          ? window.location.origin
          : "http://localhost:3000";

      const redirectTo = `${origin}/chat`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
        },
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

  const closeLoginModal = () => {
    setShowLoginModal(false);
  };

  const goHome = () => {
    router.push("/");
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

  const handleNewChat = () => {
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
    console.log("Deleting session id:", sessionId);

    if (isGuest) {
      handleNewChat();
      alert("체험 모드 대화를 초기화했어요.");
      return;
    }

    if (!sessionId) {
      alert("삭제할 대화가 없어요.");
      return;
    }

    const confirmDelete = window.confirm(
      "현재 대화를 DB에서도 완전히 삭제할까요?"
    );
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

      const data = await res.json();
      if (!res.ok || data.error) {
        console.error("session/delete error:", data);
        alert("대화를 삭제하는 중 문제가 발생했어요 🥲");
        return;
      }

      handleNewChat();
      alert("현재 대화를 깔끔하게 삭제했어요 ✅");
    } catch (e) {
      console.error("session/delete fetch error:", e);
      alert("대화를 삭제하는 중 오류가 발생했어요 🥲");
    }
  };

  // ✅ 학습 모드 시작 (메시지 단위 캐시)
  const handleStartStudy = async (message: ChatMessage) => {
    if (isGuest) {
      alert("학습 기능은 로그인 후 사용할 수 있어요 🙂");
      return;
    }

    const messageId = message.id;

    // 0️⃣ 이미 이 메시지에 대한 학습 카드가 있다면 → API 호출 없이 모달만 열기
    const existing = studyState[messageId];
    if (existing) {
      setActiveStudyMessageId(messageId);
      setIsStudyModalOpen(true);
      return;
    }

    // 1️⃣ 기준 스페인어 문장 선택
    let baseSpanish = "";

    if (message.role === "user" && message.details?.correction) {
      baseSpanish = message.details.correction;
    } else {
      baseSpanish = message.content;
    }

    if (!baseSpanish || !baseSpanish.trim()) {
      alert("학습에 사용할 스페인어 문장이 없어요.");
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

      // ✅ 메시지별 학습 카드 캐시
      setStudyState((prev) => ({
        ...prev,
        [messageId]: {
          cardId: data.cardId ?? null,
          korean: data.korean,
          hint: data.hint,
          baseSpanish, // ✅ TTS용 기준 스페인어 저장
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

  // ✅ 버튼을 눌렀을 때 Juan이 먼저 인사
  const handleStartConversation = async () => {
    if (isStarting) return;

    setIsStarting(true);

    try {
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

      if (isGuest) {
        setMessages([
          {
            id: makeId(),
            role: "assistant",
            content: "",
          },
        ]);
        startTypewriter(formattedGreeting);
        setHasStarted(true);
      } else {
        const accessToken = await getAccessToken();

        const createRes = await fetch("/api/session/create-greeting", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            greeting: formattedGreeting,
          }),
        });

        const createData = await createRes.json();

        if (!createRes.ok || !createData.sessionId) {
          console.error("create-greeting error:", createData);
          throw new Error(
            createData.error || "Failed to create greeting session"
          );
        }

        setSessionId(createData.sessionId);

        setMessages([
          {
            id: makeId(),
            role: "assistant",
            content: "",
          },
        ]);

        startTypewriter(formattedGreeting);
        setHasStarted(true);
      }
    } catch (e) {
      console.error(e);
      setMessages([
        {
          id: makeId(),
          role: "assistant",
          content: "처음 인사 불러오는데 문제가 생겼어 🥲",
        },
      ]);
      setHasStarted(true);
    } finally {
      setIsStarting(false);
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

      if (!isGuest) {
        if (!currentSessionId) {
          const createRes = await fetch("/api/session/create", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            body: JSON.stringify({
              firstMessage: trimmed,
            }),
          });

          const createData = await createRes.json();

          if (!createRes.ok || !createData.sessionId) {
            console.error("session/create error:", createData);
            alert(
              "대화 세션을 만드는 중 오류가 발생했어. 잠시 후 다시 시도해줘."
            );
            setIsSending(false);
            return;
          }

          currentSessionId = createData.sessionId as string;
          setSessionId(currentSessionId);
        } else {
          try {
            const saveUserRes = await fetch("/api/message/add", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(accessToken
                  ? { Authorization: `Bearer ${accessToken}` }
                  : {}),
              },
              body: JSON.stringify({
                sessionId: currentSessionId,
                role: "user",
                content: trimmed,
              }),
            });

            const saveUserData = await saveUserRes.json();
            if (!saveUserRes.ok || saveUserData.ok === false) {
              console.error("message/add (user) error:", saveUserData.error);
            }
          } catch (saveErr) {
            console.error("message/add (user) fetch error:", saveErr);
          }
        }
      }

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

          const saveAssistantData = await saveAssistantRes.json();
          if (!saveAssistantRes.ok || saveAssistantData.ok === false) {
            console.error(
              "message/add (assistant) error:",
              saveAssistantData.error
            );
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
          content:
            "응답을 가져오는 데 문제가 생겼어. 잠시 후 다시 시도해 줘 🙏",
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

  return (
    <>
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
              ← 메인으로
            </button>

            <h2
              style={{
                fontSize: "20px",
                textAlign: "center",
                margin: 0,
              }}
            >
              Juan과의 대화
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
              현재 대화 삭제
            </button>
          </div>

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
                  {/* 말풍선 + 버튼들 한 줄 */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      alignSelf: isUserMsg ? "flex-end" : "flex-start",
                    }}
                  >
                    {/* 내 말풍선 */}
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

                    {/* GPT 말풍선 */}
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
                          aria-label={
                            isExpanded ? "상세 접기" : "상세 더보기"
                          }
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

                        {!isGuest && (
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
                                ? "스페인어 문장 정지"
                                : "스페인어 문장 듣기"
                            }
                          >
                            {playingMessageId === msg.id ? "⏹️" : "▶️"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 아래 펼쳐지는 상세 영역 */}
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
          {isInitialLoading ? (
            // 1️⃣ /chat 진입 직후: 이전 대화 확인 중
            <div
              style={{
                width: "100%",
                padding: "12px 0",
                textAlign: "center",
                fontSize: "14px",
                color: "#9ca3af",
              }}
            >
              대화내역을 확인중입니다...
            </div>
          ) : !hasStarted ? (
            // 2️⃣ 이전 대화 없음 → Juan 인사 버튼
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
            // 3️⃣ 이전 대화 있음 → 입력창 + 보내기 버튼
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
              "⚠️ 민감한 개인정보(실명, 연락처, 계좌번호, 건강정보 등)는 입력하지 말아 주세요.\nAI 답변은 틀릴 수 있으니 중요한 내용은 꼭 다시 확인해 주세요."
            }
          </p>
        </div>
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
              지금은 체험 모드라 Juan과의 대화를
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

  // 🔥 모달이 닫힐 때마다 입력/피드백/TTS 상태 모두 초기화
  useEffect(() => {
    if (!isOpen) {
      // 입력/피드백 리셋
      setAnswer("");
      setFeedback(null);

      // TTS 상태 리셋
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
        console.error(
          "learning/answer error:",
          await res.json().catch(() => ({}))
        );
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

  // 🔊 학습 모달 안 TTS 재생
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
      alert("재생할 스페인어 문장이 없어요.");
      return;
    }

    // ✅ /chat TTS와 동일한 규칙으로 audioId 생성 (세션별 폴더)
    const audioId = `${sessionId}/${messageId}`;

    try {
      // 이미 재생 중이면 정지 (토글)
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current.currentTime = 0;
        ttsAudioRef.current = null;
        setIsPlaying(false);
        return;
      }

      setIsTtsLoading(true);

      // 이미 받아둔 URL이 있으면 그대로 재생
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
          audioId, // ✅ /chat에서 TTS 한 파일과 동일한 key
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

        {/* 🔊 스페인어 TTS 버튼 */}
        {canUseTTS && (
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
              aria-label="스페인어 문장 듣기"
            >
              {isTtsLoading ? "…" : isPlaying ? "⏹️" : "▶️"}
            </button>
          </div>
        )}

        {/* 내가 적는 스페인어 문장 */}
        <div style={{ marginBottom: "12px" }}>
          <p
            style={{
              fontSize: "13px",
              color: "#e5e7eb",
              marginBottom: "4px",
            }}
          >
            스페인어로 다시 써보기
          </p>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={2}
            placeholder="여기에 스페인어로 문장을 적어주세요."
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
              <strong>네이티브 TIP: </strong>
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
