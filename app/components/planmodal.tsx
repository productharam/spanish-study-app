// app/components/planmodal.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type Plan = "standard" | "basic" | "pro";

function planLabel(p: Plan) {
  if (p === "standard") return "Standard";
  if (p === "basic") return "Basic";
  return "Pro";
}

const PLAN_ORDER: Plan[] = ["standard", "basic", "pro"];

type Props = {
  open: boolean;
  onClose: () => void;
  currentPlan: Plan;
};

export default function PlanModal({ open, onClose, currentPlan }: Props) {
  const [isNarrow, setIsNarrow] = useState(false);

  // ✅ Launch(출시알림) 모달 상태
  const [isLaunchOpen, setIsLaunchOpen] = useState(false);
  const [launchConsent, setLaunchConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ✅ 신청 결과 문구 (TTS 모달 느낌 유지)
  const [launchDone, setLaunchDone] = useState(false); // 초록 감사문구
  const [alreadyRequested, setAlreadyRequested] = useState(false); // 빨간 안내문구

  // ✅ (추가) 개인정보 안내 전문보기 모달
  const [showPrivacyNoticeModal, setShowPrivacyNoticeModal] = useState(false);

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 900);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!open) {
      setIsLaunchOpen(false);
      setLaunchConsent(false);
      setIsSubmitting(false);
      setLaunchDone(false);
      setAlreadyRequested(false);
      setShowPrivacyNoticeModal(false);
    }
  }, [open]);

  // ✅ launch 모달 열릴 때: profiles.launch_request_at 확인
  useEffect(() => {
    const checkAlreadyRequested = async () => {
      if (!isLaunchOpen) return;

      setLaunchDone(false);
      setAlreadyRequested(false);
      setLaunchConsent(false);
      setShowPrivacyNoticeModal(false);

      try {
        const { data: u } = await supabase.auth.getUser();
        const userId = u.user?.id;
        if (!userId) return;

        const { data: profile, error } = await supabase
          .from("profiles")
          .select("launch_request_at")
          .eq("id", userId)
          .maybeSingle();

        if (error) {
          console.error("profiles select error:", error);
          return;
        }

        if (profile?.launch_request_at) {
          setAlreadyRequested(true);
        }
      } catch (e) {
        console.error("checkAlreadyRequested error:", e);
      }
    };

    checkAlreadyRequested();
  }, [isLaunchOpen]);

  const currentRank = useMemo(() => PLAN_ORDER.indexOf(currentPlan), [currentPlan]);

  const rows = useMemo(() => {
    return [
      {
        key: "standard" as const,
        title: "Standard",
        desc: "FREE",
        items: ["대화 30회/일", "학습 10회/일", "음성 2회/일"],
      },
      {
        key: "basic" as const,
        title: "Basic",
        desc: "준비 중",
        items: ["", "", ""],
      },
      {
        key: "pro" as const,
        title: "Pro",
        desc: "준비 중",
        items: ["", "", ""],
      },
    ];
  }, []);

  if (!open) return null;

  const onClickUpgrade = () => {
    setIsLaunchOpen(true);
  };

  const submitLaunch = async () => {
  if (alreadyRequested) return;

  if (!launchConsent) {
    alert("이메일 수집 동의에 체크해 주세요");
    return;
  }

  try {
    setIsSubmitting(true);

    // ✅ 1. 세션에서 access token 가져오기
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token ?? null;

    // ✅ 2. 지금 확인하려고 했던 로그
    console.log("accessToken?", Boolean(accessToken));

    if (!accessToken) {
      console.error("No access token");
      alert("로그인 정보를 확인할 수 없어요.");
      return;
    }

    // ✅ 3. Authorization 헤더 포함해서 호출
    const res = await fetch("/api/launch-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        feature: "plan-upgrade",
        consent: true,
      }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.ok === false) {
      console.error("launch-request failed:", json);
      alert("요청 저장에 실패했어요.");
      return;
    }

    if (json.alreadyRequested) {
      setAlreadyRequested(true);
      return;
    }

    setLaunchDone(true);
  } catch (e) {
    console.error("launch-request error:", e);
    alert("요청 저장 중 오류가 발생했어요.");
  } finally {
    setIsSubmitting(false);
  }
};


  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    display: "flex",
    justifyContent: "center",
    alignItems: isNarrow ? "stretch" : "center",
    zIndex: 9999,
    padding: isNarrow ? 0 : 16,
  };

  const modalStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: isNarrow ? "100%" : 820,
    height: isNarrow ? "100%" : "auto",
    borderRadius: isNarrow ? 0 : 18,
    backgroundColor: "#0b0f19",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.55)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  };

  return (
    <div style={overlayStyle} onMouseDown={onClose}>
      <div style={modalStyle} onMouseDown={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ color: "#f9fafb", fontWeight: 800, fontSize: 16 }}>플랜 비교</div>
            <div style={{ marginTop: 4, color: "#9ca3af", fontSize: 12 }}>
              현재 플랜: <span style={{ color: "#e5e7eb" }}>{planLabel(currentPlan)}</span>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              border: "1px solid rgba(255,255,255,0.18)",
              background: "transparent",
              color: "#e5e7eb",
              borderRadius: 10,
              padding: "6px 10px",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            닫기
          </button>
        </div>

        {/* 본문 */}
        <div
          style={{
            padding: 16,
            display: "grid",
            gap: 12,
            gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr 1fr",
          }}
        >
          {rows.map((r) => {
            const rank = PLAN_ORDER.indexOf(r.key);
            const isCurrent = rank === currentRank;
            const isLower = rank < currentRank;
            const isHigher = rank > currentRank;

            const btnLabel = isCurrent ? "이용 중" : isLower ? "선택 불가" : "출시 알림";
            const btnDisabled = isCurrent || isLower || isSubmitting;
            const btnPrimary = isHigher;

            return (
              <div
                key={r.key}
                style={{
                  border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 16,
                  padding: 14,
                  backgroundColor: "rgba(255,255,255,0.03)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ color: "#f9fafb", fontWeight: 900, fontSize: 16 }}>{r.title}</div>
                  <div style={{ color: "#9ca3af", fontSize: 12 }}>{r.desc}</div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {r.items.map((it) => (
                    <div key={it} style={{ color: "#e5e7eb", fontSize: 13 }}>
                      • {it}
                    </div>
                  ))}
                </div>

                <button
                  disabled={btnDisabled}
                  onClick={() => {
                    if (isHigher) onClickUpgrade();
                  }}
                  style={{
                    marginTop: 8,
                    width: "100%",
                    borderRadius: 12,
                    border: btnPrimary ? "none" : "1px solid rgba(255,255,255,0.16)",
                    backgroundColor: btnPrimary ? "#2563eb" : "transparent",
                    color: "#fff",
                    padding: "10px 12px",
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: btnDisabled ? "not-allowed" : "pointer",
                    opacity: btnDisabled ? 0.55 : 1,
                  }}
                >
                  {btnLabel}
                </button>
              </div>
            );
          })}
        </div>

        {/* Launch 모달 (TTS 출시요청 모달 느낌으로) */}
        {isLaunchOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.7)",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              zIndex: 10000,
            }}
            onMouseDown={() => {
              setIsLaunchOpen(false);
              setShowPrivacyNoticeModal(false);
            }}
          >
            <div
              style={{
                backgroundColor: "#111827",
                padding: "22px 24px",
                borderRadius: "16px",
                width: "340px",
                maxWidth: "92vw",
                boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                position: "relative",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  setIsLaunchOpen(false);
                  setShowPrivacyNoticeModal(false);
                }}
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
                aria-label="닫기"
              >
                ×
              </button>

              <h2 style={{ color: "#f9fafb", fontSize: "16px", marginBottom: "8px" }}>플랜 업그레이드</h2>
              <p style={{ color: "#9ca3af", fontSize: "13px", marginBottom: "12px", lineHeight: 1.5 }}>
                업그레이드 플랜을 준비 중입니다.
                <br />
                출시 알림을 원하시면 버튼을 눌러주세요.
              </p>

              <label style={{ display: "flex", gap: "8px", alignItems: "flex-start", marginBottom: "8px" }}>
                <input
                  type="checkbox"
                  checked={launchConsent}
                  onChange={(e) => setLaunchConsent(e.target.checked)}
                  disabled={isSubmitting || launchDone || alreadyRequested}
                  style={{ marginTop: "2px" }}
                />
                <span style={{ color: "#e5e7eb", fontSize: "12px", lineHeight: 1.4 }}>
                  이메일 수집에 동의합니다.
                  <br />
                  <span style={{ color: "#9ca3af" }}>출시 안내 목적 사용 후 지체없이 파기됩니다.</span>
                </span>
              </label>

              <div
  style={{
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "12px",
  }}
>
  {/* 상태 문구 (좌측) */}
  <div style={{ fontSize: "12px" }}>
    {alreadyRequested ? (
      <span style={{ color: "#fca5a5" }}>이미 신청되었어요.</span>
    ) : launchDone ? (
      <span style={{ color: "#86efac" }}>참여해주셔서 감사합니다.</span>
    ) : null}
  </div>

  {/* 전문보기 (우측) */}
  <button
    type="button"
    onClick={() => setShowPrivacyNoticeModal(true)}
    style={{
      border: "none",
      background: "transparent",
      color: "#93c5fd",
      fontSize: "12px",
      cursor: "pointer",
      padding: "2px 4px",
    }}
  >
    [전문보기]
  </button>
</div>


              <button
                onClick={submitLaunch}
                disabled={isSubmitting || launchDone || alreadyRequested}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "999px",
                  border: "none",
                  cursor: isSubmitting || launchDone || alreadyRequested ? "not-allowed" : "pointer",
                  fontSize: "13px",
                  fontWeight: 600,
                  backgroundColor:
                    !launchConsent || launchDone || alreadyRequested ? "#4b5563" : "#2563eb",
                  color: "#f9fafb",
                  opacity: isSubmitting ? 0.8 : 1,
                }}
              >
                {alreadyRequested ? "이미 신청됨" : isSubmitting ? "저장 중..." : "출시 알림 신청"}
              </button>
            </div>
          </div>
        )}

        {/* ✅ 개인정보 수집 및 이용 안내 (전문보기 모달) */}
        {showPrivacyNoticeModal && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.7)",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              zIndex: 10001,
            }}
            onMouseDown={() => setShowPrivacyNoticeModal(false)}
          >
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                backgroundColor: "#0b1220",
                padding: "18px 18px",
                borderRadius: "16px",
                width: "360px",
                maxWidth: "92vw",
                boxShadow: "0 10px 30px rgba(0,0,0,0.55)",
                border: "1px solid #1f2937",
                position: "relative",
              }}
            >
              <button
                onClick={() => setShowPrivacyNoticeModal(false)}
                style={{
                  position: "absolute",
                  top: "8px",
                  right: "10px",
                  border: "none",
                  background: "transparent",
                  color: "#9ca3af",
                  fontSize: "18px",
                  cursor: "pointer",
                }}
                aria-label="닫기"
              >
                ×
              </button>

              <h3 style={{ margin: 0, marginBottom: "10px", color: "#f9fafb", fontSize: "15px" }}>
                개인정보 수집 및 이용 안내
              </h3>

              <div style={{ color: "#e5e7eb", fontSize: "12px", lineHeight: 1.6 }}>
                <div style={{ marginBottom: "10px" }}>
                  <strong>1. 수집 목적</strong>
                  <div style={{ marginTop: "2px", color: "#cbd5e1" }}>
                    플랜 업그레이드 출시 알림 안내
                  </div>
                </div>

                <div style={{ marginBottom: "10px" }}>
                  <strong>2. 수집 항목</strong>
                  <div style={{ marginTop: "2px", color: "#cbd5e1" }}>이메일 주소</div>
                </div>

                <div style={{ marginBottom: "10px" }}>
                  <strong>3. 보유 및 이용 기간</strong>
                  <div style={{ marginTop: "2px", color: "#cbd5e1" }}>출시 안내 후 즉시 파기</div>
                </div>

                <div style={{ marginBottom: "10px" }}>
                  <strong>4. 동의 거부 권리 안내</strong>
                  <div style={{ marginTop: "2px", color: "#cbd5e1" }}>
                    이용자는 개인정보 수집에 동의하지 않을 권리가 있으며,
                    <br />
                    동의하지 않아도 서비스 이용에는 제한이 없습니다.
                  </div>
                </div>

                <div>
                  <strong>5. 처리 주체</strong>
                  <div style={{ marginTop: "2px", color: "#cbd5e1" }}>본 서비스 운영자</div>
                </div>
              </div>

              <button
                onClick={() => setShowPrivacyNoticeModal(false)}
                style={{
                  marginTop: "14px",
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "999px",
                  border: "1px solid #374151",
                  backgroundColor: "#111827",
                  color: "#e5e7eb",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                닫기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
