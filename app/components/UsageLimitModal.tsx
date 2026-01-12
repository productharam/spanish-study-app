// app/components/UsageLimitModal.tsx
"use client";

type UsageLimitType = "chat" | "tts" | "learning" | null;

type Props = {
  open: boolean;
  type: UsageLimitType;
  onClose: () => void;
  onUpgrade: () => void;
};

function labelOf(type: Exclude<UsageLimitType, null>) {
  switch (type) {
    case "chat":
      return "채팅";
    case "tts":
      return "음성";
    case "learning":
      return "학습";
  }
}

export default function UsageLimitModal({ open, type, onClose, onUpgrade }: Props) {
  if (!open || !type) return null;

  const label = labelOf(type);
  const title = `오늘 ${label} 사용량을 모두 사용했어요.`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        zIndex: 80,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "380px",
          borderRadius: "22px",
          border: "1px solid rgba(255,255,255,0.12)",
          background:
            "linear-gradient(180deg, rgba(17,24,39,0.96) 0%, rgba(2,6,23,0.96) 100%)",
          boxShadow: "0 18px 50px rgba(0,0,0,0.65)",
          padding: "22px 20px",
        }}
      >
        <div style={{ marginBottom: "16px" }}>
          <div
            style={{
              fontSize: "18px",
              fontWeight: 800,
              color: "#f9fafb",
              letterSpacing: "-0.2px",
              lineHeight: 1.25,
              textAlign: "center",
            }}
          >
            {title}
          </div>

          <div
            style={{
              marginTop: "10px",
              fontSize: "13px",
              color: "#cbd5e1",
              lineHeight: 1.45,
              textAlign: "center",
            }}
          >
            플랜을 업그레이드하면 더 자유롭게 이용할 수 있어요.
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <button
            type="button"
            onClick={onUpgrade}
            style={{
              flex: 1,
              padding: "12px 14px",
              borderRadius: "14px",
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(37, 99, 235, 0.95)",
              color: "white",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: 800,
            }}
          >
            플랜 업그레이드
          </button>

          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              padding: "12px 14px",
              borderRadius: "14px",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              color: "#e5e7eb",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: 700,
            }}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
