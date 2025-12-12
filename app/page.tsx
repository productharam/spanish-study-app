// app/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import type { User } from "@supabase/supabase-js";

type SessionSummary = {
  id: string;
  slot: number | null;
  title: string | null;
  language: string | null;
  level: string | null;
  persona_type: string | null;
  created_at: string;
};

type SlotInfo = {
  slot: 1 | 2 | 3;
  session: SessionSummary | null;
};

export default function Home() {
  const router = useRouter();

  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [slots, setSlots] = useState<SlotInfo[]>([
    { slot: 1, session: null },
    { slot: 2, session: null },
    { slot: 3, session: null },
  ]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(
    null
  );

  // ✅ 세션 카드가 “완전히 준비됐는지” 여부
  const [isSlotsReady, setIsSlotsReady] = useState(false);

  // ✅ 화면 폭에 따라 가로/세로 배치 전환
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      // 여기 기준 너가 원하는 데 맞춰서 768, 900 등으로 조절 가능
      setIsNarrow(window.innerWidth < 900);
    };

    handleResize(); // 첫 렌더 후 한 번 체크
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ✅ 유저 상태 로드
  useEffect(() => {
    const loadUser = async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data.user ?? null);
    };

    loadUser();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  // ✅ 로그인된 경우에만 세션 목록 3개 로드
  useEffect(() => {
    const loadSessions = async () => {
      // 비로그인: 세션 필요 없음
      if (!user) {
        setSlots([
          { slot: 1, session: null },
          { slot: 2, session: null },
          { slot: 3, session: null },
        ]);
        setIsSlotsReady(true);
        return;
      }

      setIsLoadingSessions(true);
      setIsSlotsReady(false); // 세션 새로 가져오는 동안은 스켈레톤 모드

      try {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token ?? null;

        const res = await fetch("/api/sessions", {
          method: "GET",
          headers: accessToken
            ? {
                Authorization: `Bearer ${accessToken}`,
              }
            : {},
        });

        const json = await res.json().catch(() => null);

        if (!res.ok || !json || json.ok === false) {
          console.error("/api/sessions error:", json);
          return;
        }

        const sessions: SessionSummary[] = json.sessions ?? [];

        // slot 컬럼이 있다고 가정하고 1,2,3에 매핑
        const slotMap: Record<number, SessionSummary> = {};
        for (const s of sessions) {
          if (!s.slot) continue;
          if (s.slot < 1 || s.slot > 3) continue;
          if (!slotMap[s.slot]) {
            slotMap[s.slot] = s;
          }
        }

        setSlots([
          { slot: 1, session: slotMap[1] ?? null },
          { slot: 2, session: slotMap[2] ?? null },
          { slot: 3, session: slotMap[3] ?? null },
        ]);
      } catch (e) {
        console.error("loadSessions error:", e);
      } finally {
        setIsLoadingSessions(false);
        setIsSlotsReady(true); // 세션 데이터 준비 완료
      }
    };

    if (user) {
      loadSessions();
    } else if (user === null) {
      // 비로그인
      setSlots([
        { slot: 1, session: null },
        { slot: 2, session: null },
        { slot: 3, session: null },
      ]);
      setIsSlotsReady(true);
    }
  }, [user]);

  const isUserLoading = user === undefined;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  // ✅ 카드 클릭: 세션 이어하기 / 새로 시작하기
  const handleCardClick = (slot: number, session: SessionSummary | null) => {
    if (!user) {
      // 로그인 안 되어 있으면 로그인 페이지로
      router.push("/login");
      return;
    }

    if (session) {
      // 기존 세션 이어하기
      router.push(`/chat?sessionId=${session.id}`);
    } else {
      // 새 세션 시작 (슬롯 지정 + 새로 생성 플래그)
      router.push(`/chat?slot=${slot}&new=1`);
    }
  };

  // ✅ 세션 삭제
  const handleDeleteSession = async (session: SessionSummary) => {
    if (!user) return;

    const ok = window.confirm("이 대화 세션을 완전히 삭제할까요?");
    if (!ok) return;

    try {
      setDeletingSessionId(session.id);

      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token ?? null;

      const res = await fetch("/api/session/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ sessionId: session.id }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || json?.error) {
        console.error("/api/session/delete error:", json);
        alert("세션 삭제 중 문제가 발생했어요 🥲");
        return;
      }

      // 삭제 후 로컬 슬롯에서 해당 세션 제거
      setSlots((prev) =>
        prev.map((s) =>
          s.session?.id === session.id ? { ...s, session: null } : s
        )
      );
    } catch (e) {
      console.error("handleDeleteSession error:", e);
      alert("세션 삭제 중 오류가 발생했어요 🥲");
    } finally {
      setDeletingSessionId(null);
    }
  };

  // ✅ config 텍스트 꾸미기 (언어/레벨/페르소나)
  const formatConfigLabel = (session: SessionSummary | null) => {
    if (!session) return "아직 설정된 정보가 없어요";

    const lang = session.language || "언어 미지정";
    const level = session.level || "레벨 미지정";
    const persona = session.persona_type || "페르소나 미지정";

    return `${lang} · ${level} · ${persona}`;
  };

  // ✅ 언어 코드 기준으로 제목 표시
  const languageTitle = (session: SessionSummary | null) => {
    if (!session) return "아직 대화를 시작하지 않았어요";

    switch (session.language) {
      case "es":
        return "스페인어 대화";
      case "en":
        return "영어 대화";
      case "ja":
        return "일본어 대화";
      case "zh":
        return "중국어 대화";
      case "fr":
        return "프랑스어 대화";
      case "ru":
        return "러시아어 대화";
      case "ar":
        return "아랍어 대화";
      default:
        return "다국어 대화";
    }
  };

  // 카드 공통 스타일에서, 가로/세로에 따라 달라지는 부분만 분기
  const getCardLayoutStyle = () =>
    isNarrow
      ? {
          width: "100%",
        }
      : {
          flex: "1 1 0",
          minWidth: "0",
          maxWidth: "320px",
        };

    return (
    <main
      style={{
        // height: "100vh",          // ❌ 이건 지우고
        minHeight: "100vh",          // ✅ 스크롤 가능하게
        display: "flex",
        justifyContent: "center",
        alignItems: isNarrow ? "flex-start" : "center", // ✅ 모바일은 위정렬
        backgroundColor: "#000000",
        padding: isNarrow ? "32px 16px 16px" : "16px",  // ✅ 모바일은 위쪽 여백 +16
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "960px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          alignItems: "center",
        }}
      >
        {/* 상단 헤더 영역 */}
<div
  style={{
    width: "100%",
    display: "flex",
    flexDirection: isNarrow ? "column" : "row",   // ✅ 좁으면 세로로
    justifyContent: isNarrow ? "flex-start" : "space-between",
    alignItems: isNarrow ? "flex-start" : "center",
    gap: isNarrow ? 12 : 0,                       // 위아래 간격
  }}
>
          <div>
            <h1
              style={{
                color: "#f9fafb",
                fontSize: "24px",
                marginBottom: "4px",
              }}
            >
              다국어 대화 연습
            </h1>
            <p
              style={{
                color: "#9ca3af",
                fontSize: "13px",
                margin: 0,
              }}
            >
              영어 · 스페인어 · 일본어 등 여러 언어로
              <br />
              친구, 직장동료와 대화하듯 연습해 보세요.
            </p>
          </div>

          <div>
            {isUserLoading ? (
              <span style={{ color: "#9ca3af", fontSize: "13px" }}>
                사용자 정보를 불러오는 중...
              </span>
            ) : user ? (
  <div
    style={{
      display: "flex",
      flexDirection: isNarrow ? "row" : "column",   // ✅ 좁으면 가로로 나란히
      alignItems: isNarrow ? "center" : "flex-end",
      justifyContent: isNarrow ? "space-between" : "flex-end",
      gap: isNarrow ? 8 : 4,
      width: isNarrow ? "100%" : "auto",           // 좁을 땐 전체 폭 사용
    }}
  >
    <span
      style={{
        color: "#e5e7eb",
        fontSize: "13px",
        wordBreak: "break-all",                    // 긴 이메일 줄바꿈
      }}
    >
      {user.email} 님
    </span>
    <button
      onClick={handleLogout}
      style={{
        padding: "6px 12px",
        fontSize: "12px",
        borderRadius: "999px",
        border: "1px solid #4b5563",
        cursor: "pointer",
        backgroundColor: "transparent",
        color: "#e5e7eb",
      }}
    >
      로그아웃
    </button>
  </div>
) : (
              <button
                onClick={() => router.push("/login")}
                style={{
                  padding: "8px 16px",
                  fontSize: "13px",
                  borderRadius: "999px",
                  border: "1px solid #4b5563",
                  cursor: "pointer",
                  backgroundColor: "transparent",
                  color: "#e5e7eb",
                }}
              >
                로그인
              </button>
            )}
          </div>
        </div>

        {/* 비로그인 상태: 체험 / 로그인 버튼 유지 */}
        {!isUserLoading && !user && (
          <div
            style={{
              marginTop: "8px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <p
              style={{
                color: "#9ca3af",
                fontSize: "14px",
                textAlign: "center",
              }}
            >
              로그인 없이 가볍게 체험하거나,
              <br />
              로그인 후 대화 기록을 저장할 수 있어요.
            </p>

            <div
              style={{
                display: "flex",
                gap: "12px",
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <button
                onClick={() => router.push("/chat?mode=guest")}
                style={{
                  padding: "14px 28px",
                  fontSize: "16px",
                  borderRadius: "12px",
                  border: "none",
                  cursor: "pointer",
                  boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
                  backgroundColor: "#22c55e",
                  color: "#ffffff",
                  minWidth: "200px",
                }}
              >
                대화 체험하기
              </button>

              <button
                onClick={() => router.push("/login")}
                style={{
                  padding: "12px 24px",
                  fontSize: "15px",
                  borderRadius: "999px",
                  border: "1px solid #4b5563",
                  cursor: "pointer",
                  backgroundColor: "transparent",
                  color: "#e5e7eb",
                  minWidth: "200px",
                }}
              >
                로그인 후 사용하기
              </button>
            </div>
          </div>
        )}

        {/* 로그인 상태: 3개 세션 카드 */}
        {!isUserLoading && user && (
          <div
            style={{
              width: "100%",
              marginTop: "8px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px",
              }}
            >
              <h2
                style={{
                  color: "#f9fafb",
                  fontSize: "18px",
                  margin: 0,
                }}
              >
                나의 대화 세션
              </h2>
              {isLoadingSessions && (
                <span
                  style={{
                    color: "#9ca3af",
                    fontSize: "12px",
                  }}
                >
                  세션을 불러오는 중...
                </span>
              )}
            </div>

            {/* ✅ 세션 준비 전: 스켈레톤 카드 */}
            {!isSlotsReady ? (
              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  flexDirection: isNarrow ? "column" : "row",
                  flexWrap: isNarrow ? "nowrap" : "wrap",
                }}
              >
                {[1, 2, 3].map((slot) => (
                  <div
                    key={slot}
                    style={{
                      ...getCardLayoutStyle(),
                      backgroundColor: "#111827",
                      borderRadius: "16px",
                      padding: "16px",
                      border: "1px solid #1f2937",
                      boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <div
                      style={{
                        width: "50%",
                        height: "14px",
                        borderRadius: "999px",
                        backgroundColor: "#1f2937",
                      }}
                    />
                    <div
                      style={{
                        width: "80%",
                        height: "18px",
                        borderRadius: "8px",
                        backgroundColor: "#1f2937",
                      }}
                    />
                    <div
                      style={{
                        width: "70%",
                        height: "14px",
                        borderRadius: "8px",
                        backgroundColor: "#1f2937",
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  flexDirection: isNarrow ? "column" : "row",
                  flexWrap: isNarrow ? "nowrap" : "wrap",
                }}
              >
                {slots.map(({ slot, session }) => {
                  const isDeleting =
                    !!(session && deletingSessionId === session.id);

                  return (
                    <div
                      key={slot}
                      style={{
                        ...getCardLayoutStyle(),
                        backgroundColor: "#111827",
                        borderRadius: "16px",
                        padding: "16px",
                        border: "1px solid #1f2937",
                        boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        gap: "8px",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: "6px",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "13px",
                              color: "#9ca3af",
                            }}
                          >
                            세션 {slot}
                          </span>
                          {session && (
                            <span
                              style={{
                                fontSize: "11px",
                                color: "#6b7280",
                              }}
                            >
                              최근 사용:{" "}
                              {new Date(
                                session.created_at
                              ).toLocaleDateString("ko-KR")}
                            </span>
                          )}
                        </div>

                        <div
                          style={{
                            fontSize: "15px",
                            color: "#f9fafb",
                            fontWeight: 500,
                            marginBottom: "4px",
                            minHeight: "22px",
                          }}
                        >
                          {languageTitle(session)}
                        </div>

                        <div
                          style={{
                            fontSize: "12px",
                            color: "#9ca3af",
                            minHeight: "18px",
                          }}
                        >
                          {formatConfigLabel(session)}
                        </div>
                      </div>

                      <div
                        style={{
                          marginTop: "8px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <button
                          onClick={() => handleCardClick(slot, session)}
                          style={{
                            flex: 1,
                            padding: "10px 0",
                            borderRadius: "999px",
                            border: "none",
                            cursor: "pointer",
                            backgroundColor: session ? "#2563eb" : "#22c55e",
                            color: "#f9fafb",
                            fontSize: "14px",
                            fontWeight: 500,
                          }}
                        >
                          {session ? "대화 이어하기" : "대화 시작하기"}
                        </button>

                        {session && (
                          <button
                            onClick={() => handleDeleteSession(session)}
                            disabled={isDeleting}
                            style={{
                              padding: "6px 10px",
                              borderRadius: "999px",
                              border: "1px solid #4b5563",
                              backgroundColor: "transparent",
                              color: "#fca5a5",
                              fontSize: "11px",
                              cursor: isDeleting ? "not-allowed" : "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {isDeleting ? "삭제 중..." : "이 세션 삭제"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
