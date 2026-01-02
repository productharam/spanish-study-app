// app/join/consent/ConsentClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const TERMS_VERSION = "2025-12-30";
const PRIVACY_VERSION = "2025-12-30";
const COLLECTION_VERSION = "2025-12-30";

type DocKey = "terms" | "privacy" | "collection" | null;

export default function ConsentClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const [userId, setUserId] = useState<string | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeCollection, setAgreeCollection] = useState(false);

  const [saving, setSaving] = useState(false);
  const [openDoc, setOpenDoc] = useState<DocKey>(null);

  const allChecked = agreeTerms && agreePrivacy && agreeCollection;

  // ✅ next 파라미터 (없으면 "/")
  const nextPath = sp.get("next") || "/";

  useEffect(() => {
    const init = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        const u = data.session?.user;
        if (!u) {
          router.replace("/login");
          return;
        }
        setUserId(u.id);
      } catch (e) {
        console.error(e);
        router.replace("/login");
      } finally {
        setLoadingUser(false);
      }
    };
    init();
  }, [router]);

  const documents = useMemo(() => {
    const terms = `서비스 이용약관 (v${TERMS_VERSION})

제1조(목적)
본 약관은 서비스 운영자(이하 "운영자")가 제공하는 말하면서 배우는 언어 챗봇 서비스(이하 "서비스")의 이용과 관련하여 운영자와 이용자 간의 권리·의무 및 책임사항을 규정합니다.

제2조(계정 및 이용계약)
이용자는 소셜 로그인(Google 등)을 통해 계정을 생성·이용할 수 있으며, 본 약관 및 필수 동의 사항에 동의한 경우 서비스 이용계약이 성립합니다.

제3조(서비스 내용)
서비스는 대화 기반 언어 학습 기능(대화, 피드백, 학습 보조 등)을 제공합니다. 운영자는 운영상·기술상 필요에 따라 서비스의 일부 또는 전부를 변경할 수 있습니다.

제4조(이용자의 의무)
이용자는 서비스의 정상 운영을 방해하는 행위(비정상 트래픽 유발, 악용 등), 타인의 권리 침해, 법령 및 공서양속에 반하는 콘텐츠 입력을 해서는 안 됩니다.

제5조(대화 콘텐츠 및 책임)
1) 이용자는 서비스 내에서 본인이 입력한 대화 내용 및 서비스가 생성한 응답을 확인할 수 있습니다.
2) 생성형 AI의 특성상 응답의 정확성·완전성·최신성을 보장하지 않으며, 이용자는 참고 목적 범위에서 서비스를 이용해야 합니다.

제6조(문의)
문의는 서비스 메인 페이지 하단에 기재된 이메일로 접수합니다.
- 문의: product.haram@gmail.com (실시간 상담 아님)
`;

    const privacy = `개인정보처리방침 (v${PRIVACY_VERSION})

운영자는 개인정보 보호법 등 관련 법령을 준수하며, 이용자의 개인정보를 다음과 같이 처리합니다.

1. 처리 목적
- 소셜 로그인 기반 회원 식별 및 계정 관리
- 서비스 제공 및 품질 개선(대화/학습 기능 제공, 오류 분석 등)
- 문의 대응 및 공지 전달(필요 시)

2. 처리하는 개인정보 항목
- (소셜 로그인) 이용자가 로그인 과정에서 제공에 동의한 정보(예: 이메일, 이름/닉네임, 프로필 이미지, 계정 식별자 등)
- (서비스 이용 과정) 이용자가 입력한 대화 내용, 서비스 이용 기록, 접속 로그 등

3. 대화 내용의 열람 및 처리
- 이용자는 서비스 내에서 본인이 입력한 대화 내용 및 서비스가 생성한 응답을 확인할 수 있습니다.
- 서비스 제공을 위해 대화 내용이 외부 처리 시스템(예: AI 처리, 음성 합성 등)으로 전송될 수 있습니다.
- 외부 제공자에게 전송된 데이터의 모델 개선 활용 여부는 제공자 정책/설정(예: 별도 동의/옵트인)에 따라 달라질 수 있습니다.

4. 외부 서비스 이용(처리위탁 등)
운영자는 서비스 제공을 위해 필요한 범위에서 외부 서비스 제공자를 이용할 수 있습니다.
- 인증/DB/스토리지: Supabase
- 소셜 로그인: Google OAuth
- AI 응답 생성: OpenAI
- (사용 시) 음성 생성: 음성 생성 서비스 제공자

5. 보유 및 이용기간
- 원칙적으로 회원 탈퇴 시 지체 없이 파기합니다.
- 단, 관련 법령에 따라 보관이 필요한 경우 해당 기간 동안 보관할 수 있습니다.

6. 이용자의 권리
이용자는 개인정보 열람, 정정, 삭제, 처리정지 등을 요구할 수 있으며, 회원 탈퇴를 통해 개인정보 처리 중단 및 삭제를 요청할 수 있습니다.

7. 문의
- 문의: product.haram@gmail.com (실시간 상담 아님)
`;

    const collection = `개인정보 수집·이용 동의(필수) (v${COLLECTION_VERSION})

1) 목적
- 회원 가입 및 로그인(소셜 로그인), 계정 관리, 서비스 제공

2) 항목
- 이메일, 계정 식별자, 프로필 정보(이름/닉네임, 프로필 이미지 등 제공에 동의한 항목)
- 서비스 이용 기록 및 대화 내용

3) 보유기간
- 회원 탈퇴 시 지체 없이 파기(법령상 보관 의무가 있는 경우 예외)

4) 동의 거부 권리 및 불이익
- 이용자는 동의를 거부할 권리가 있으나, 필수 항목 동의 거부 시 가입 및 서비스 이용이 제한됩니다.
`;

    return { terms, privacy, collection };
  }, []);

  const currentDocText =
    openDoc === "terms"
      ? documents.terms
      : openDoc === "privacy"
      ? documents.privacy
      : openDoc === "collection"
      ? documents.collection
      : "";

  const handleAgreeAndStart = async () => {
    if (!userId) return;
    if (!allChecked) return;

    setSaving(true);
    try {
      const { error } = await supabase.from("user_consents").upsert(
        {
          user_id: userId,
          terms_version: TERMS_VERSION,
          privacy_version: PRIVACY_VERSION,
          collection_version: COLLECTION_VERSION,
          accepted_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      if (error) throw error;

      router.replace(nextPath);
    } catch (e) {
      console.error("Save consent error:", e);
      alert("동의 저장 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  };

  if (loadingUser) return <p style={{ padding: 16 }}>로딩 중...</p>;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#000000",
        padding: "24px 16px",
      }}
    >
      <div
        style={{
          backgroundColor: "#111827",
          padding: "28px 22px",
          borderRadius: "16px",
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
          width: "100%",
          maxWidth: "480px",
          color: "#f9fafb",
        }}
      >
        <h1 style={{ fontSize: 20, marginBottom: 10 }}>가입을 위해 약관 동의가 필요해요</h1>
        <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 18 }}>
          아래 필수 약관에 동의하면 서비스 이용을 시작할 수 있어요.
        </p>

        <ConsentRow checked={agreeTerms} onChange={setAgreeTerms} label="[필수] 서비스 이용약관 동의" onOpen={() => setOpenDoc("terms")} />
        <ConsentRow checked={agreePrivacy} onChange={setAgreePrivacy} label="[필수] 개인정보처리방침 동의" onOpen={() => setOpenDoc("privacy")} />
        <ConsentRow checked={agreeCollection} onChange={setAgreeCollection} label="[필수] 개인정보 수집·이용 동의" onOpen={() => setOpenDoc("collection")} />

        <button
          disabled={!allChecked || saving}
          onClick={handleAgreeAndStart}
          style={{
            width: "100%",
            marginTop: 18,
            padding: "12px 16px",
            borderRadius: "999px",
            border: "none",
            cursor: !allChecked || saving ? "not-allowed" : "pointer",
            fontSize: 15,
            fontWeight: 600,
            backgroundColor: !allChecked || saving ? "#374151" : "#ffffff",
            color: !allChecked || saving ? "#9ca3af" : "#111827",
          }}
        >
          {saving ? "저장 중..." : "동의하고 시작하기"}
        </button>
      </div>

      {openDoc && (
        <DocModal
          title={openDoc === "terms" ? "서비스 이용약관" : openDoc === "privacy" ? "개인정보처리방침" : "개인정보 수집·이용 동의"}
          text={currentDocText}
          onClose={() => setOpenDoc(null)}
        />
      )}
    </main>
  );
}

function ConsentRow(props: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  onOpen: () => void;
}) {
  const { checked, onChange, label, onOpen } = props;

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "10px 10px",
        borderRadius: 12,
        backgroundColor: "#0b1220",
        marginBottom: 10,
      }}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, color: "#f9fafb" }}>{label}</div>
        <button
          onClick={onOpen}
          style={{
            marginTop: 6,
            background: "transparent",
            border: "none",
            color: "#93c5fd",
            cursor: "pointer",
            padding: 0,
            fontSize: 13,
            textDecoration: "underline",
          }}
        >
          전문보기
        </button>
      </div>
    </div>
  );
}

function DocModal(props: { title: string; text: string; onClose: () => void }) {
  const { title, text, onClose } = props;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.65)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: 16,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 720,
          backgroundColor: "#111827",
          borderRadius: 16,
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
          overflow: "hidden",
          color: "#f9fafb",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 16px",
            borderBottom: "1px solid #374151",
          }}
        >
          <div style={{ fontWeight: 700 }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#e5e7eb",
              cursor: "pointer",
              fontSize: 16,
            }}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <pre
          style={{
            margin: 0,
            padding: 16,
            fontSize: 12.5,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: "70vh",
            overflow: "auto",
            color: "#e5e7eb",
          }}
        >
          {text}
        </pre>
      </div>
    </div>
  );
}
