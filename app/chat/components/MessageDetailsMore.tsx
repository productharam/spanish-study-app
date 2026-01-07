// app/chat/components/MessageDetailsMore.tsx
"use client";

type MessageDetails = {
  correction?: string;
  ko: string;
  en: string;
  grammar: string;
  tip: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  details?: MessageDetails;
  isDetailsLoading?: boolean;
  detailsError?: boolean;
};

type Props = {
  msg: ChatMessage;
  isUserMsg: boolean;
  onRetry: () => void;
};

export default function MessageDetailsMore({ msg, isUserMsg, onRetry }: Props) {
  const isEmpty = (v?: string) => !v || !v.trim();

  const needsRetry = (() => {
    const d = msg.details;
    if (!d) return true;

    if (isUserMsg) {
      return (
        isEmpty(d.correction) ||
        isEmpty(d.ko) ||
        isEmpty(d.en) ||
        isEmpty(d.grammar) ||
        isEmpty(d.tip)
      );
    }

    return isEmpty(d.ko) || isEmpty(d.en) || isEmpty(d.grammar) || isEmpty(d.tip);
  })();

  return (
    <div
      style={{
        marginTop: "6px",
        padding: "10px 12px",
        borderRadius: "8px",
        backgroundColor: "#181818",
        fontSize: "13px",
        color: "#ddd",
        lineHeight: 1.5,
      }}
    >
      {msg.isDetailsLoading ? (
        <div>상세 내용을 불러오는 중이에요…</div>
      ) : msg.detailsError || needsRetry ? (
        <div>
          <div style={{ marginBottom: "6px" }}>상세 정보를 불러오지 못했어요.</div>
          <button
            onClick={onRetry}
            style={{
              fontSize: "13px",
              padding: "4px 10px",
              borderRadius: "999px",
              border: "1px solid #555",
              backgroundColor: "#111",
              color: "white",
              cursor: "pointer",
            }}
          >
            다시 시도
          </button>
        </div>
      ) : (
        <>
          {isUserMsg && msg.details?.correction && (
            <section style={{ marginBottom: "6px" }}>
              <strong>0. 문장 교정</strong>
              <div style={{ marginTop: "2px", whiteSpace: "pre-wrap" }}>{msg.details.correction}</div>
            </section>
          )}

          <section style={{ marginBottom: "6px" }}>
            <strong>1. 한글 번역</strong>
            <div style={{ marginTop: "2px", whiteSpace: "pre-wrap" }}>{msg.details?.ko}</div>
          </section>

          <section style={{ marginBottom: "6px" }}>
            <strong>2. 영어 번역</strong>
            <div style={{ marginTop: "2px", whiteSpace: "pre-wrap" }}>{msg.details?.en}</div>
          </section>

          <section style={{ marginBottom: "6px" }}>
            <strong>3. 문법 설명</strong>
            <div style={{ marginTop: "2px", whiteSpace: "pre-wrap" }}>{msg.details?.grammar}</div>
          </section>

          <section>
            <strong>4. 네이티브 TIP</strong>
            <div style={{ marginTop: "2px", whiteSpace: "pre-wrap" }}>{msg.details?.tip}</div>
          </section>
        </>
      )}
    </div>
  );
}
