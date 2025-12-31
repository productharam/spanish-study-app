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
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  const [isSlotsReady, setIsSlotsReady] = useState(false);

  // ✅ 화면 폭에 따라 가로/세로 배치 전환
  const [isNarrow, setIsNarrow] = useState(false);

  // ✅ "일정 수준 이상"이면 (PC) = 좌측 타이틀 + 우측 로그인, 중앙 버튼 구조
  const [isWide, setIsWide] = useState(false);

  // ✅ 설정 모달
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // ✅ 설정 > 회원탈퇴 상세 화면 토글
  const [isWithdrawalOpen, setIsWithdrawalOpen] = useState(false);

  // ✅ 회원탈퇴 체크/로딩/에러
  const [deleteChecked, setDeleteChecked] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);

  useEffect(() => {
    const handleResize = () => {
      setIsNarrow(window.innerWidth < 900);
      // ✅ PC 레이아웃 전환 기준 (원하는대로 1100/1200 등 조절 가능)
      setIsWide(window.innerWidth >= 1100);
    };

    handleResize();
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

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  // ✅ 로그인된 경우에만 세션 목록 3개 로드
  useEffect(() => {
    const loadSessions = async () => {
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
      setIsSlotsReady(false);

      try {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token ?? null;

        const res = await fetch("/api/sessions", {
          method: "GET",
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        });

        const json = await res.json().catch(() => null);

        if (!res.ok || !json || json.ok === false) {
          console.error("/api/sessions error:", json);
          return;
        }

        const sessions: SessionSummary[] = json.sessions ?? [];

        const slotMap: Record<number, SessionSummary> = {};
        for (const s of sessions) {
          if (!s.slot) continue;
          if (s.slot < 1 || s.slot > 3) continue;
          if (!slotMap[s.slot]) slotMap[s.slot] = s;
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
        setIsSlotsReady(true);
      }
    };

    if (user) loadSessions();
    else if (user === null) {
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

  const handleCardClick = (slot: number, session: SessionSummary | null) => {
    if (!user) {
      router.push("/login");
      return;
    }

    if (session) router.push(`/chat?sessionId=${session.id}`);
    else router.push(`/chat?slot=${slot}&new=1`);
  };

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

      setSlots((prev) =>
        prev.map((s) => (s.session?.id === session.id ? { ...s, session: null } : s))
      );
    } catch (e) {
      console.error("handleDeleteSession error:", e);
      alert("세션 삭제 중 오류가 발생했어요 🥲");
    } finally {
      setDeletingSessionId(null);
    }
  };

  const formatConfigLabel = (session: SessionSummary | null) => {
    if (!session) return "아직 설정된 정보가 없어요";
    const lang = session.language || "언어 미지정";
    const level = session.level || "레벨 미지정";
    const persona = session.persona_type || "페르소나 미지정";
    return `${lang} · ${level} · ${persona}`;
  };

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

  const getCardLayoutStyle = () =>
    isNarrow ? { width: "100%" } : { flex: "1 1 0", minWidth: "0", maxWidth: "320px" };

  // ✅ 설정 열 때 초기화
  const openSettings = () => {
    setDeleteAccountError(null);
    setDeleteChecked(false);
    setIsWithdrawalOpen(false);
    setIsSettingsOpen(true);
  };

  const closeSettings = () => {
    setIsSettingsOpen(false);
    setIsWithdrawalOpen(false);
  };

  const openWithdrawal = () => {
    setDeleteAccountError(null);
    setDeleteChecked(false);
    setIsWithdrawalOpen(true);
  };

  const backToSettingsRoot = () => {
    setIsWithdrawalOpen(false);
  };

  // ✅ 회원탈퇴 호출
  const handleDeleteAccount = async () => {
    if (!user) return;

    setDeleteAccountError(null);
    setIsDeletingAccount(true);

    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token ?? null;
      if (!accessToken) throw new Error("로그인이 필요합니다.");

      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json || json.ok === false) {
        throw new Error(json?.error || "회원탈퇴 중 문제가 발생했어요.");
      }

      await supabase.auth.signOut();
      setUser(null);
      setIsSettingsOpen(false);
      setIsWithdrawalOpen(false);
      router.push("/");
      router.refresh();
    } catch (e: any) {
      setDeleteAccountError(e?.message ?? "회원탈퇴 중 오류가 발생했어요.");
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const contactEmail = "product.haram@gmail.com";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#000000",
      }}
    >
      <main
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: isNarrow ? "36px 16px 16px" : isWide ? "90px 16px 16px" : "16px",
          boxSizing: "border-box",
        }}
      >
        {/* ✅ 비로그인 상태 */}
        {!isUserLoading && !user ? (
          // ✅ PC(일정 폭 이상): "좌측 타이틀 + 우측 로그인" / "중앙 버튼" 구조 (스크린샷처럼)
          isWide ? (
            <div
              style={{
                width: "100%",
                maxWidth: "1100px",
                minHeight: "18vh",
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gridTemplateRows: "auto 1fr",
                columnGap: "24px",
                rowGap: "12px",
                alignItems: "start",
              }}
            >
              {/* 좌측 타이틀 블럭 */}
              <div style={{ gridColumn: "1 / 2", gridRow: "1 / 2" }}>
                <h1 style={{ color: "#f9fafb", fontSize: "24px", margin: "0 0 6px 0" }}>
                  말하면서 배우는 언어 챗봇
                </h1>
                <p style={{ color: "#9ca3af", fontSize: "13px", margin: 0, lineHeight: 1.6 }}>
                  실제 말하는 것처럼 대화하고,
                  <br />
                  모르는 문장을 반복 학습할 수 있어요
                </p>
              </div>

              {/* 중앙(두 컬럼 spanning): 안내문 + 버튼 2개 */}
              <div
                style={{
                  gridColumn: "1 / 3",
                  gridRow: "2 / 3",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  textAlign: "center",
                  gap: "14px",
                  paddingBottom: "24px",
                }}
              >
                <p style={{ color: "#9ca3af", fontSize: "14px", margin: 0, lineHeight: 1.7 }}>
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
            </div>
          ) : (
            // ✅ 모바일/좁은 화면: 기존처럼 중앙정렬 (문구/내용 그대로)
            <div
              style={{
                width: "100%",
                maxWidth: "960px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                gap: "18px",
                padding: "8px 0",
              }}
            >
              <div>
                <h1 style={{ color: "#f9fafb", fontSize: "24px", margin: "0 0 6px 0" }}>
                  말하면서 배우는 언어 챗봇
                </h1>
                <p style={{ color: "#9ca3af", fontSize: "13px", margin: 0, lineHeight: 1.6 }}>
                  실제 말하는 것처럼 대화하고,
                  <br />
                  모르는 문장을 반복 학습할 수 있어요
                </p>
              </div>

              <p style={{ color: "#9ca3af", fontSize: "14px", margin: 0, lineHeight: 1.7 }}>
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
          )
        ) : (
          // ✅ 로그인 상태(또는 로딩 중): 기존 레이아웃 유지
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
                flexDirection: isNarrow ? "column" : "row",
                justifyContent: isNarrow ? "flex-start" : "space-between",
                alignItems: isNarrow ? "flex-start" : "center",
                gap: isNarrow ? 12 : 0,
              }}
            >
              <div
                style={{
                  width: isNarrow ? "100%" : "auto",
                  textAlign: isNarrow ? "center" : "left",
                }}
              >
                <h1
                  style={{
                    color: "#f9fafb",
                    fontSize: "24px",
                    marginBottom: "4px",
                    marginTop: 0,
                  }}
                >
                  말하면서 배우는 언어 챗봇
                </h1>
                <p style={{ color: "#9ca3af", fontSize: "13px", margin: 0 }}>
                  실제 말하는 것처럼 대화하고,
                  <br />
                  모르는 문장을 반복 학습할 수 있어요
                </p>
              </div>

              <div style={{ width: isNarrow ? "100%" : "auto" }}>
                {isUserLoading ? (
                  <span style={{ color: "#9ca3af", fontSize: "13px" }}>
                    사용자 정보를 불러오는 중...
                  </span>
                ) : user ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: isNarrow ? "row" : "column",
                      alignItems: isNarrow ? "center" : "flex-end",
                      justifyContent: isNarrow ? "space-between" : "flex-end",
                      gap: isNarrow ? 8 : 6,
                      width: isNarrow ? "100%" : "auto",
                    }}
                  >
                    <span
                      style={{
                        color: "#e5e7eb",
                        fontSize: "13px",
                        wordBreak: "break-all",
                      }}
                    >
                      {user.email} 님
                    </span>

                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={openSettings}
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
                        설정
                      </button>

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
                  </div>
                ) : (
                  <div style={{ height: 1 }} />
                )}
              </div>
            </div>

            {/* 로그인 상태: 3개 세션 카드 */}
            {!isUserLoading && user && (
              <div style={{ width: "100%", marginTop: "8px" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "8px",
                  }}
                >
                  <h2 style={{ color: "#f9fafb", fontSize: "18px", margin: 0 }}>
                    나의 대화 세션
                  </h2>
                  {isLoadingSessions && (
                    <span style={{ color: "#9ca3af", fontSize: "12px" }}>
                      세션을 불러오는 중...
                    </span>
                  )}
                </div>

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
                      const isDeleting = !!(session && deletingSessionId === session.id);

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
                              <span style={{ fontSize: "13px", color: "#9ca3af" }}>
                                세션 {slot}
                              </span>
                              {session && (
                                <span style={{ fontSize: "11px", color: "#6b7280" }}>
                                  최근 사용:{" "}
                                  {new Date(session.created_at).toLocaleDateString("ko-KR")}
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

            {/* ✅ 설정 모달 (설정 목록 / 회원탈퇴 상세) */}
            {isSettingsOpen && (
              <div
                onClick={closeSettings}
                style={{
                  position: "fixed",
                  inset: 0,
                  backgroundColor: "rgba(0,0,0,0.6)",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  padding: "16px",
                  zIndex: 50,
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: "100%",
                    maxWidth: "520px",
                    backgroundColor: "#0b1220",
                    border: "1px solid #1f2937",
                    borderRadius: "16px",
                    padding: "16px",
                    boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
                    color: "#e5e7eb",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "12px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {isWithdrawalOpen && (
                        <button
                          onClick={backToSettingsRoot}
                          style={{
                            border: "1px solid #374151",
                            backgroundColor: "transparent",
                            color: "#e5e7eb",
                            borderRadius: "999px",
                            padding: "6px 10px",
                            cursor: "pointer",
                            fontSize: "12px",
                          }}
                        >
                          ←
                        </button>
                      )}
                      <div style={{ fontWeight: 700, fontSize: "16px" }}>설정</div>
                    </div>

                    <button
                      onClick={closeSettings}
                      style={{
                        border: "1px solid #374151",
                        backgroundColor: "transparent",
                        color: "#e5e7eb",
                        borderRadius: "999px",
                        padding: "6px 10px",
                        cursor: "pointer",
                        fontSize: "12px",
                      }}
                    >
                      닫기
                    </button>
                  </div>

                  {!isWithdrawalOpen ? (
                    <div style={{ borderTop: "1px solid #1f2937", paddingTop: "12px" }}>
                      <button
                        onClick={openWithdrawal}
                        style={{
                          width: "100%",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "14px 12px",
                          borderRadius: "12px",
                          border: "1px solid #1f2937",
                          backgroundColor: "rgba(255,255,255,0.02)",
                          color: "#e5e7eb",
                          cursor: "pointer",
                          fontSize: "14px",
                        }}
                      >
                        <span style={{ fontWeight: 700 }}>회원탈퇴</span>
                        <span style={{ color: "#9ca3af" }}>›</span>
                      </button>
                    </div>
                  ) : (
                    <div style={{ borderTop: "1px solid #1f2937", paddingTop: "12px" }}>
                      <div style={{ fontWeight: 700, marginBottom: "8px" }}>회원탈퇴</div>

                      <div style={{ color: "#fca5a5", fontSize: "13px", lineHeight: 1.5 }}>
                        탈퇴 즉시 모든 정보가 삭제되며 복구가 불가합니다. 그래도
                        탈퇴하시겠습니까
                      </div>

                      <label
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          marginTop: 12,
                          fontSize: "13px",
                          color: "#e5e7eb",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={deleteChecked}
                          onChange={(e) => setDeleteChecked(e.target.checked)}
                          disabled={isDeletingAccount}
                        />
                        <span>위 내용을 확인했으며, 탈퇴에 동의합니다.</span>
                      </label>

                      {deleteAccountError && (
                        <div style={{ marginTop: 10, color: "#fca5a5", fontSize: "12px" }}>
                          {deleteAccountError}
                        </div>
                      )}

                      <button
                        onClick={handleDeleteAccount}
                        disabled={!deleteChecked || isDeletingAccount}
                        style={{
                          width: "100%",
                          marginTop: "12px",
                          padding: "10px 12px",
                          borderRadius: "12px",
                          border: "1px solid #7f1d1d",
                          backgroundColor: "#991b1b",
                          color: "#fff",
                          cursor: !deleteChecked || isDeletingAccount ? "not-allowed" : "pointer",
                          opacity: !deleteChecked || isDeletingAccount ? 0.55 : 1,
                          fontSize: "14px",
                          fontWeight: 700,
                        }}
                      >
                        {isDeletingAccount ? "탈퇴 처리중..." : "회원탈퇴"}
                      </button>

                      <div style={{ marginTop: 10, color: "#9ca3af", fontSize: "12px" }}>
                        * 탈퇴 시 저장된 모든 정보가 삭제됩니다.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ✅ 하단 푸터 */}
      <footer
        style={{
          width: "100%",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          padding: "14px 16px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            maxWidth: "960px",
            margin: "0 auto",
            display: "flex",
            flexDirection: isNarrow ? "column" : "row",
            gap: isNarrow ? 6 : 12,
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            color: "#9ca3af",
            fontSize: "12px",
            lineHeight: 1.6,
          }}
        >
          <span>말하면서 배우는 언어 챗봇</span>
          <span style={{ display: isNarrow ? "none" : "inline" }}>·</span>
          <span>
            문의 :{" "}
            <a
              href={`mailto:${contactEmail}`}
              style={{ color: "#e5e7eb", textDecoration: "none" }}
            >
              {contactEmail}
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
