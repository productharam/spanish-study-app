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
      if (!user) return;

      setIsLoadingSessions(true);
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
      }
    };

    if (user) {
      loadSessions();
    } else if (user === null) {
      // 비로그인은 세션 필요 없음
      setSlots([
        { slot: 1, session: null },
        { slot: 2, session: null },
        { slot: 3, session: null },
      ]);
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

  return (
    <main
      style={{
        height: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#000000",
        padding: "16px",
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
            justifyContent: "space-between",
            alignItems: "center",
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
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: "4px",
                }}
              >
                <span
                  style={{
                    color: "#e5e7eb",
                    fontSize: "13px",
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

            <div
              style={{
                display: "flex",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              {slots.map(({ slot, session }) => {
                const isDeleting =
                  !!(session && deletingSessionId === session.id);

                return (
                  <div
                    key={slot}
                    style={{
                      flex: "1 1 0",
                      minWidth: "0",
                      maxWidth: "320px",
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
                        {session
                          ? session.title || "제목 없는 대화"
                          : "아직 대화를 시작하지 않았어요"}
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
          </div>
        )}
      </div>
    </main>
  );
}
